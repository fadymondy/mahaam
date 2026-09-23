package account

/*
Re-authentication for accounts without a password.

Accounts made by Sign in with Apple, Google or GitHub have no password (users.password_hash is the
auth plugin's "!sso", which no bcrypt comparison can match). The account routes that ask "is this
really you?" by password (delete the account, change the email address, set up / turn off
two-factor sign-in, replace recovery codes) would otherwise be closed to them, and App Store
guideline 5.1.1(v) requires that an app's accounts can be deleted from inside the app.

For those accounts the proof is a six-digit code mailed to the account's address:

	POST /api/me/reauth/code {locale?} → 202 {email, expires_in}

and each of those routes then takes {email_code} where a password account sends {password}. The code
is the same machinery as a password reset (account_codes, purpose "reauth"): HMAC'd under
MAHAAM_SECRET_KEY, 10 minutes, 5 wrong tries burn it, one live code per person, spent by the one
action it is used for. Two-factor sign-in, when on, is asked for on top, exactly as for a password.

Password accounts are unchanged: they keep sending the password, and asking for a code answers 409
has_password, so the email code is never a second, weaker way into an account that has a password.
*/

import (
	"context"
	"errors"
	"html"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/mail"
	"github.com/togo-framework/ratelimit"
	"golang.org/x/crypto/bcrypt"
)

// PurposeReauth is the code that stands in for a password on a passwordless account.
const PurposeReauth Purpose = "reauth"

var reauthPerUser = ratelimit.Rate("reauth-code", 5, 15*time.Minute)

var (
	errReauthRequired = errors.New("this account has no password: ask for a code (POST /api/me/reauth/code) and send it as email_code")
	errHasPassword    = errors.New("this account has a password: confirm with the password instead")
)

// HasPassword reports whether a stored hash is a real password (the auth plugin stores bcrypt;
// "!sso" marks an Apple/Google/GitHub account and "!" an anonymised one).
func HasPassword(hash string) bool { return strings.HasPrefix(hash, "$2") }

// reauth proves it is the account's owner: the password for an account that has one, the mailed
// code (spent here) for one that doesn't. Returns the account's email.
func (s *Service) reauth(ctx context.Context, userID, password, emailCode string) (string, error) {
	var email, hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT email, password_hash FROM users WHERE id = $1`, userID).Scan(&email, &hash); err != nil {
		return "", err
	}
	if HasPassword(hash) {
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
			return "", errWrongPassword
		}
		return email, nil
	}
	if strings.TrimSpace(emailCode) == "" {
		return "", errReauthRequired
	}
	if err := Consume(ctx, s.DB, userID, PurposeReauth, strings.TrimSpace(emailCode), nil); err != nil {
		return "", err
	}
	return email, nil
}

// passwordless reports whether the account proves itself by email code (a read, nothing spent).
func (s *Service) passwordless(ctx context.Context, userID string) (bool, error) {
	var hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		return false, err
	}
	return !HasPassword(hash), nil
}

// reauthRefusal maps the re-authentication errors to their answers, or returns nil.
func reauthRefusal(err error) error {
	switch {
	case errors.Is(err, errWrongPassword):
		return huma.Error403Forbidden(err.Error())
	case errors.Is(err, errReauthRequired):
		return &Refusal{Status: http.StatusForbidden, Code: "reauth_required", Msg: err.Error()}
	case errors.Is(err, ErrInvalidCode):
		return &Refusal{Status: http.StatusForbidden, Code: "invalid_code", Msg: err.Error()}
	}
	return nil
}

// SendReauthCode mails a fresh code to a passwordless account's address.
func (s *Service) SendReauthCode(ctx context.Context, userID, locale string) (string, error) {
	var email, hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT email, password_hash FROM users WHERE id = $1`, userID).Scan(&email, &hash); err != nil {
		return "", err
	}
	if HasPassword(hash) {
		return "", errHasPassword
	}
	code, err := Issue(ctx, s.DB, userID, PurposeReauth, "")
	if err != nil {
		return "", err
	}
	if s.Mail == nil {
		s.log().Warn("reauth: no mail service, so the code was not sent", "user", userID)
		return email, nil
	}
	s.mailAsync(reauthMail(email, code, locale), "reauth code", userID)
	return email, nil
}

type reauthOut struct {
	Body struct {
		Email     string `json:"email" doc:"Where the code went: the account's address"`
		ExpiresIn int    `json:"expires_in" doc:"Seconds the code works for"`
	}
}

// RegisterReauth mounts POST /api/me/reauth/code (signed in).
func RegisterReauth(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{OperationID: "me-reauth-code", Method: http.MethodPost, Path: "/api/me/reauth/code",
		DefaultStatus: http.StatusAccepted, Tags: []string{"Account"},
		Summary: "Email a code that confirms it's you (accounts without a password)",
		Description: "For accounts made with Apple, Google or GitHub, which have no password (GET /api/me/profile has_password false). " +
			"Mails a six-digit code to the account's address; send it as email_code to POST /api/me/delete, /api/me/email, " +
			"/api/me/2fa/enroll, /api/me/2fa/disable or /api/me/2fa/recovery-codes. It works once, for 10 minutes and 5 tries; asking " +
			"again replaces it. An account with a password gets 409 has_password: those routes take the password.",
		Errors: []int{http.StatusConflict, http.StatusTooManyRequests}},
		func(ctx context.Context, in *struct {
			Body struct {
				Locale string `json:"locale,omitempty" enum:"en,ar," doc:"Language of the email. Default en."`
			}
		}) (*reauthOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if s.Limit != nil {
				if ok, _ := s.Limit.Allow(ctx, id, reauthPerUser); !ok {
					return nil, huma.Error429TooManyRequests("too many codes asked for; try again later")
				}
			}
			email, err := s.SendReauthCode(ctx, id, in.Body.Locale)
			switch {
			case errors.Is(err, errHasPassword):
				return nil, &Refusal{Status: http.StatusConflict, Code: "has_password", Msg: err.Error()}
			case err != nil:
				s.log().Error("reauth code", "err", err)
				return nil, huma.Error500InternalServerError("could not send the code")
			}
			out := &reauthOut{}
			out.Body.Email, out.Body.ExpiresIn = email, int(CodeTTL/time.Second)
			return out, nil
		})
}

var reauthTexts = map[string][4]string{
	"en": {"Your Mahaam confirmation code", "Enter this code in Mahaam to confirm it's you:",
		"It works for 10 minutes, once.",
		"If you didn't ask for this, someone may be signed in to your Mahaam account: sign out everywhere from your account settings, and secure this inbox."},
	"ar": {"رمز التأكيد في مهام", "أدخل هذا الرمز في مهام لتأكيد أنك صاحب الحساب:",
		"صالح لمدة 10 دقائق، ولمرة واحدة.",
		"إن لم تطلب ذلك، فقد يكون أحدهم مسجلاً الدخول إلى حسابك في مهام: سجّل الخروج من كل الأجهزة من إعدادات حسابك، وأمّن هذا البريد."},
}

func reauthMail(to, code, locale string) mail.Message {
	t, ok := reauthTexts[locale]
	if !ok {
		locale, t = "en", reauthTexts["en"]
	}
	text := t[1] + "\n\n    " + code + "\n\n" + t[2] + "\n\n" + t[3] + "\n"
	body := `<p>` + html.EscapeString(t[1]) + `</p>` +
		`<p dir="ltr" style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,monospace">` + html.EscapeString(code) + `</p>` +
		`<p>` + html.EscapeString(t[2]) + `</p><p style="color:#666">` + html.EscapeString(t[3]) + `</p>`
	return mail.Message{To: []string{to}, Subject: t[0], Text: text, HTML: page(locale, body)}
}
