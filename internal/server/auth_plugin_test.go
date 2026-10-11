package server

/*
TestAuthPluginSurface: what the auth plugin (togo-framework/auth v0.10.0) adds, against the real
stack.

 1. The plugin's admin API, impersonation and TOTP disable are closed (404), even to a platform
    admin: users.roles = 'admin' is exactly what the plugin's admin API asks for.
 2. POST /api/auth/password/forgot and /api/auth/2fa/challenge are Mahaam's handlers, not the
    plugin's same-path ones (auth v0.9.0): a reset lands in account_codes, not auth_password_resets.
 3. A native client (no cookies, no Origin) signs in without a CSRF token (auth v0.9.4); a
    browser-shaped request (Origin, no token) is still refused.
 4. Emails match regardless of case and surrounding space (auth v0.9.5), and Mahaam's 2FA
    challenge follows the plugin there: a differently-cased email still gets the challenge.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run AuthPluginSurface -v
*/

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/platform"
)

func TestAuthPluginSurface(t *testing.T) {
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", t.TempDir())
	a, srv := bootStack(t)
	adm, admID, _ := signup(t, a, srv.URL, "authp-admin")
	_, userID, email := signup(t, a, srv.URL, "authp-user")

	// 1. Closed, even to a platform admin.
	if _, err := a.SysDB.Exec(`UPDATE users SET roles = 'admin' WHERE id = $1`, admID); err != nil {
		t.Fatal(err)
	}
	platform.Invalidate(admID)
	if got := adm.must("GET", "/api/me/platform", nil, 200)["is_admin"]; got != true {
		t.Fatalf("promotion did not take: %v", got)
	}
	for _, p := range []struct{ method, path string }{
		{"GET", "/api/auth/admin/users"},
		{"GET", "/api/auth/admin/users/" + userID},
		{"POST", "/api/auth/admin/users"},
		{"PATCH", "/api/auth/admin/users/" + userID},
		{"DELETE", "/api/auth/admin/users/" + userID},
		{"POST", "/api/auth/admin/users/" + userID + "/impersonate"},
		{"POST", "/api/auth/admin/users/" + userID + "/reset-password"},
		{"POST", "/api/auth/admin/users/" + userID + "/magic-link"},
		{"POST", "/api/auth/impersonation/stop"},
		{"POST", "/api/auth/2fa/disable"},
		{"GET", "/api/auth/magic?token=x"},
	} {
		if code, b := adm.do(p.method, p.path, map[string]string{}); code != 404 {
			t.Errorf("%s %s as a platform admin: %d %s, want 404", p.method, p.path, code, b)
		}
	}

	// 2. Mahaam's reset, not the plugin's.
	anon := newClient(t, srv.URL)
	anon.must("POST", "/api/auth/password/forgot", map[string]string{"email": email}, 202)
	var codes, pluginResets int
	// Mahaam sends the reset off the request path (internal/account/password.go), so wait for it.
	for deadline := time.Now().Add(5 * time.Second); codes == 0 && time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if err := a.SysDB.QueryRow(`SELECT count(*) FROM account_codes WHERE user_id = $1 AND purpose = 'password_reset'`, userID).Scan(&codes); err != nil {
			t.Fatal(err)
		}
	}
	if codes != 1 {
		t.Errorf("Mahaam's forgot handler did not run: %d account_codes rows", codes)
	}
	// The plugin creates its table at boot; zero rows means its handler never ran.
	if err := a.SysDB.QueryRow(`SELECT count(*) FROM auth_password_resets`).Scan(&pluginResets); err != nil {
		t.Fatal(err)
	}
	if pluginResets != 0 {
		t.Errorf("the plugin's forgot handler ran: %d auth_password_resets rows", pluginResets)
	}
	// The plugin's challenge handler would answer a sealed-box-shaped challenge 401 as well, but
	// only Mahaam's names its field errors through Huma (422 for a missing body field).
	if code, b := anon.do("POST", "/api/auth/2fa/challenge", map[string]string{}); code != 422 {
		t.Errorf("POST /api/auth/2fa/challenge with no fields: %d %s, want Mahaam's 422", code, b)
	}

	// 3. Native client: no cookie jar, no Origin, no CSRF token.
	native := func(origin, mail string) (int, map[string]any) {
		b, _ := json.Marshal(map[string]string{"email": mail, "password": "correct-horse-9"})
		req, _ := http.NewRequest("POST", srv.URL+"/api/auth/login", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, _ := io.ReadAll(res.Body)
		out := map[string]any{}
		_ = json.Unmarshal(raw, &out)
		return res.StatusCode, out
	}
	code, out := native("", email)
	tok, _ := out["token"].(string)
	if code != 200 || tok == "" {
		t.Fatalf("native sign-in: %d %v", code, out)
	}
	app := newClient(t, srv.URL)
	app.bearer = tok
	if me := app.must("GET", "/api/auth/me", nil, 200); me["id"] != userID {
		t.Errorf("/api/auth/me with the native token: %v", me)
	}
	if code, _ := native("https://evil.example", email); code != 403 {
		t.Errorf("a cross-site browser sign-in without a CSRF token: %d, want 403", code)
	}

	// 4. Case and space: the plugin signs in "  USER@…  ", so Mahaam's 2FA must catch it too.
	shouty := "  " + strings.ToUpper(email) + " "
	if code, out := native("", shouty); code != 200 || out["token"] == nil {
		t.Fatalf("sign-in with a differently-cased email: %d %v", code, out)
	}
	en := app.must("POST", "/api/me/2fa/enroll", map[string]string{"password": "correct-horse-9"}, 200)
	app.must("POST", "/api/me/2fa/confirm", map[string]string{"code": totpNow(t, en["secret"].(string))}, 200)
	code, out = native("", shouty)
	if code != 401 || out["mfa_required"] != true || out["token"] != nil {
		t.Errorf("2FA account signing in with a differently-cased email: %d %v, want 401 mfa_required", code, out)
	}
}
