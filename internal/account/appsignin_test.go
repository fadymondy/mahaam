package account

import "testing"

func TestValidAppRedirect(t *testing.T) {
	ok := []string{
		"http://127.0.0.1:51234/callback",
		"http://localhost:8/callback",
		"http://[::1]:4000/callback",
		"mahaam://auth/callback",
	}
	bad := []string{
		"https://evil.example/callback",      // not an app
		"http://127.0.0.1/callback",          // loopback needs the app's port
		"http://127.0.0.1:5000/other",        // only /callback
		"http://evil.example:5000/callback",  // not loopback
		"http://127.0.0.1:5000/callback#x",   // fragments smuggle targets
		"http://127.0.0.1:5000/callback?a=b", // the server adds the query
		"http://u:p@127.0.0.1:5000/callback", // userinfo
		"mahaam://evil/callback",             // only auth/callback
		"mahaam:auth/callback",               // opaque
		"mahaamx://auth/callback",
		"",
	}
	for _, u := range ok {
		if !validAppRedirect(u) {
			t.Errorf("should accept %q", u)
		}
	}
	for _, u := range bad {
		if validAppRedirect(u) {
			t.Errorf("should refuse %q", u)
		}
	}
}

func TestPKCES256(t *testing.T) {
	// Cross-checked independently: printf %s <verifier> | openssl dgst -sha256 -binary | base64url.
	if got := pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWjOEjXk"); got != "VYFANLqdx_HDV6BqEhluZJ63rtrIPROSSFdB3P6G83I" {
		t.Fatalf("pkceS256 = %s", got)
	}
}

func TestDeviceLabel(t *testing.T) {
	if deviceLabel("  ") != "Mahaam app" || deviceLabel("Mac\x00 — host") != "Mac — host" {
		t.Fatal("deviceLabel")
	}
}
