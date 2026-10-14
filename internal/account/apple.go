package account

// Native Sign in with Apple (App Store guideline 4.8: an app that offers Google or GitHub sign-in
// must offer Apple's too). The iOS app runs the native Apple sheet, gets an identity token, and
// posts it here with the raw nonce; there is no browser and no redirect.
//
//	POST /api/auth/apple {identity_token, nonce, name?, device_name?, locale?}
//	  → 200 {token, user[, access_token]}          — the same shape as POST /api/auth/login
//	  → 401 {code: "mfa_required", challenge, …}    — finish at POST /api/auth/2fa/challenge
//	  → 403 {code: "account_suspended"}
//
// Who the person is: Apple's `sub`, kept in user_identities. The first time a subject is seen, an
// account whose email matches the token's VERIFIED email is linked; otherwise a new passwordless
// account is made (password_hash "!sso", like the auth plugin's OAuth accounts), with the name
// Apple sends only on that first authorization and the email marked verified. The email may be a
// private relay address (…@privaterelay.appleid.com); it stays the account's address.

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
	"github.com/togo-framework/ratelimit"

	"github.com/fadymondy/mahaam/internal/platform"
)

var applePerIP = ratelimit.Rate("apple-signin-ip", 30, 15*time.Minute)

var (
	errAppleNoEmail    = ErrSocialNoEmail
	errAppleEmailTaken = ErrSocialEmailTaken
)

// AppleName is the name Apple shares on the first authorization only.
type AppleName struct {
	Given  string `json:"given,omitempty" maxLength:"100"`
	Family string `json:"family,omitempty" maxLength:"100"`
}

type appleIn struct {
	Body struct {
		IdentityToken string     `json:"identity_token" minLength:"1" maxLength:"8192" doc:"The identityToken from the Apple authorization."`
		Nonce         string     `json:"nonce" minLength:"16" maxLength:"256" doc:"The RAW nonce. The authorization request must have carried its SHA-256, lowercase hex."`
		Name          *AppleName `json:"name,omitempty" doc:"fullName from the authorization. Apple sends it the first time only."`
		DeviceName    string     `json:"device_name,omitempty" maxLength:"200" doc:"Set it to also get access_token: a personal access token named for this device."`
		Locale        string     `json:"locale,omitempty" enum:"en,ar," doc:"Saved on a new account's profile."`
		// The server trades it for a refresh token, kept only to revoke the grant when the account
		// is deleted (App Store 5.1.1(v)). Optional: without it, or without the Apple key configured,
		// sign-in works and deletion can't revoke.
		AuthorizationCode string `json:"authorization_code,omitempty" maxLength:"4096" doc:"The authorizationCode from the Apple authorization. Lets account deletion revoke the Sign in with Apple grant."`
	}
}

type appleOut struct {
	Body struct {
		Token       string         `json:"token" doc:"The session token (JWT), as POST /api/auth/login returns it. Use it as a Bearer token."`
		User        *auth.Identity `json:"user"`
		AccessToken string         `json:"access_token,omitempty" doc:"Only with device_name: this device's personal access token, returned once. Hold it instead of the session token."`
		Created     bool           `json:"created" doc:"A new account was made by this sign-in."`
	}
}

// MFARefusal is the 401 a sign-in gets when the account has a second factor: the same body the
// guard gives POST /api/auth/login (server/guard.go askSecondFactor).
type MFARefusal struct {
	Msg         string   `json:"error"`
	Code        string   `json:"code"`
	MFARequired bool     `json:"mfa_required"`
	Challenge   string   `json:"challenge"`
	Methods     []string `json:"methods"`
}

func (e *MFARefusal) Error() string  { return e.Msg }
func (e *MFARefusal) GetStatus() int { return http.StatusUnauthorized }

// NewMFARefusal wraps a challenge.
func NewMFARefusal(challenge string) *MFARefusal {
	return &MFARefusal{Msg: "enter the code from your authenticator app", Code: "mfa_required", MFARequired: true,
		Challenge: challenge, Methods: []string{"totp", "recovery_code"}}
}

// RegisterApple mounts POST /api/auth/apple (public: the Apple-signed token is the credential).
func RegisterApple(api huma.API, s *Service) {
	if s.Apple == nil {
		s.Apple = NewAppleVerifier()
	}
	huma.Register(api, huma.Operation{OperationID: "auth-apple", Method: http.MethodPost, Path: "/api/auth/apple",
		Summary: "Sign in with Apple (native apps)", Tags: []string{"Account"},
		Description: "For the iOS app's native Sign in with Apple. Send the identity token and the raw nonce (the authorization request carries " +
			"its SHA-256, lowercase hex). Returns {token, user} like POST /api/auth/login; with device_name, also access_token (a personal " +
			"access token for this device). An account with two-factor sign-in answers 401 {code: mfa_required, challenge}: finish at " +
			"POST /api/auth/2fa/challenge. A suspended account gets 403 account_suspended. A token is accepted once.",
		Errors:      []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusConflict, http.StatusTooManyRequests},
		Middlewares: huma.Middlewares{s.limit(applePerIP)}},
		func(ctx context.Context, in *appleIn) (*appleOut, error) {
			if s.Auth == nil || s.DB == nil {
				return nil, huma.Error503ServiceUnavailable("sign-in is unavailable")
			}
			c, err := s.Apple.Verify(ctx, in.Body.IdentityToken, in.Body.Nonce)
			if err != nil {
				s.log().Info("apple sign-in refused", "err", err)
				if errors.Is(err, ErrAppleNonce) {
					return nil, huma.Error401Unauthorized(ErrAppleNonce.Error())
				}
				return nil, huma.Error401Unauthorized(ErrAppleToken.Error())
			}
			if ok, err := s.spendNonce(ctx, sha256Hex(in.Body.Nonce), c.ExpiresAt); err != nil {
				s.log().Error("apple sign-in nonce", "err", err)
				return nil, huma.Error500InternalServerError("something went wrong")
			} else if !ok {
				return nil, huma.Error401Unauthorized("this Apple sign-in was already used; sign in again")
			}

			name := ""
			if in.Body.Name != nil {
				name = strings.TrimSpace(in.Body.Name.Given + " " + in.Body.Name.Family)
			}
			userID, created, err := s.appleAccount(ctx, c, cleanName(name), in.Body.Locale)
			switch {
			case errors.Is(err, errAppleNoEmail):
				return nil, &Refusal{Status: http.StatusBadRequest, Code: "email_required", Msg: err.Error()}
			case errors.Is(err, errAppleEmailTaken):
				return nil, &Refusal{Status: http.StatusConflict, Code: "account_exists", Msg: err.Error()}
			case err != nil:
				s.log().Error("apple sign-in account", "err", err)
				return nil, huma.Error500InternalServerError("something went wrong")
			}

			s.KeepAppleToken(ctx, c.Subject, c.Audience, in.Body.AuthorizationCode, "")

			// The same gates as a password sign-in (server/guard.go): suspended accounts don't get in,
			// and a second factor is asked for before any token is issued.
			u, err := platform.Load(ctx, s.DB, userID)
			if err != nil || u.DeletedAt != nil {
				return nil, huma.Error401Unauthorized("unauthorized")
			}
			if u.Suspended() {
				return nil, &Refusal{Status: http.StatusForbidden, Code: "account_suspended", Msg: u.SuspendedMessage()}
			}
			if TwoFAEnabled(ctx, s.DB, userID) {
				ch, err := s.SignInChallenge(ctx, userID)
				if err != nil {
					s.log().Error("apple sign-in challenge", "err", err)
					return nil, huma.Error500InternalServerError("something went wrong")
				}
				return nil, NewMFARefusal(ch)
			}

			id, err := s.identity(ctx, userID)
			if err != nil {
				return nil, huma.Error401Unauthorized("unauthorized")
			}
			token, err := s.Auth.IssueToken(*id)
			if err != nil {
				s.log().Error("apple sign-in token", "err", err)
				return nil, huma.Error500InternalServerError("could not sign you in")
			}
			out := &appleOut{}
			out.Body.Token, out.Body.User, out.Body.Created = token, id, created
			if strings.TrimSpace(in.Body.DeviceName) != "" {
				pat, err := s.mintDeviceToken(ctx, userID, deviceLabel(in.Body.DeviceName))
				if err != nil {
					s.log().Error("apple sign-in device token", "err", err)
					return nil, huma.Error500InternalServerError("could not issue the device token")
				}
				out.Body.AccessToken = pat
			}
			return out, nil
		})
}

// spendNonce records a nonce as used and reports whether it was new. Kept until the token it came
// with expires (plus the verifier's leeway); after that the token itself is refused.
func (s *Service) spendNonce(ctx context.Context, nonceHash string, exp time.Time) (bool, error) {
	if exp.IsZero() || exp.Before(time.Now()) {
		exp = time.Now()
	}
	res, err := s.DB.ExecContext(ctx, `INSERT INTO signin_nonces (nonce_hash, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		nonceHash, exp.Add(time.Minute))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM signin_nonces WHERE expires_at < now()`)
	return n == 1, nil
}

// appleAccount finds the account for a verified Apple identity (identities.go).
func (s *Service) appleAccount(ctx context.Context, c *AppleClaims, name, locale string) (userID string, created bool, err error) {
	return s.SocialAccount(ctx, SocialIdentity{Provider: "apple", Subject: c.Subject, Email: c.Email,
		EmailVerified: c.EmailVerified, Name: name}, locale)
}

// cleanName drops control characters and caps the length at the profile's 120.
func cleanName(name string) string {
	name = strings.Join(strings.FieldsFunc(name, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }), " ")
	if r := []rune(name); len(r) > 120 {
		name = strings.TrimSpace(string(r[:120]))
	}
	return name
}
