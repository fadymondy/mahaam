package server

/*
TestTwoFactor: TOTP two-factor sign-in (MH-341), against the real stack.

The test computes codes the way an authenticator app does (RFC 6238), from the secret the enroll
call hands back. A code can be used once per 30-second step, so where a real person would wait
for the next step, the test tells the database the clock moved on (last_step = 0) and says so.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run TwoFactor -v
*/

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha1" //#nosec G505 -- RFC 6238
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func totpNow(t *testing.T, secret string) string {
	t.Helper()
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		t.Fatal(err)
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(time.Now().Unix()/30))
	m := hmac.New(sha1.New, key)
	m.Write(msg[:])
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	return fmt.Sprintf("%06d", (binary.BigEndian.Uint32(sum[off:off+4])&0x7fffffff)%1_000_000)
}

func TestTwoFactor(t *testing.T) {
	a, srv := bootStack(t)
	alice, aliceID, email := signup(t, a, srv.URL, "2fa-alice")
	nextStep := func() { // what waiting 30 seconds for a fresh code does
		if _, err := a.SysDB.Exec(`UPDATE user_totp SET last_step = 0 WHERE user_id = $1`, aliceID); err != nil {
			t.Fatal(err)
		}
	}
	login := func(password string) (int, map[string]any) {
		c := newClient(t, srv.URL)
		code, b := c.do("POST", "/api/auth/login", map[string]string{"email": email, "password": password})
		out := map[string]any{}
		_ = json.Unmarshal(b, &out)
		return code, out
	}

	// 0. The plugin's own TOTP routes are closed: plain-text secrets, never checked at sign-in.
	for _, p := range []string{"/api/auth/2fa/enroll", "/api/auth/2fa/verify"} {
		if code, _ := alice.do("POST", p, map[string]string{}); code != 404 {
			t.Errorf("%s: %d, want 404", p, code)
		}
	}

	// 1. Setup needs the password, and nothing is enforced until a code confirms it.
	if st := alice.must("GET", "/api/me/2fa", nil, 200); st["enabled"] != false {
		t.Fatalf("state before: %v", st)
	}
	if code, _ := alice.do("POST", "/api/me/2fa/enroll", map[string]string{"password": "wrong"}); code != 403 {
		t.Errorf("enroll with the wrong password: %d", code)
	}
	en := alice.must("POST", "/api/me/2fa/enroll", map[string]string{"password": "correct-horse-9"}, 200)
	secret, _ := en["secret"].(string)
	if uri, _ := en["otpauth_url"].(string); !strings.HasPrefix(uri, "otpauth://totp/Mahaam:") || !strings.Contains(uri, "issuer=Mahaam") {
		t.Errorf("otpauth url: %v", en["otpauth_url"])
	}
	var sealed string
	_ = a.SysDB.QueryRow(`SELECT secret_sealed FROM user_totp WHERE user_id = $1`, aliceID).Scan(&sealed)
	if strings.Contains(sealed, secret) {
		t.Error("the TOTP secret is stored in plain text")
	}
	if code, _ := login("correct-horse-9"); code != 200 {
		t.Errorf("sign-in while setup is only pending should not ask for a code: %d", code)
	}
	if code, _ := alice.do("POST", "/api/me/2fa/confirm", map[string]string{"code": "000000"}); code != 400 && totpNow(t, secret) != "000000" {
		t.Errorf("confirm with a wrong code: %d", code)
	}
	conf := alice.must("POST", "/api/me/2fa/confirm", map[string]string{"code": totpNow(t, secret)}, 200)
	recovery, _ := conf["recovery_codes"].([]any)
	if len(recovery) != 10 {
		t.Fatalf("got %d recovery codes, want 10", len(recovery))
	}
	if st := alice.must("GET", "/api/me/2fa", nil, 200); st["enabled"] != true || st["recovery_codes_left"] != float64(10) {
		t.Errorf("state after: %v", st)
	}

	// 2. A wrong password looks exactly like it always did: nothing says this account has 2FA.
	code, out := login("wrong-password")
	if code != 401 || out["mfa_required"] != nil || out["challenge"] != nil {
		t.Errorf("wrong password: %d %v", code, out)
	}

	// 3. The right password gets a challenge and no session.
	c := newClient(t, srv.URL)
	status, b := c.do("POST", "/api/auth/login", map[string]string{"email": email, "password": "correct-horse-9"})
	if status != 401 || !strings.Contains(string(b), `"mfa_required"`) {
		t.Fatalf("right password with 2FA on: %d %s", status, b)
	}
	if code, _ := c.do("GET", "/api/me/profile", nil); code != 401 {
		t.Errorf("a session was issued before the second factor: %d", code)
	}
	var ch struct{ Challenge string }
	_ = json.Unmarshal(b, &ch)

	// 4. A wrong code, a forged challenge: no.
	if code, _ := c.do("POST", "/api/auth/2fa/challenge", map[string]string{"challenge": ch.Challenge, "code": "000000"}); code != 400 && totpNow(t, secret) != "000000" {
		t.Errorf("a wrong code: %d", code)
	}
	if code, _ := c.do("POST", "/api/auth/2fa/challenge", map[string]string{"challenge": ch.Challenge + "x", "code": totpNow(t, secret)}); code != 401 {
		t.Errorf("a tampered challenge: %d", code)
	}

	// 5. The right code: a browser (CSRF header present) gets the cookie as well as the token.
	nextStep()
	res := c.must("POST", "/api/auth/2fa/challenge", map[string]string{"challenge": ch.Challenge, "code": totpNow(t, secret)}, 200)
	if tok, _ := res["token"].(string); tok == "" {
		t.Fatalf("no token: %v", res)
	}
	c.must("GET", "/api/me/profile", nil, 200)

	// ...and the same code can't be used twice.
	if code, _ := c.do("POST", "/api/auth/2fa/challenge", map[string]string{"challenge": ch.Challenge, "code": totpNow(t, secret)}); code != 400 {
		t.Errorf("a replayed code: %d, want 400", code)
	}

	// 6. A native client (no CSRF header): the token only, no cookie; it works as a Bearer token.
	nextStep()
	raw, _ := json.Marshal(map[string]string{"challenge": ch.Challenge, "code": totpNow(t, secret)})
	resp, err := http.Post(srv.URL+"/api/auth/2fa/challenge", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("native challenge: %d %s", resp.StatusCode, body)
	}
	for _, ck := range resp.Cookies() {
		if ck.Name == "togo_session" {
			t.Error("a session cookie was set without the CSRF proof")
		}
	}
	var native struct{ Token string }
	_ = json.Unmarshal(body, &native)
	app := newClient(t, srv.URL)
	app.bearer = native.Token
	app.must("GET", "/api/me/profile", nil, 200)

	// 7. A recovery code works once.
	rc := recovery[0].(string)
	status, b = newClient(t, srv.URL).do("POST", "/api/auth/login", map[string]string{"email": email, "password": "correct-horse-9"})
	_ = json.Unmarshal(b, &ch)
	r2 := newClient(t, srv.URL)
	r2.must("POST", "/api/auth/2fa/challenge", map[string]string{"challenge": ch.Challenge, "recovery_code": strings.ToUpper(rc)}, 200)
	if code, _ := r2.do("POST", "/api/auth/2fa/challenge", map[string]string{"challenge": ch.Challenge, "recovery_code": rc}); code != 400 {
		t.Errorf("a used recovery code: %d", code)
	}
	if st := alice.must("GET", "/api/me/2fa", nil, 200); st["recovery_codes_left"] != float64(9) {
		t.Errorf("recovery codes left: %v", st["recovery_codes_left"])
	}

	// 8. Deleting the account needs the second factor too.
	if code, b := alice.do("POST", "/api/me/delete", map[string]string{"password": "correct-horse-9"}); code != 403 || !strings.Contains(string(b), "mfa_required") {
		t.Errorf("delete without a code: %d %s", code, b)
	}

	// 9. Ten wrong codes lock the second factor for the window, even against the right code.
	if _, err := a.SysDB.Exec(`UPDATE user_totp SET failures = 0 WHERE user_id = $1`, aliceID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		_, _ = c.do("POST", "/api/auth/2fa/challenge", map[string]string{"challenge": ch.Challenge, "code": "000001"})
	}
	nextStep()
	if code, _ := c.do("POST", "/api/auth/2fa/challenge", map[string]string{"challenge": ch.Challenge, "code": totpNow(t, secret)}); code != 429 {
		t.Errorf("the right code after ten wrong ones: %d, want 429", code)
	}
	if _, err := a.SysDB.Exec(`UPDATE user_totp SET failures = 0 WHERE user_id = $1`, aliceID); err != nil {
		t.Fatal(err)
	}

	// 10. Turning it off needs the password and a code; afterwards sign-in is one step again.
	if code, _ := alice.do("POST", "/api/me/2fa/disable", map[string]string{"password": "wrong", "code": totpNow(t, secret)}); code != 403 {
		t.Errorf("disable with the wrong password: %d", code)
	}
	alice.must("POST", "/api/me/2fa/disable", map[string]string{"password": "correct-horse-9", "recovery_code": recovery[1].(string)}, 204)
	if code, _ := login("correct-horse-9"); code != 200 {
		t.Errorf("sign-in after turning 2FA off: %d", code)
	}
}
