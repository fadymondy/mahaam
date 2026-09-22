package mcp

import "testing"

/*
validRedirectURI is a security boundary, not a parser.

Client registration is deliberately open — that is how a connector sets itself up with no work on
our side — so this function is the only thing standing between "anyone may register" and "anyone
may register a client that redirects an authorization code somewhere they control". Every case
below is a way that has actually gone wrong in somebody's OAuth implementation.
*/

func TestValidRedirectURI(t *testing.T) {
	cases := []struct {
		raw string
		ok  bool
		why string
	}{
		// https: the ordinary web client.
		{"https://claude.ai/api/mcp/auth_callback", true, "an ordinary https callback"},
		{"https://example.test/cb?state=keep", true, "a query string is fine"},
		{"https://", false, "https with no host is not a destination"},

		// Loopback, for a desktop app. RFC 8252 §7.3: the port must not be pinned, because a
		// native app has to take whatever ephemeral port it can get.
		{"http://127.0.0.1:0/cb", true, "loopback, port 0"},
		{"http://127.0.0.1:49152/cb", true, "loopback, a high ephemeral port"},
		{"http://localhost:8080/cb", true, "localhost by name"},
		{"http://[::1]:1234/cb", true, "IPv6 loopback"},
		{"http://example.test/cb", false, "plain http to a real host would put a code on the wire"},
		{"http://127.0.0.1.evil.test/cb", false, "a host that merely starts with a loopback address"},

		// The private-use scheme, for mobile.
		{"mahaam://auth/callback", true, "the mobile callback"},
		{"mahaam://auth/callback?code=x", true, "a query string is fine here too"},
		{"mahaam:", false, "a bare scheme"},
		{"mahaam://", false, "a scheme with no host"},
		{"mahaam:/auth/callback", false, "one slash: opaque, not a host"},
		{"mahaam://auth", false, "a host with no path — too broad a target"},
		{"mahaam://user:pw@auth/callback", false, "credentials in a redirect are never ours"},

		// Schemes that are not ours, including the ones designed to look like they are.
		{"mahaam2://auth/cb", false, "a different scheme that starts the same way"},
		{"mahaa://auth/cb", false, "a scheme that is a prefix of ours"},
		{"com.fadymondy.mahaam://auth/cb", false, "reverse-DNS is not the scheme we accept"},
		{"javascript:alert(1)", false, "javascript:"},
		{"data:text/html,<script>", false, "data:"},
		{"file:///etc/passwd", false, "file:"},
		{"//evil.test/cb", false, "scheme-relative has no scheme at all"},
		{"", false, "empty"},

		// A fragment is never legal on a redirect_uri (RFC 6749 §3.1.2), and is how a second
		// target gets smuggled past a comparison that only looks at the front of the string.
		{"https://example.test/cb#evil", false, "https with a fragment"},
		{"mahaam://auth/callback#evil", false, "the native scheme with a fragment"},
		{"http://127.0.0.1:9999/cb#evil", false, "loopback with a fragment"},
	}

	for _, c := range cases {
		if got := validRedirectURI(c.raw); got != c.ok {
			t.Errorf("validRedirectURI(%q) = %v, want %v — %s", c.raw, got, c.ok, c.why)
		}
	}
}

func TestNativeSchemeIsCaseSensitive(t *testing.T) {
	// url.Parse lowercases the scheme, so these all normalise to ours and are accepted. That is
	// correct — schemes are case-insensitive per RFC 3986 §3.1 — but it is worth pinning, because
	// the obvious hand-rolled check (`strings.HasPrefix(raw, "mahaam://")`) would reject them and
	// quietly break a client that happened to shout.
	for _, raw := range []string{"MAHAAM://auth/callback", "Mahaam://auth/callback"} {
		if !validRedirectURI(raw) {
			t.Errorf("validRedirectURI(%q) = false; schemes are case-insensitive", raw)
		}
	}
}
