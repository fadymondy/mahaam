package server

/*
TestPasswordReset: forgot / reset by emailed code (MH-340), against the real stack.

The mail goes through the file driver, so the test reads the code out of the .eml the server
wrote, exactly as a person reads it out of their inbox. Nothing here reaches into the database to
learn a code; the table only holds a keyed hash, and one assertion checks that stays true.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run PasswordReset -v
*/

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

var codeLine = regexp.MustCompile(`(?m)^\s{4}(\d{6})\s*$`)

// mailTo waits for the (after+1)th message to `to` whose subject contains `subject`, and returns
// its raw text. Mail is sent off the request path, so it may land a moment after the 202.
func mailTo(t *testing.T, dir, to, subject string, after int) string {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		got := mailsTo(dir, to, subject)
		if len(got) > after {
			return got[after]
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("no message %d to %s about %q within 10s", after+1, to, subject)
	return ""
}

// mailsTo lists every message to `to` about `subject`, oldest first (the file names start with a
// timestamp).
func mailsTo(dir, to, subject string) []string {
	files, _ := filepath.Glob(filepath.Join(dir, "*.eml"))
	sort.Strings(files)
	var out []string
	for _, f := range files {
		b, _ := os.ReadFile(f)
		s := string(b)
		if strings.Contains(s, "To: "+to+"\r\n") && strings.Contains(s, subject) {
			out = append(out, s)
		}
	}
	return out
}

func codeIn(t *testing.T, msg string) string {
	t.Helper()
	m := codeLine.FindStringSubmatch(msg)
	if m == nil {
		t.Fatalf("no six-digit code in the message:\n%s", msg)
	}
	return m[1]
}

func TestPasswordReset(t *testing.T) {
	mailDir := t.TempDir()
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", mailDir)
	a, srv := bootStack(t)

	alice, aliceID, email := signup(t, a, srv.URL, "reset-alice")
	const subject = "password reset code"

	// Something already signed in that the reset must end: a PAT, as the extension and the apps
	// hold, alongside the cookie session alice registered with.
	pat := alice.must("POST", "/api/auth/tokens", map[string]any{"name": "phone"}, 201)["token"].(string)
	byPAT := newClient(t, srv.URL)
	byPAT.bearer = pat
	byPAT.must("GET", "/api/me/workspaces", nil, 200)
	alice.must("GET", "/api/me/workspaces", nil, 200)

	anon := newClient(t, srv.URL)

	// 1. An unknown address gets the same answer as a real one. No mail is written for it.
	unknown := "nobody-" + rnd() + "@example.test"
	anon.must("POST", "/api/auth/password/forgot", map[string]string{"email": unknown}, 202)
	anon.must("POST", "/api/auth/password/forgot", map[string]string{"email": strings.ToUpper(email)}, 202)
	first := mailTo(t, mailDir, email, subject, 0)
	if len(mailsTo(mailDir, unknown, "")) != 0 {
		t.Error("a message was written for an address with no account")
	}

	// 2. The table holds a keyed hash, never the code.
	code1 := codeIn(t, first)
	var stored string
	if err := a.SysDB.QueryRow(`SELECT code_hash FROM account_codes WHERE user_id = $1 AND used_at IS NULL`, aliceID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, code1) {
		t.Error("the plaintext code is in account_codes")
	}

	// 3. Five wrong guesses burn the code: after that even the right one is refused.
	wrong := "000000"
	if code1 == wrong {
		wrong = "111111"
	}
	for i := 0; i < 5; i++ {
		if code, b := anon.do("POST", "/api/auth/password/reset", map[string]string{"email": email, "code": wrong, "new_password": "brand-new-pass-1"}); code != 400 {
			t.Fatalf("wrong guess %d: got %d: %s", i+1, code, b)
		}
	}
	if code, b := anon.do("POST", "/api/auth/password/reset", map[string]string{"email": email, "code": code1, "new_password": "brand-new-pass-1"}); code != 400 {
		t.Fatalf("the right code after five wrong guesses: got %d, want 400: %s", code, b)
	}

	// 4. Asking again issues a fresh code; the error for an unknown account is the same 400 as a
	// wrong code, so reset can't be used to probe for accounts either.
	anon.must("POST", "/api/auth/password/forgot", map[string]string{"email": email, "locale": "ar"}, 202)
	second := mailTo(t, mailDir, email, "", 1)
	if !strings.Contains(second, `lang="ar"`) {
		t.Error("locale=ar did not produce the Arabic message")
	}
	code2 := codeIn(t, second)
	if code, b := anon.do("POST", "/api/auth/password/reset", map[string]string{"email": unknown, "code": code2, "new_password": "brand-new-pass-1"}); code != 400 {
		t.Errorf("reset for an unknown address: got %d, want 400: %s", code, b)
	}

	// 5. The password policy holds on this path too.
	if code, b := anon.do("POST", "/api/auth/password/reset", map[string]string{"email": email, "code": code2, "new_password": "short"}); code != 422 {
		t.Errorf("a short password: got %d, want 422: %s", code, b)
	}

	// 6. The reset itself. A JWT's iat has whole-second precision, so a session issued in the same
	// second as the reset survives it (the admin sign-out test waits for the same reason). Rounding
	// the other way would refuse the sign-in a client makes straight after resetting.
	time.Sleep(1100 * time.Millisecond)
	anon.must("POST", "/api/auth/password/reset", map[string]string{"email": email, "code": code2, "new_password": "brand-new-pass-1"}, 204)

	// ...and the code is spent.
	if code, _ := anon.do("POST", "/api/auth/password/reset", map[string]string{"email": email, "code": code2, "new_password": "another-pass-22"}); code != 400 {
		t.Errorf("a used code worked a second time: %d", code)
	}

	// 7. Everything that was signed in is signed out.
	if code, b := alice.do("GET", "/api/me/workspaces", nil); code != http.StatusUnauthorized {
		t.Errorf("the old cookie session after a reset: got %d, want 401: %s", code, b)
	}
	if code, b := byPAT.do("GET", "/api/me/workspaces", nil); code != http.StatusUnauthorized {
		t.Errorf("the old PAT after a reset: got %d, want 401: %s", code, b)
	}
	var pats int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM personal_access_tokens WHERE user_id = $1`, aliceID).Scan(&pats)
	if pats != 0 {
		t.Errorf("%d PAT(s) survived the reset", pats)
	}

	// 8. The old password is dead and the new one works.
	fresh := newClient(t, srv.URL)
	if code, _ := fresh.do("POST", "/api/auth/login", map[string]string{"email": email, "password": "correct-horse-9"}); code != 401 {
		t.Errorf("the old password still signs in: %d", code)
	}
	fresh.must("POST", "/api/auth/login", map[string]string{"email": email, "password": "brand-new-pass-1"}, 200)
	fresh.must("GET", "/api/me/workspaces", nil, 200)

	// 9. A PAT minted AFTER the reset works. This is the platform.SessionRevoked bug: a PAT has no
	// JWT iat, so once sessions_valid_after was set, every PAT the user would ever mint was
	// refused, and the apps could never sign in again.
	newPAT := fresh.must("POST", "/api/auth/tokens", map[string]any{"name": "phone again"}, 201)["token"].(string)
	again := newClient(t, srv.URL)
	again.bearer = newPAT
	if code, b := again.do("GET", "/api/me/workspaces", nil); code != 200 {
		t.Errorf("a PAT minted after the reset: got %d, want 200: %s", code, b)
	}

	// 10. The owner of the address is told.
	mailTo(t, mailDir, email, "password was changed", 0)

	// 11. An expired code is refused.
	anon.must("POST", "/api/auth/password/forgot", map[string]string{"email": email}, 202)
	code3 := codeIn(t, mailTo(t, mailDir, email, subject, 1))
	if _, err := a.SysDB.Exec(`UPDATE account_codes SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND used_at IS NULL`, aliceID); err != nil {
		t.Fatal(err)
	}
	if code, _ := anon.do("POST", "/api/auth/password/reset", map[string]string{"email": email, "code": code3, "new_password": "brand-new-pass-2"}); code != 400 {
		t.Errorf("an expired code: got %d, want 400", code)
	}

	// 12. The per-address limit: past it, still 202, and nothing more is sent.
	before := len(mailsTo(mailDir, email, subject))
	anon.must("POST", "/api/auth/password/forgot", map[string]string{"email": email}, 202)
	time.Sleep(500 * time.Millisecond)
	if n := len(mailsTo(mailDir, email, subject)); n != before {
		t.Errorf("a fourth request inside 15 minutes sent mail (%d → %d)", before, n)
	}
}
