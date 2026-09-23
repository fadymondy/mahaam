package server

/*
Google/GitHub sign-in through the auth-oauth plugin, finished by the guard (oauth_return.go).

TestOAuthNext* are unit tests. TestOAuthReturn drives the plugin's real start and callback routes
against the real stack, with Google's token and userinfo endpoints answered in-process (the plugin's
HTTP client uses http.DefaultTransport, which the test routes for those two hosts only).

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run OAuthReturn -v
*/

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/fadymondy/mahaam/internal/platform"
)

func TestOAuthNextValidation(t *testing.T) {
	ok := []string{"/", "/en/app-signin?redirect_uri=mahaam%3A%2F%2Fauth%2Fcallback&state=abc", "/ar/w/acme/tasks", "/en/invite/tok"}
	bad := []string{"", "en/x", "//evil.example/x", "/\\evil.example", "/x\\y", "https://evil.example/", "/x y", "/x\ny",
		"/\t/evil.example", "javascript:alert(1)", strings.Repeat("/a", 1100)}
	for _, n := range ok {
		if got, valid := safeNext(n); !valid || got != n {
			t.Errorf("should accept %q", n)
		}
	}
	for _, n := range bad {
		if _, valid := safeNext(n); valid {
			t.Errorf("should refuse %q", n)
		}
	}
}

func TestOAuthNextRoutes(t *testing.T) {
	for path, want := range map[string][2]bool{
		"/api/auth/oauth/google":          {true, false},
		"/api/auth/oauth/github/callback": {false, true},
		"/api/auth/oauth/google/other":    {false, false},
		"/api/auth/oauth/":                {false, false},
		"/api/auth/oauthx/google":         {false, false},
	} {
		if s, c := oauthRoute(path); s != want[0] || c != want[1] {
			t.Errorf("%s: start %v callback %v, want %v", path, s, c, want)
		}
	}
}

// fakeGoogle answers the plugin's token exchange (the code IS the email) and userinfo.
type fakeGoogle struct{ base http.RoundTripper }

func (f fakeGoogle) RoundTrip(r *http.Request) (*http.Response, error) {
	switch r.URL.Host {
	case "oauth2.googleapis.com":
		_ = r.ParseForm()
		rec := httptest.NewRecorder()
		_ = json.NewEncoder(rec).Encode(map[string]string{"access_token": "at:" + r.PostForm.Get("code")})
		return rec.Result(), nil
	case "www.googleapis.com":
		rec := httptest.NewRecorder()
		_ = json.NewEncoder(rec).Encode(map[string]any{"email": strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer at:"), "verified_email": true})
		return rec.Result(), nil
	}
	return f.base.RoundTrip(r)
}

func TestOAuthReturn(t *testing.T) {
	t.Setenv("OAUTH_GOOGLE_CLIENT_ID", "test-client")
	t.Setenv("OAUTH_GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("WEB_URL", "http://web.example")
	a, srv := bootStack(t)
	orig := http.DefaultTransport
	http.DefaultTransport = fakeGoogle{base: orig}
	t.Cleanup(func() { http.DefaultTransport = orig })

	// signIn runs start → provider → callback in one "browser" and returns the callback response.
	type result struct {
		loc     string
		session *http.Cookie
		jar     http.CookieJar
	}
	signIn := func(email, next string) result {
		t.Helper()
		jar, _ := cookiejar.New(nil)
		c := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		start := srv.URL + "/api/auth/oauth/google"
		if next != "" {
			start += "?next=" + url.QueryEscape(next)
		}
		res, err := c.Get(start)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		to, _ := url.Parse(res.Header.Get("Location"))
		if res.StatusCode != 302 || to.Host != "accounts.google.com" {
			t.Fatalf("start: %d %s", res.StatusCode, to)
		}
		res, err = c.Get(srv.URL + "/api/auth/oauth/google/callback?state=" + url.QueryEscape(to.Query().Get("state")) + "&code=" + url.QueryEscape(email))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 302 {
			t.Fatalf("callback: %d", res.StatusCode)
		}
		out := result{loc: res.Header.Get("Location"), jar: jar}
		for _, ck := range res.Cookies() {
			if ck.Name == "togo_session" {
				out.session = ck
			}
			if ck.Name == oauthNextCookie && ck.MaxAge >= 0 {
				t.Errorf("the next cookie was not cleared: %v", ck)
			}
		}
		return out
	}
	me := func(r result) int {
		t.Helper()
		c := &http.Client{Jar: r.jar}
		res, err := c.Get(srv.URL + "/api/auth/me")
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}

	// 1. The app sign-in page comes back: `next` is honoured, and the browser is signed in.
	next := "/en/app-signin?redirect_uri=" + url.QueryEscape("mahaam://auth/callback") + "&code_challenge=abc&state=s1"
	r := signIn("oauth-new-"+rnd()+"@example.test", next)
	if r.loc != "http://web.example"+next || r.session == nil || r.session.Value == "" {
		t.Fatalf("with next: %q session %v", r.loc, r.session)
	}
	if code := me(r); code != 200 {
		t.Errorf("signed in after the callback: /api/auth/me %d", code)
	}

	// 2. No next, or an unsafe one: the web root (it forwards a signed-in person to their workspaces).
	for _, n := range []string{"", "//evil.example/x", "https://evil.example/"} {
		if r := signIn("oauth-plain-"+rnd()+"@example.test", n); r.loc != "http://web.example/" || r.session == nil {
			t.Errorf("next %q: %q", n, r.loc)
		}
	}

	// 3. A suspended account: no session, sent to the sign-in page with the reason.
	_, susID, susEmail := signup(t, a, srv.URL, "oauth-suspended")
	if _, err := a.SysDB.Exec(`INSERT INTO platform_users (user_id, suspended_at, updated_at) VALUES ($1, now(), now())
		ON CONFLICT (user_id) DO UPDATE SET suspended_at = now()`, susID); err != nil {
		t.Fatal(err)
	}
	platform.Invalidate(susID)
	r = signIn(susEmail, "/en/workspaces")
	if r.loc != "http://web.example/login?error=account_suspended" || (r.session != nil && r.session.MaxAge >= 0) {
		t.Errorf("suspended: %q session %v", r.loc, r.session)
	}
	if code := me(r); code != 401 {
		t.Errorf("suspended account holds a session: /api/auth/me %d", code)
	}

	// 4. Two-factor on: no session; the challenge rides in the fragment and finishes as usual.
	dana, danaID, danaEmail := signup(t, a, srv.URL, "oauth-2fa")
	secret := dana.must("POST", "/api/me/2fa/enroll", map[string]string{"password": "correct-horse-9"}, 200)["secret"].(string)
	dana.must("POST", "/api/me/2fa/confirm", map[string]string{"code": totpNow(t, secret)}, 200)
	if _, err := a.SysDB.Exec(`UPDATE user_totp SET last_step = 0 WHERE user_id = $1`, danaID); err != nil {
		t.Fatal(err)
	}
	r = signIn(danaEmail, next)
	prefix := "http://web.example/login?error=mfa_required&next=" + url.QueryEscape(next) + "#mfa_challenge="
	if !strings.HasPrefix(r.loc, prefix) || (r.session != nil && r.session.MaxAge >= 0) {
		t.Fatalf("2FA: %q session %v", r.loc, r.session)
	}
	if code := me(r); code != 401 {
		t.Errorf("2FA account signed in without a code: /api/auth/me %d", code)
	}
	ch, _ := url.QueryUnescape(strings.TrimPrefix(r.loc, prefix))
	if code, out := postJSON(t, srv.URL+"/api/auth/2fa/challenge", map[string]string{"challenge": ch, "code": totpNow(t, secret)}); code != 200 || out["token"] == nil {
		t.Errorf("finishing the challenge: %d %v", code, out)
	}
}
