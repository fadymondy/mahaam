package account

// App sign-in: the desktop and mobile apps sign in with Google, GitHub or Apple in the SYSTEM
// browser and are redirected back — never an embedded web view, which the providers refuse and
// which would let the app see the person's provider password (RFC 8252, "OAuth 2.0 for Native
// Apps").
//
//  1. The app makes a PKCE verifier and opens <web>/<locale>/app-signin?redirect_uri=…&
//     code_challenge=…&state=…&device=… in the default browser.
//  2. The person signs in there however they like (the web's own sign-in, providers included)
//     and confirms "Continue to Mahaam for Mac".
//  3. The page calls POST /api/me/app-signin (signed in, CSRF-checked): a one-time code, two
//     minutes, bound to the challenge and the redirect, stored only as a hash.
//  4. The browser is sent to the app's redirect (a 127.0.0.1 port, or mahaam://auth/callback)
//     with the code and state.
//  5. The app calls POST /api/auth/app/token with the code and its verifier and gets its own
//     device token (a personal access token named for the device), revocable like any other.
//
// A code alone is useless without the verifier, which never left the app; a verifier alone is
// useless without a code, which only the signed-in person's click produces.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
	"github.com/togo-framework/ratelimit"
)

const appCodeTTL = 2 * time.Minute

var appTokenPerIP = ratelimit.Rate("app-signin-token-ip", 30, 15*time.Minute)

// validAppRedirect accepts exactly the two shapes our apps use:
//   - http://127.0.0.1:<any port>/callback (or localhost, [::1]) — the desktop app's loopback
//     listener; the port is ephemeral, so it cannot be pinned (RFC 8252 §7.3);
//   - mahaam://auth/callback — the mobile app (ASWebAuthenticationSession / Custom Tabs).
func validAppRedirect(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Fragment != "" || u.User != nil || u.RawQuery != "" {
		return false
	}
	switch u.Scheme {
	case "http":
		h := u.Hostname()
		return (h == "127.0.0.1" || h == "localhost" || h == "::1") && u.Port() != "" && u.Path == "/callback"
	case "mahaam":
		return u.Opaque == "" && u.Host == "auth" && u.Path == "/callback"
	}
	return false
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func pkceS256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// deviceLabel keeps the token name readable and bounded; it is shown in the person's device list.
func deviceLabel(name string) string {
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name))
	if name == "" {
		name = "Mahaam app"
	}
	if len([]rune(name)) > 120 {
		name = string([]rune(name)[:120])
	}
	return name
}

// mintDeviceToken issues a personal access token in the auth plugin's own format (auth@v0.8
// pat.go: "togo_pat_" + 40 hex, only the sha256 stored, empty abilities = the user's own access),
// replacing any earlier token of the same name so a device never accumulates rows.
func (s *Service) mintDeviceToken(ctx context.Context, userID, name string) (string, error) {
	plain := "togo_pat_" + randHex(16) + randHex(4)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM personal_access_tokens WHERE user_id = $1 AND name = $2`, userID, name); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO personal_access_tokens (id, user_id, name, token_hash, abilities, expires_at, created_at)
		VALUES ($1, $2, $3, $4, '', NULL, $5)`,
		randHex(16), userID, name, sha256Hex(plain), time.Now().UTC().Format(time.RFC3339)); err != nil {
		return "", err
	}
	return plain, tx.Commit()
}

type appSigninOut struct {
	Body struct {
		RedirectTo string `json:"redirect_to" doc:"Send the browser here: the app's redirect with code and state."`
	}
}

type appTokenOut struct {
	Body struct {
		Token string `json:"token" doc:"This device's personal access token. Returned once."`
		Email string `json:"email"`
	}
}

// RegisterAppSignin mounts POST /api/me/app-signin (signed in) and POST /api/auth/app/token
// (public: the code and its PKCE verifier are the credential).
func RegisterAppSignin(api huma.API, s *Service) {
	const tag = "Account"
	huma.Register(api, huma.Operation{OperationID: "me-app-signin", Method: http.MethodPost, Path: "/api/me/app-signin",
		Summary: "Hand this browser's sign-in to a Mahaam app", Tags: []string{tag},
		Description: "Called by the web's app sign-in page after the person confirms. Returns where to send the browser: the app's " +
			"redirect (a loopback port or mahaam://auth/callback) with a one-time code bound to the app's PKCE challenge."},
		func(ctx context.Context, in *struct {
			Body struct {
				RedirectURI         string `json:"redirect_uri" maxLength:"200"`
				CodeChallenge       string `json:"code_challenge" minLength:"43" maxLength:"128"`
				CodeChallengeMethod string `json:"code_challenge_method" enum:"S256"`
				State               string `json:"state" minLength:"16" maxLength:"128"`
				Device              string `json:"device" maxLength:"200"`
			}
		}) (*appSigninOut, error) {
			id, ok := auth.IdentityFrom(ctx)
			if !ok || id == nil {
				return nil, huma.Error401Unauthorized("unauthorized")
			}
			if !validAppRedirect(in.Body.RedirectURI) {
				return nil, huma.Error400BadRequest("that is not a Mahaam app's redirect")
			}
			code := "mas_" + randHex(24)
			if _, err := s.DB.ExecContext(ctx, `
				INSERT INTO app_signin_codes (code_hash, user_id, redirect_uri, code_challenge, device_name, expires_at)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				sha256Hex(code), id.ID, in.Body.RedirectURI, in.Body.CodeChallenge, deviceLabel(in.Body.Device), time.Now().Add(appCodeTTL)); err != nil {
				s.log().Error("app sign-in code", "err", err)
				return nil, huma.Error500InternalServerError("could not start the app sign-in")
			}
			// Housekeeping: expired codes are useless; drop them as new ones are made.
			_, _ = s.DB.ExecContext(ctx, `DELETE FROM app_signin_codes WHERE expires_at < now() - interval '1 hour'`)
			dest, _ := url.Parse(in.Body.RedirectURI)
			q := url.Values{}
			q.Set("code", code)
			q.Set("state", in.Body.State)
			dest.RawQuery = q.Encode()
			out := &appSigninOut{}
			out.Body.RedirectTo = dest.String()
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "auth-app-token", Method: http.MethodPost, Path: "/api/auth/app/token",
		Summary: "Trade an app sign-in code for this device's token", Tags: []string{tag},
		Description: "The last step of signing a Mahaam app in through the browser: the one-time code from the redirect and the PKCE " +
			"verifier the app kept. Returns a personal access token named for the device.",
		Middlewares: huma.Middlewares{s.limit(appTokenPerIP)}},
		func(ctx context.Context, in *struct {
			Body struct {
				Code         string `json:"code" minLength:"1" maxLength:"128"`
				CodeVerifier string `json:"code_verifier" minLength:"43" maxLength:"128"`
				RedirectURI  string `json:"redirect_uri" maxLength:"200"`
			}
		}) (*appTokenOut, error) {
			var userID, redirect, challenge, device string
			var expires time.Time
			// Looked up first, consumed only once every check passes, so a wrong verifier cannot
			// burn the legitimate app's code.
			err := s.DB.QueryRowContext(ctx, `
				SELECT user_id, redirect_uri, code_challenge, device_name, expires_at FROM app_signin_codes WHERE code_hash = $1`,
				sha256Hex(in.Body.Code)).Scan(&userID, &redirect, &challenge, &device, &expires)
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error400BadRequest("unknown or already-used code")
			}
			if err != nil {
				s.log().Error("app sign-in token", "err", err)
				return nil, huma.Error500InternalServerError("something went wrong")
			}
			if time.Now().After(expires) {
				return nil, huma.Error400BadRequest("the code expired — sign in again")
			}
			if in.Body.RedirectURI != redirect || pkceS256(in.Body.CodeVerifier) != challenge {
				return nil, huma.Error400BadRequest("the code does not belong to this sign-in")
			}
			res, err := s.DB.ExecContext(ctx, `DELETE FROM app_signin_codes WHERE code_hash = $1`, sha256Hex(in.Body.Code))
			if err != nil {
				return nil, huma.Error500InternalServerError("something went wrong")
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return nil, huma.Error400BadRequest("unknown or already-used code")
			}
			id, err := s.identity(ctx, userID)
			if err != nil {
				return nil, huma.Error400BadRequest("the account is gone")
			}
			token, err := s.mintDeviceToken(ctx, userID, device)
			if err != nil {
				s.log().Error("app sign-in mint", "err", err)
				return nil, huma.Error500InternalServerError("could not issue the device token")
			}
			out := &appTokenOut{}
			out.Body.Token, out.Body.Email = token, id.Email
			return out, nil
		})
}
