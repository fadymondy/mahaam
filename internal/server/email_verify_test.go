package server

/*
TestEmailVerification: confirming the address on sign-up (MH-342), against the real stack.

EMAIL_VERIFICATION=required here. The other tests run in the default ("auto"), where the file
mail driver delivers nothing and so nothing is gated; that the whole suite still creates
workspaces straight after signing up is the check that "auto" really is off without real mail.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run EmailVerification -v
*/

import (
	"strings"
	"testing"
)

func TestEmailVerification(t *testing.T) {
	mailDir := t.TempDir()
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", mailDir)
	t.Setenv("EMAIL_VERIFICATION", "required")
	a, srv := bootStack(t)

	alice, _, email := signup(t, a, srv.URL, "verify-alice")

	// 1. Registering sends a code, and until it's entered a workspace can't be created.
	code := codeIn(t, mailTo(t, mailDir, email, "Confirm your email", 0))
	st := alice.must("GET", "/api/me/verify-email", nil, 200)
	if st["email_verified"] != false || st["email_verification_required"] != true {
		t.Fatalf("state before: %v", st)
	}
	status, b := alice.do("POST", "/api/me/workspaces", map[string]string{"name": "Too soon " + rnd()})
	if status != 403 || !strings.Contains(string(b), `"email_unverified"`) {
		t.Fatalf("creating a workspace unverified: %d %s", status, b)
	}
	// Signing in and reading your own account still work.
	alice.must("GET", "/api/me/profile", nil, 200)

	// 2. A wrong code is refused; the right one verifies.
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if status, _ := alice.do("POST", "/api/me/verify-email", map[string]string{"code": wrong}); status != 400 {
		t.Errorf("a wrong code: %d", status)
	}
	// A resend replaces the first code, so the first stops working.
	alice.must("POST", "/api/me/verify-email/resend", map[string]string{"locale": "ar"}, 202)
	second := mailTo(t, mailDir, email, "", 1)
	if !strings.Contains(second, `lang="ar"`) {
		t.Error("the resent code ignored locale=ar")
	}
	if status, _ := alice.do("POST", "/api/me/verify-email", map[string]string{"code": code}); status != 400 && code != codeIn(t, second) {
		t.Errorf("the first code still worked after a resend: %d", status)
	}
	st = alice.must("POST", "/api/me/verify-email", map[string]string{"code": codeIn(t, second)}, 200)
	if st["email_verified"] != true {
		t.Fatalf("after the right code: %v", st)
	}
	if p := alice.must("GET", "/api/me/profile", nil, 200); p["email_verified"] != true {
		t.Errorf("the profile does not say verified: %v", p)
	}
	alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Verified " + rnd()}, 201)
	// Verified already: a resend sends nothing.
	alice.must("POST", "/api/me/verify-email/resend", nil, 202)
	if n := len(mailsTo(mailDir, email, "")); n != 2 {
		t.Errorf("%d messages after a resend to a verified account, want 2", n)
	}

	// 3. A password reset by emailed code proves the inbox as well.
	bob, _, bobEmail := signup(t, a, srv.URL, "verify-bob")
	anon := newClient(t, srv.URL)
	anon.must("POST", "/api/auth/password/forgot", map[string]string{"email": bobEmail}, 202)
	reset := codeIn(t, mailTo(t, mailDir, bobEmail, "password reset code", 0))
	anon.must("POST", "/api/auth/password/reset", map[string]string{"email": bobEmail, "code": reset, "new_password": "brand-new-pass-1"}, 204)
	_ = bob
	fresh := newClient(t, srv.URL)
	fresh.must("POST", "/api/auth/login", map[string]string{"email": bobEmail, "password": "brand-new-pass-1"}, 200)
	if st := fresh.must("GET", "/api/me/verify-email", nil, 200); st["email_verified"] != true {
		t.Errorf("a password reset did not verify the address: %v", st)
	}
}
