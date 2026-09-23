package account

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
	"github.com/togo-framework/ratelimit"

	"github.com/fadymondy/mahaam/internal/platform"
)

/*
The profile (MH-343): /api/me/*, signed in, no workspace.

	GET    /api/me/profile        who I am: email, name, picture, language, timezone
	PATCH  /api/me/profile        change name, language, timezone
	POST   /api/me/avatar         upload a picture (multipart "file"); stored as a 256px JPEG
	DELETE /api/me/avatar         back to initials
	POST   /api/me/email          ask to move to a new address: a code goes to THAT address
	POST   /api/me/email/confirm  the code; the address changes, and the old one is told
	DELETE /api/me/token          revoke the personal access token this request is signed with

Changing the password stays where it is (the auth plugin's POST /api/auth/change-password).
*/

// Profile is a person's own view of their account.
type Profile struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Name      string  `json:"name" doc:"Empty until set; show the email instead"`
	Avatar    *string `json:"avatar" doc:"A data: URL (256px JPEG), or null for initials"`
	Locale    *string `json:"locale" doc:"en or ar; null: follow the device"`
	Timezone  *string `json:"timezone" doc:"IANA name; null: follow the device"`
	CreatedAt string  `json:"created_at"`
	// EmailVerified: the address has been proven with a code (MH-342).
	EmailVerified bool `json:"email_verified"`
	// HasPassword is false for an account made with Apple, Google or GitHub. Where the others type
	// their password (delete, email change, 2FA), it sends email_code from POST /api/me/reauth/code.
	HasPassword bool `json:"has_password" doc:"false: an Apple/Google/GitHub account. Confirm with email_code (POST /api/me/reauth/code) where others give the password"`
}

// LoadProfile reads a profile. A person who never saved one has the empty profile.
func LoadProfile(ctx context.Context, db *sql.DB, userID string) (*Profile, error) {
	p := &Profile{ID: userID}
	var hash string
	err := db.QueryRowContext(ctx, `
		SELECT u.email, u.created_at, coalesce(p.name, ''), p.avatar, p.locale, p.timezone,
			coalesce(pu.email_verified_at IS NOT NULL, false), u.password_hash
		FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id LEFT JOIN platform_users pu ON pu.user_id = u.id
		WHERE u.id = $1`, userID,
	).Scan(&p.Email, &p.CreatedAt, &p.Name, &p.Avatar, &p.Locale, &p.Timezone, &p.EmailVerified, &hash)
	p.HasPassword = HasPassword(hash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, platform.ErrNoUser
	}
	return p, err
}

// ProfilePatch changes a profile. An absent field stays; an empty locale or timezone clears it.
type ProfilePatch struct {
	Name     *string `json:"name,omitempty" maxLength:"120"`
	Locale   *string `json:"locale,omitempty" enum:"en,ar," doc:"\"\" clears it"`
	Timezone *string `json:"timezone,omitempty" maxLength:"64" doc:"IANA name, e.g. Africa/Cairo; \"\" clears it"`
}

var errBadTimezone = errors.New("unknown timezone: use an IANA name such as Africa/Cairo")

// SaveProfile applies a patch.
func SaveProfile(ctx context.Context, db *sql.DB, userID string, in ProfilePatch) error {
	var name, locale, tz any
	if in.Name != nil {
		// Collapsed whitespace: a name is shown on one line everywhere it appears.
		name = strings.Join(strings.Fields(*in.Name), " ")
	}
	if in.Locale != nil {
		locale = nullIfEmpty(*in.Locale)
	}
	if in.Timezone != nil {
		v := strings.TrimSpace(*in.Timezone)
		if v != "" {
			// time/tzdata is linked in (internal/work/time.go), so this knows every zone on any host.
			if _, err := time.LoadLocation(v); err != nil || v == "Local" {
				return errBadTimezone
			}
		}
		tz = nullIfEmpty(v)
	}
	// $5/$6/$7 say whether each field was sent, so "not sent" and "cleared" stay different.
	_, err := db.ExecContext(ctx, `
		INSERT INTO user_profiles (user_id, name, locale, timezone) VALUES ($1, coalesce($2, ''), $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET
			name     = CASE WHEN $5 THEN coalesce($2, '') ELSE user_profiles.name END,
			locale   = CASE WHEN $6 THEN $3 ELSE user_profiles.locale END,
			timezone = CASE WHEN $7 THEN $4 ELSE user_profiles.timezone END,
			updated_at = now()`,
		userID, name, locale, tz, in.Name != nil, in.Locale != nil, in.Timezone != nil)
	return err
}

// SetAvatar stores a picture already produced by AvatarDataURL, or clears it ("" → NULL).
func SetAvatar(ctx context.Context, db *sql.DB, userID, dataURL string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO user_profiles (user_id, avatar) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET avatar = EXCLUDED.avatar, updated_at = now()`,
		userID, nullIfEmpty(dataURL))
	return err
}

func nullIfEmpty(s string) any {
	if s = strings.TrimSpace(s); s == "" {
		return nil
	}
	return s
}

// ---- email change ---------------------------------------------------------------------------

var (
	errWrongPassword = errors.New("current password incorrect")
	errSameEmail     = errors.New("that is already your address")
	errEmailTaken    = errors.New("that address can't be used")
)

// RequestEmailChange checks the password and mails a code to the NEW address. Proving the new
// inbox is the whole point: without it, a typo (or someone at an unlocked laptop) moves the
// account to an address its owner can't read, and the reset flow then sends their codes there.
//
// An address already in use gets no code and no error. Saying "taken" would let any signed-in
// account test whether an address is registered. The owner of a typo'd address simply never
// receives a code, and a code for it would be refused at confirm anyway.
//
// An account without a password proves itself with emailCode (reauth.go) instead; that code works
// once, so "same address" is refused before it is spent.
func (s *Service) RequestEmailChange(ctx context.Context, userID, password, emailCode, newEmail, locale string) error {
	newEmail = normEmail(newEmail)
	var current, hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT email, password_hash FROM users WHERE id = $1`, userID).Scan(&current, &hash); err != nil {
		return err
	}
	if !HasPassword(hash) && strings.EqualFold(current, newEmail) {
		return errSameEmail
	}
	if _, err := s.reauth(ctx, userID, password, emailCode); err != nil {
		return err
	}
	if strings.EqualFold(current, newEmail) {
		return errSameEmail
	}
	var taken bool
	if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = $1)`, newEmail).Scan(&taken); err != nil {
		return err
	}
	if taken {
		return nil
	}
	code, err := Issue(ctx, s.DB, userID, PurposeEmailChange, newEmail)
	if err != nil {
		return err
	}
	if s.Mail == nil {
		s.log().Warn("email change: no mail service, so the code was not sent", "user", userID)
		return nil
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := s.Mail.Send(ctx, emailChangeMail(newEmail, code, locale)); err != nil {
			s.log().Error("email change: send", "user", userID, "err", err)
		}
	}()
	return nil
}

// ConfirmEmailChange spends the code and moves the account to the address it was issued for.
func (s *Service) ConfirmEmailChange(ctx context.Context, userID, code, locale string) (string, error) {
	var old, next string
	err := Consume(ctx, s.DB, userID, PurposeEmailChange, strings.TrimSpace(code), func(tx *sql.Tx, target string) error {
		if err := tx.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&old); err != nil {
			return err
		}
		// The address was free when the code was sent, but someone may have registered it since.
		// The unique index on users.email is the final word; this only gives it a better message.
		var taken bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2)`, target, userID).Scan(&taken); err != nil {
			return err
		}
		if taken {
			return errEmailTaken
		}
		next = target
		if _, err := tx.ExecContext(ctx, `UPDATE users SET email = $2 WHERE id = $1`, userID, target); err != nil {
			return err
		}
		// The code went to the new address, so the new address is proven (MH-342).
		_, err := tx.ExecContext(ctx, `
			INSERT INTO platform_users (user_id, email_verified_at, updated_at) VALUES ($1, now(), now())
			ON CONFLICT (user_id) DO UPDATE SET email_verified_at = now(), updated_at = now()`, userID)
		return err
	})
	if err != nil {
		return "", err
	}
	platform.Invalidate(userID)
	if s.Mail != nil {
		// The OLD address is told. If this wasn't its owner, it's their one chance to notice
		// before the reset flow starts sending codes somewhere else.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.Mail.Send(ctx, emailChangedMail(old, next, locale)); err != nil {
				s.log().Error("email change: notice", "user", userID, "err", err)
			}
		}()
	}
	return next, nil
}

// ---- routes -----------------------------------------------------------------------------------

type profileOut struct {
	Body *Profile
}

var emailChangePerUser = ratelimit.Rate("email-change", 5, time.Hour)

// RegisterProfile mounts /api/me/profile, /avatar, /email and /token. The guard signs these in
// (tierSignedIn); none needs a workspace.
func RegisterProfile(api huma.API, s *Service) {
	const tag = "Account"
	huma.Register(api, huma.Operation{OperationID: "me-profile", Method: http.MethodGet, Path: "/api/me/profile",
		Summary: "Your profile", Tags: []string{tag}},
		func(ctx context.Context, _ *struct{}) (*profileOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			return s.profile(ctx, id)
		})

	huma.Register(api, huma.Operation{OperationID: "me-profile-update", Method: http.MethodPatch, Path: "/api/me/profile",
		Summary: "Change your name, language or timezone", Tags: []string{tag}},
		func(ctx context.Context, in *struct{ Body ProfilePatch }) (*profileOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if err := SaveProfile(ctx, s.DB, id, in.Body); err != nil {
				if errors.Is(err, errBadTimezone) {
					return nil, huma.Error422UnprocessableEntity(err.Error())
				}
				s.log().Error("profile save", "err", err)
				return nil, huma.Error500InternalServerError("could not save the profile")
			}
			return s.profile(ctx, id)
		})

	huma.Register(api, huma.Operation{OperationID: "me-avatar-upload", Method: http.MethodPost, Path: "/api/me/avatar",
		Summary: "Upload your picture (multipart field \"file\": JPEG, PNG or GIF, up to 10 MB)", Tags: []string{tag},
		Description:  "Cropped to a centred square, scaled to 256px and re-encoded as JPEG. Nothing else from the file is kept, EXIF location included.",
		MaxBodyBytes: 11 << 20},
		func(ctx context.Context, in *struct {
			RawBody huma.MultipartFormFiles[struct {
				File huma.FormFile `form:"file" required:"true"`
			}]
		}) (*profileOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if in.RawBody.Form == nil || len(in.RawBody.Form.File["file"]) == 0 {
				return nil, huma.Error422UnprocessableEntity("send the picture in the multipart field \"file\"")
			}
			f, err := in.RawBody.Form.File["file"][0].Open()
			if err != nil {
				return nil, huma.Error400BadRequest("could not read the upload")
			}
			defer f.Close()
			url, err := AvatarDataURL(f)
			switch {
			case errors.Is(err, ErrAvatarFormat):
				return nil, huma.Error415UnsupportedMediaType(err.Error())
			case errors.Is(err, ErrAvatarSize):
				return nil, huma.NewError(http.StatusRequestEntityTooLarge, err.Error())
			case err != nil:
				return nil, huma.Error400BadRequest("could not read the picture")
			}
			if err := SetAvatar(ctx, s.DB, id, url); err != nil {
				s.log().Error("avatar save", "err", err)
				return nil, huma.Error500InternalServerError("could not save the picture")
			}
			return s.profile(ctx, id)
		})

	huma.Register(api, huma.Operation{OperationID: "me-avatar-delete", Method: http.MethodDelete, Path: "/api/me/avatar",
		Summary: "Remove your picture", Tags: []string{tag}},
		func(ctx context.Context, _ *struct{}) (*profileOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if err := SetAvatar(ctx, s.DB, id, ""); err != nil {
				return nil, huma.Error500InternalServerError("could not remove the picture")
			}
			return s.profile(ctx, id)
		})

	huma.Register(api, huma.Operation{OperationID: "me-email-change", Method: http.MethodPost, Path: "/api/me/email",
		DefaultStatus: http.StatusAccepted, Summary: "Move your account to a new email address", Tags: []string{tag},
		Description: "Needs your password (an account without one: email_code, from POST /api/me/reauth/code). A six-digit code goes to the NEW address; confirm it with /api/me/email/confirm. Nothing changes until then."},
		func(ctx context.Context, in *struct {
			Body struct {
				Email     string `json:"email" format:"email" maxLength:"320"`
				Password  string `json:"password,omitempty" maxLength:"200" doc:"Required when the account has a password"`
				EmailCode string `json:"email_code,omitempty" maxLength:"6" doc:"Instead of the password, for an account without one: the code from POST /api/me/reauth/code"`
				Locale    string `json:"locale,omitempty" enum:"en,ar,"`
			}
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if s.Limit != nil {
				if ok, _ := s.Limit.Allow(ctx, id, emailChangePerUser); !ok {
					return nil, huma.Error429TooManyRequests("too many attempts; try again later")
				}
			}
			err = s.RequestEmailChange(ctx, id, in.Body.Password, in.Body.EmailCode, in.Body.Email, in.Body.Locale)
			if r := reauthRefusal(err); r != nil {
				return nil, r
			}
			switch {
			case errors.Is(err, errSameEmail):
				return nil, huma.Error422UnprocessableEntity(err.Error())
			case err != nil:
				s.log().Error("email change", "err", err)
				return nil, huma.Error500InternalServerError("could not start the change")
			}
			return nil, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-email-confirm", Method: http.MethodPost, Path: "/api/me/email/confirm",
		Summary: "Confirm a new email address with the code sent to it", Tags: []string{tag}},
		func(ctx context.Context, in *struct {
			Body struct {
				Code   string `json:"code" pattern:"^[0-9]{6}$"`
				Locale string `json:"locale,omitempty" enum:"en,ar,"`
			}
		}) (*profileOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			switch _, err := s.ConfirmEmailChange(ctx, id, in.Body.Code, in.Body.Locale); {
			case errors.Is(err, ErrInvalidCode):
				return nil, huma.Error400BadRequest(err.Error())
			case errors.Is(err, errEmailTaken):
				return nil, huma.Error409Conflict(err.Error())
			case err != nil:
				s.log().Error("email confirm", "err", err)
				return nil, huma.Error500InternalServerError("could not change the address")
			}
			return s.profile(ctx, id)
		})

	huma.Register(api, huma.Operation{OperationID: "me-token-revoke", Method: http.MethodDelete, Path: "/api/me/token",
		DefaultStatus: http.StatusNoContent, Tags: []string{tag},
		Summary:     "Revoke the personal access token this request is signed with",
		Description: "For signing out of an app: the app holds the token but not its id, so it can't use DELETE /api/auth/tokens/{id}. With a cookie session instead, this does nothing; use POST /api/auth/logout."},
		func(ctx context.Context, in *struct {
			Authorization string `header:"Authorization"`
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			tok := strings.TrimSpace(strings.TrimPrefix(in.Authorization, "Bearer "))
			if !strings.HasPrefix(tok, "togo_pat_") {
				return nil, nil
			}
			sum := sha256.Sum256([]byte(tok))
			// Scoped by user as well as hash. The guard has already proved the token is theirs,
			// but a delete that could ever reach someone else's row is not one to rely on that for.
			if _, err := s.DB.ExecContext(ctx, `DELETE FROM personal_access_tokens WHERE token_hash = $1 AND user_id = $2`,
				hex.EncodeToString(sum[:]), id); err != nil {
				return nil, huma.Error500InternalServerError("could not revoke the token")
			}
			return nil, nil
		})
}

func (s *Service) profile(ctx context.Context, userID string) (*profileOut, error) {
	p, err := LoadProfile(ctx, s.DB, userID)
	if err != nil {
		if errors.Is(err, platform.ErrNoUser) {
			return nil, huma.Error401Unauthorized("unauthorized")
		}
		return nil, huma.Error500InternalServerError("could not load the profile")
	}
	return &profileOut{Body: p}, nil
}

func who(ctx context.Context) (string, error) {
	id, ok := auth.IdentityFrom(ctx)
	if !ok || id == nil || id.ID == "" {
		return "", huma.Error401Unauthorized("unauthorized")
	}
	return id.ID, nil
}
