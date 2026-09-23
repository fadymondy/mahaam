package account

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
	"github.com/togo-framework/ratelimit"
)

type twoFAStateOut struct{ Body TwoFAState }

type recoveryOut struct {
	Body struct {
		RecoveryCodes []string `json:"recovery_codes" doc:"Shown once. Each works once, in place of a code."`
	}
}

var challengePerIP = ratelimit.Rate("2fa-challenge-ip", 30, 15*time.Minute)

// twoFAError maps the 2FA errors to statuses.
func (s *Service) twoFAError(err error) error {
	if r := reauthRefusal(err); r != nil {
		return r
	}
	switch {
	case errors.Is(err, ErrTOTPInvalid):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, ErrTOTPLocked):
		return huma.Error429TooManyRequests(err.Error())
	case errors.Is(err, ErrTOTPNotEnabled), errors.Is(err, ErrTOTPNotEnrolled), errors.Is(err, ErrTOTPEnabled):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, ErrChallenge):
		return huma.Error401Unauthorized(err.Error())
	}
	s.log().Error("2fa", "err", err)
	return huma.Error500InternalServerError("something went wrong")
}

// RegisterTwoFA mounts /api/me/2fa/* (signed in) and POST /api/auth/2fa/challenge (public: the
// challenge is the credential).
func RegisterTwoFA(api huma.API, s *Service) {
	const tag = "Account"
	huma.Register(api, huma.Operation{OperationID: "me-2fa", Method: http.MethodGet, Path: "/api/me/2fa",
		Summary: "Your two-factor sign-in", Tags: []string{tag}},
		func(ctx context.Context, _ *struct{}) (*twoFAStateOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			st, err := s.TwoFA(ctx, id)
			if err != nil {
				return nil, s.twoFAError(err)
			}
			return &twoFAStateOut{Body: st}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-2fa-enroll", Method: http.MethodPost, Path: "/api/me/2fa/enroll",
		Summary: "Start setting up two-factor sign-in", Tags: []string{tag},
		Description: "Needs your password (an account without one: email_code, from POST /api/me/reauth/code). Returns the secret and an otpauth:// link (show it as a QR code, or open it on the same phone). Nothing is enforced until /api/me/2fa/confirm."},
		func(ctx context.Context, in *struct {
			Body struct {
				Password  string `json:"password,omitempty" maxLength:"200" doc:"Required when the account has a password"`
				EmailCode string `json:"email_code,omitempty" maxLength:"6" doc:"Instead of the password, for an account without one: the code from POST /api/me/reauth/code"`
			}
		}) (*struct {
			Body struct {
				Secret     string `json:"secret" doc:"Base32, for typing into an authenticator by hand"`
				OtpauthURL string `json:"otpauth_url"`
			}
		}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			secret, uri, err := s.Enroll(ctx, id, in.Body.Password, in.Body.EmailCode)
			if err != nil {
				return nil, s.twoFAError(err)
			}
			out := &struct {
				Body struct {
					Secret     string `json:"secret" doc:"Base32, for typing into an authenticator by hand"`
					OtpauthURL string `json:"otpauth_url"`
				}
			}{}
			out.Body.Secret, out.Body.OtpauthURL = secret, uri
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-2fa-confirm", Method: http.MethodPost, Path: "/api/me/2fa/confirm",
		Summary: "Turn two-factor sign-in on with the first code", Tags: []string{tag}},
		func(ctx context.Context, in *struct {
			Body struct {
				Code string `json:"code" pattern:"^[0-9]{6}$"`
			}
		}) (*recoveryOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			codes, err := s.Confirm(ctx, id, in.Body.Code)
			if err != nil {
				return nil, s.twoFAError(err)
			}
			out := &recoveryOut{}
			out.Body.RecoveryCodes = codes
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-2fa-recovery", Method: http.MethodPost, Path: "/api/me/2fa/recovery-codes",
		Summary: "Replace your recovery codes", Tags: []string{tag},
		Description: "Needs your password (an account without one: email_code, from POST /api/me/reauth/code) and a current code."},
		func(ctx context.Context, in *struct {
			Body struct {
				Password  string `json:"password,omitempty" maxLength:"200" doc:"Required when the account has a password"`
				EmailCode string `json:"email_code,omitempty" maxLength:"6" doc:"Instead of the password, for an account without one: the code from POST /api/me/reauth/code"`
				Code      string `json:"code" pattern:"^[0-9]{6}$"`
			}
		}) (*recoveryOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			codes, err := s.RegenerateRecovery(ctx, id, in.Body.Password, in.Body.EmailCode, in.Body.Code)
			if err != nil {
				return nil, s.twoFAError(err)
			}
			out := &recoveryOut{}
			out.Body.RecoveryCodes = codes
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-2fa-disable", Method: http.MethodPost, Path: "/api/me/2fa/disable",
		DefaultStatus: http.StatusNoContent, Summary: "Turn two-factor sign-in off", Tags: []string{tag},
		Description: "Needs your password (an account without one: email_code, from POST /api/me/reauth/code) and a current code (or a recovery code)."},
		func(ctx context.Context, in *struct {
			Body struct {
				Password     string `json:"password,omitempty" maxLength:"200" doc:"Required when the account has a password"`
				EmailCode    string `json:"email_code,omitempty" maxLength:"6" doc:"Instead of the password, for an account without one: the code from POST /api/me/reauth/code"`
				Code         string `json:"code,omitempty" maxLength:"6"`
				RecoveryCode string `json:"recovery_code,omitempty" maxLength:"20"`
			}
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if err := s.DisableTwoFA(ctx, id, in.Body.Password, in.Body.EmailCode, in.Body.Code, in.Body.RecoveryCode); err != nil {
				return nil, s.twoFAError(err)
			}
			return nil, nil
		})

	huma.Register(api, huma.Operation{OperationID: "auth-2fa-challenge", Method: http.MethodPost, Path: "/api/auth/2fa/challenge",
		Summary: "Finish signing in with a two-factor code", Tags: []string{tag},
		Description: "The second step after POST /api/auth/login answered 401 {code: mfa_required, challenge}. Send the challenge with a code from the " +
			"authenticator, or a recovery code. Returns the session token (use it as a Bearer token), and for a browser that sent the CSRF " +
			"header, also sets the session cookie.",
		Middlewares: huma.Middlewares{s.limit(challengePerIP)}},
		func(ctx context.Context, in *struct {
			CSRFHeader string `header:"X-CSRF-Token"`
			CSRFCookie string `cookie:"togo_csrf"`
			Body       struct {
				Challenge    string `json:"challenge" minLength:"1" maxLength:"4096"`
				Code         string `json:"code,omitempty" maxLength:"6"`
				RecoveryCode string `json:"recovery_code,omitempty" maxLength:"20"`
			}
		}) (*challengeOut, error) {
			if s.Auth == nil {
				return nil, huma.Error503ServiceUnavailable("sign-in is unavailable")
			}
			userID, err := s.OpenChallenge(ctx, in.Body.Challenge)
			if err != nil {
				return nil, s.twoFAError(err)
			}
			if err := s.SecondFactor(ctx, userID, in.Body.Code, in.Body.RecoveryCode); err != nil {
				return nil, s.twoFAError(err)
			}
			id, err := s.identity(ctx, userID)
			if err != nil {
				return nil, s.twoFAError(err)
			}
			token, err := s.Auth.IssueToken(*id)
			if err != nil {
				return nil, s.twoFAError(err)
			}
			out := &challengeOut{}
			out.Body.Token, out.Body.User = token, id
			// The cookie only for a browser that proved it's the page that asked: the CSRF cookie
			// echoed in the header. Without that check, a form on another site could post someone
			// else's challenge and code and sign the visitor's browser into the other account.
			if in.CSRFHeader != "" && subtle.ConstantTimeCompare([]byte(in.CSRFHeader), []byte(in.CSRFCookie)) == 1 {
				out.SetCookie = sessionCookie(token)
			}
			return out, nil
		})
}

type challengeOut struct {
	SetCookie *http.Cookie `header:"Set-Cookie"`
	Body      struct {
		Token string         `json:"token"`
		User  *auth.Identity `json:"user"`
	}
}

// identity is what the auth plugin would put in the token for this user (auth@v0.8.0 store.go,
// which doesn't export it): the users row's roles and permissions, under the default "api" guard.
func (s *Service) identity(ctx context.Context, userID string) (*auth.Identity, error) {
	var email, roles, perms string
	if err := s.DB.QueryRowContext(ctx, `SELECT email, roles, permissions FROM users WHERE id = $1`, userID).Scan(&email, &roles, &perms); err != nil {
		return nil, err
	}
	split := func(v string) []string {
		out := []string{}
		for _, p := range strings.Split(v, ",") {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	return &auth.Identity{ID: userID, Email: email, Roles: split(roles), Permissions: split(perms), Guard: "api"}, nil
}

// sessionCookie is the auth plugin's session cookie (auth@v0.8.0 security.go, unexported), for the
// default stateless SESSION_DRIVER=cookie, where the cookie holds the token itself. That is what
// Mahaam runs. A server-side session driver would need its store, which the plugin doesn't expose;
// there the token in the body still works as a Bearer token.
func sessionCookie(token string) *http.Cookie {
	ttl := 24 * time.Hour
	if n, err := strconv.Atoi(os.Getenv("AUTH_TTL_HOURS")); err == nil && n > 0 {
		ttl = time.Duration(n) * time.Hour
	}
	secure := false
	if v := os.Getenv("COOKIE_SECURE"); v != "" {
		secure = v == "1" || v == "true"
	} else {
		for _, k := range []string{"APP_ENV", "ENV", "TOGO_ENV"} {
			if e := strings.ToLower(os.Getenv(k)); e != "" {
				secure = e == "production" || e == "prod"
				break
			}
		}
	}
	if d := os.Getenv("SESSION_DRIVER"); d != "" && d != "cookie" {
		return nil
	}
	return &http.Cookie{Name: auth.SessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: secure,
		SameSite: http.SameSiteLaxMode, MaxAge: int(ttl.Seconds())}
}
