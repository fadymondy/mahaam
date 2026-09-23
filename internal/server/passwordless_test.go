package server

/*
TestPasswordlessAccount: accounts made with Sign in with Apple (or Google/GitHub) have no password,
so the routes that ask for one take a mailed code instead (internal/account/reauth.go): delete the
account, change the email address, set up / turn off two-factor sign-in, replace recovery codes.
Password accounts are unchanged (TestTwoFactor, TestAccountDeletion and TestProfile cover them;
the refusals at the top here check they can't use the code path).

The code is read out of the .eml the file mail driver writes, as in TestPasswordReset.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run Passwordless -v
*/

import (
	"strings"
	"testing"
)

func TestPasswordlessAccount(t *testing.T) {
	mailDir := t.TempDir()
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", mailDir)
	idp := newAppleIDP(t)
	a, srv := bootStack(t)
	// The body line of the Arabic code email (locale "ar" below): only these messages carry it.
	const codeMail = "لتأكيد أنك صاحب الحساب"

	// An Apple account, signed in the way the app is: a Bearer device token.
	appleUser := func(prefix string) (*client, string, string) {
		t.Helper()
		email := prefix + "-" + rnd() + "@privaterelay.appleid.com"
		tok, raw := idp.token(t, "001.apple."+rnd(), email, true)
		code, out := postJSON(t, srv.URL+"/api/auth/apple", map[string]any{"identity_token": tok, "nonce": raw, "device_name": "iPhone"})
		if code != 200 {
			t.Fatalf("apple sign-in: %d %v", code, out)
		}
		c := newClient(t, srv.URL)
		c.bearer = out["access_token"].(string)
		return c, out["user"].(map[string]any)["id"].(string), email
	}
	sent := map[string]int{}
	codeFor := func(c *client, email string) string {
		t.Helper()
		out := c.must("POST", "/api/me/reauth/code", map[string]string{"locale": "ar"}, 202)
		if out["email"] != email || out["expires_in"] != float64(600) {
			t.Errorf("reauth code answer: %v", out)
		}
		msg := mailTo(t, mailDir, email, codeMail, sent[email])
		sent[email]++
		return codeIn(t, msg)
	}
	refused := func(c *client, path string, body map[string]any, status int, code string) {
		t.Helper()
		st, b := c.do("POST", path, body)
		if st != status || (code != "" && !strings.Contains(string(b), `"code":"`+code+`"`)) {
			t.Errorf("%s %v: %d %s, want %d %s", path, body, st, b, status, code)
		}
	}

	pw, _, _ := signup(t, a, srv.URL, "reauth-pw")
	ada, adaID, adaEmail := appleUser("reauth-ada")
	nextStep := func() {
		if _, err := a.SysDB.Exec(`UPDATE user_totp SET last_step = 0 WHERE user_id = $1`, adaID); err != nil {
			t.Fatal(err)
		}
	}

	// 1. has_password tells the app which to ask for.
	if p := pw.must("GET", "/api/me/profile", nil, 200); p["has_password"] != true {
		t.Errorf("password account: has_password %v", p["has_password"])
	}
	if p := ada.must("GET", "/api/me/profile", nil, 200); p["has_password"] != false {
		t.Errorf("Apple account: has_password %v", p["has_password"])
	}

	// 2. Password accounts are unchanged: no code for them, and a code is no substitute for the password.
	refused(pw, "/api/me/reauth/code", map[string]any{}, 409, "has_password")
	refused(pw, "/api/me/delete", map[string]any{"email_code": "123456"}, 403, "")
	refused(pw, "/api/me/2fa/enroll", map[string]any{"email_code": "123456"}, 403, "")

	// 3. A passwordless account without a code is told how to get one.
	refused(ada, "/api/me/delete", map[string]any{}, 403, "reauth_required")
	refused(ada, "/api/me/email", map[string]any{"email": "new-" + rnd() + "@example.test"}, 403, "reauth_required")
	refused(ada, "/api/me/2fa/enroll", map[string]any{}, 403, "reauth_required")

	// 4. Set up two-factor sign-in with a code (#1). A code works once.
	c1 := codeFor(ada, adaEmail)
	en := ada.must("POST", "/api/me/2fa/enroll", map[string]any{"email_code": c1}, 200)
	secret := en["secret"].(string)
	refused(ada, "/api/me/2fa/enroll", map[string]any{"email_code": c1}, 403, "invalid_code")
	ada.must("POST", "/api/me/2fa/confirm", map[string]string{"code": totpNow(t, secret)}, 200)

	// 5. Replace the recovery codes: a code (#2) AND the authenticator.
	c2 := codeFor(ada, adaEmail)
	refused(ada, "/api/me/2fa/recovery-codes", map[string]any{"email_code": c2}, 422, "") // no TOTP: refused before c2 is spent
	nextStep()
	rc := ada.must("POST", "/api/me/2fa/recovery-codes", map[string]any{"email_code": c2, "code": totpNow(t, secret)}, 200)
	recovery := rc["recovery_codes"].([]any)

	// 6. Turn it off: a code (#3) and a recovery code; without the second factor, refused and c3 kept.
	c3 := codeFor(ada, adaEmail)
	refused(ada, "/api/me/2fa/disable", map[string]any{"email_code": c3}, 400, "")
	ada.must("POST", "/api/me/2fa/disable", map[string]any{"email_code": c3, "recovery_code": recovery[0].(string)}, 204)
	if st := ada.must("GET", "/api/me/2fa", nil, 200); st["enabled"] != false {
		t.Errorf("2FA still on: %v", st)
	}

	// 7. On again (#4), then delete (#5): 2FA is still asked for, and the code survives that refusal.
	c4 := codeFor(ada, adaEmail)
	secret = ada.must("POST", "/api/me/2fa/enroll", map[string]any{"email_code": c4}, 200)["secret"].(string)
	ada.must("POST", "/api/me/2fa/confirm", map[string]string{"code": totpNow(t, secret)}, 200)
	c5 := codeFor(ada, adaEmail)
	refused(ada, "/api/me/delete", map[string]any{"email_code": c5}, 403, "mfa_required")
	// Five codes in 15 minutes is the limit.
	if st, _ := ada.do("POST", "/api/me/reauth/code", map[string]any{}); st != 429 {
		t.Errorf("sixth code in the window: %d, want 429", st)
	}
	nextStep()
	del := ada.must("POST", "/api/me/delete", map[string]any{"email_code": c5, "code": totpNow(t, secret)}, 202)
	if del["purge_after"] == nil {
		t.Errorf("delete: %v", del)
	}
	mailTo(t, mailDir, adaEmail, "will be deleted", 0)

	// 8. Wrong and expired codes; the sole-owner rule; the email change.
	bea, beaID, beaEmail := appleUser("reauth-bea")
	c := codeFor(bea, beaEmail)
	wrong := "000000"
	if c == wrong {
		wrong = "111111"
	}
	refused(bea, "/api/me/email", map[string]any{"email": "bea-" + rnd() + "@example.test", "email_code": wrong}, 403, "invalid_code")
	if _, err := a.SysDB.Exec(`UPDATE account_codes SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND purpose = 'reauth'`, beaID); err != nil {
		t.Fatal(err)
	}
	refused(bea, "/api/me/email", map[string]any{"email": "bea-" + rnd() + "@example.test", "email_code": c}, 403, "invalid_code")

	c = codeFor(bea, beaEmail)
	newEmail := "bea-" + rnd() + "@example.test"
	bea.must("POST", "/api/me/email", map[string]any{"email": newEmail, "email_code": c}, 202)
	change := codeIn(t, mailTo(t, mailDir, newEmail, "new Mahaam email", 0))
	if p := bea.must("POST", "/api/me/email/confirm", map[string]string{"code": change}, 200); p["email"] != newEmail {
		t.Errorf("email after the change: %v", p["email"])
	}
	beaEmail = newEmail

	bea.must("POST", "/api/me/workspaces", map[string]string{"name": "Bea " + rnd()}, 201)
	c = codeFor(bea, beaEmail)
	refused(bea, "/api/me/delete", map[string]any{"email_code": c}, 409, "sole_owner")
	var unspent bool
	_ = a.SysDB.QueryRow(`SELECT EXISTS (SELECT 1 FROM account_codes WHERE user_id = $1 AND purpose = 'reauth' AND used_at IS NULL)`, beaID).Scan(&unspent)
	if !unspent {
		t.Error("the sole-owner refusal spent the email code")
	}
}
