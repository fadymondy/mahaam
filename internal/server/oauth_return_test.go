package server

/*
Sign in with Apple, Google and GitHub in a browser (oauth_return.go, account/social_flow.go) and
the identities they leave (account/identities.go).

TestOAuthNext* and TestOAuthBindCookie are unit tests. The others drive the real routes against
the real stack, with the providers answered in-process: http.DefaultTransport is swapped for one
that serves Google's, GitHub's and Apple's hosts (fakeProviders) and passes everything else on.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run 'OAuth|SocialIdentities|AppleWeb|AppleRevoke' -v
*/

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/fadymondy/mahaam/internal/account"
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
	type want struct {
		p               string
		start, callback bool
	}
	for path, w := range map[string]want{
		"/api/auth/oauth/google":          {"google", true, false},
		"/api/auth/oauth/apple/callback":  {"apple", false, true},
		"/api/auth/oauth/github/callback": {"github", false, true},
		"/api/auth/oauth/google/other":    {"google", false, false},
		"/api/auth/oauth/":                {"", false, false},
		"/api/auth/oauthx/google":         {"", false, false},
	} {
		if p, s, c := oauthRoute(path); p != w.p || s != w.start || c != w.callback {
			t.Errorf("%s: %q start %v callback %v, want %v", path, p, s, c, w)
		}
	}
}

func TestOAuthBindCookie(t *testing.T) {
	t.Setenv("COOKIE_SECURE", "")
	t.Setenv("APP_ENV", "production")
	if c := oauthBindCookieFor("x", 600); !c.Secure || c.SameSite != http.SameSiteNoneMode || !c.HttpOnly || c.Path != oauthPrefix {
		t.Errorf("production: Apple's cross-site POST needs SameSite=None; Secure: %v", c)
	}
	t.Setenv("APP_ENV", "local")
	if c := oauthBindCookieFor("x", 600); c.Secure || c.SameSite != http.SameSiteLaxMode {
		t.Errorf("development: %v", c)
	}
}

// fakeUser is what a fake provider says about whoever signs in; the OAuth code carries it.
type fakeUser struct {
	Sub      string `json:"sub"`
	Email    string `json:"email"`
	Verified bool   `json:"verified"`
	Name     string `json:"name"`
}

func (u fakeUser) code() string {
	b, _ := json.Marshal(u)
	return base64.RawURLEncoding.EncodeToString(b)
}

func userOfCode(code string) fakeUser {
	var u fakeUser
	b, _ := base64.RawURLEncoding.DecodeString(code)
	_ = json.Unmarshal(b, &u)
	return u
}

// fakeProviders answers Google, GitHub and Apple. Access tokens are "at:<code>".
type fakeProviders struct {
	base   http.RoundTripper
	t      *testing.T
	appleK *ecdsa.PublicKey // checks our client secret
	mu     sync.Mutex
	// Apple: what the token endpoint was asked, and the refresh tokens revoked.
	appleClients []string
	revoked      []string
}

func jsonResponse(v any, status int) *http.Response {
	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Type", "application/json")
	rec.WriteHeader(status)
	_ = json.NewEncoder(rec).Encode(v)
	return rec.Result()
}

func (f *fakeProviders) RoundTrip(r *http.Request) (*http.Response, error) {
	bearer := userOfCode(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer at:"))
	switch r.URL.Host + r.URL.Path {
	case "oauth2.googleapis.com/token", "github.com/login/oauth/access_token":
		_ = r.ParseForm()
		if r.PostForm.Get("client_secret") != "test-secret" || !strings.HasSuffix(r.PostForm.Get("redirect_uri"), "/callback") {
			return jsonResponse(map[string]string{"error": "invalid_client"}, 401), nil
		}
		return jsonResponse(map[string]string{"access_token": "at:" + r.PostForm.Get("code")}, 200), nil
	case "openidconnect.googleapis.com/v1/userinfo":
		return jsonResponse(map[string]any{"sub": bearer.Sub, "email": bearer.Email, "email_verified": bearer.Verified, "name": bearer.Name}, 200), nil
	case "api.github.com/user":
		var id int64
		for _, c := range bearer.Sub {
			id = id*10 + int64(c-'0')
		}
		return jsonResponse(map[string]any{"id": id, "login": "octo", "name": bearer.Name, "email": nil}, 200), nil
	case "api.github.com/user/emails":
		return jsonResponse([]map[string]any{
			{"email": "noreply-" + bearer.Sub + "@users.noreply.github.com", "primary": false, "verified": true},
			{"email": bearer.Email, "primary": true, "verified": bearer.Verified},
		}, 200), nil
	case "appleid.apple.com/auth/token":
		_ = r.ParseForm()
		client := r.PostForm.Get("client_id")
		if !f.checkSecret(r.PostForm.Get("client_secret"), client) {
			return jsonResponse(map[string]string{"error": "invalid_client"}, 400), nil
		}
		f.mu.Lock()
		f.appleClients = append(f.appleClients, client)
		f.mu.Unlock()
		// The code is the subject; the id_token is only read for its sub here (it came from Apple).
		idt, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": r.PostForm.Get("code")}).SignedString([]byte("x"))
		return jsonResponse(map[string]string{"id_token": idt, "refresh_token": "rt-" + r.PostForm.Get("code"), "access_token": "a"}, 200), nil
	case "appleid.apple.com/auth/revoke":
		_ = r.ParseForm()
		if !f.checkSecret(r.PostForm.Get("client_secret"), r.PostForm.Get("client_id")) || r.PostForm.Get("token_type_hint") != "refresh_token" {
			return jsonResponse(map[string]string{"error": "invalid_client"}, 400), nil
		}
		f.mu.Lock()
		f.revoked = append(f.revoked, r.PostForm.Get("client_id")+"/"+r.PostForm.Get("token"))
		f.mu.Unlock()
		return jsonResponse(map[string]string{}, 200), nil
	}
	return f.base.RoundTrip(r)
}

func (f *fakeProviders) checkSecret(secret, client string) bool {
	if f.appleK == nil {
		return false
	}
	c := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(secret, c, func(t *jwt.Token) (any, error) {
		if t.Header["kid"] != "KEY123" {
			f.t.Errorf("client secret kid: %v", t.Header["kid"])
		}
		return f.appleK, nil
	}, jwt.WithValidMethods([]string{"ES256"}), jwt.WithIssuer("TEAM123"), jwt.WithAudience("https://appleid.apple.com"), jwt.WithSubject(client))
	if err != nil {
		f.t.Errorf("client secret: %v", err)
	}
	return err == nil
}

func (f *fakeProviders) revokedList() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.revoked...)
}

func installFakeProviders(t *testing.T) *fakeProviders {
	t.Helper()
	orig := http.DefaultTransport
	f := &fakeProviders{base: orig, t: t}
	http.DefaultTransport = f
	t.Cleanup(func() { http.DefaultTransport = orig })
	return f
}

// withAppleKey configures the Apple key (APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY).
func withAppleKey(t *testing.T, f *fakeProviders) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	// One line with "\n" escapes, as a .env file would hold it.
	p := strings.ReplaceAll(string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), "\n", `\n`)
	t.Setenv("APPLE_TEAM_ID", "TEAM123")
	t.Setenv("APPLE_KEY_ID", "KEY123")
	t.Setenv("APPLE_PRIVATE_KEY", p)
	f.appleK = &k.PublicKey
}

// browser is one cookie jar that doesn't follow redirects.
type browser struct {
	t   *testing.T
	c   *http.Client
	srv string
}

func newBrowser(t *testing.T, srv string) *browser {
	jar, _ := cookiejar.New(nil)
	return &browser{t: t, srv: srv, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (b *browser) get(path string) *http.Response {
	b.t.Helper()
	res, err := b.c.Get(b.srv + path)
	if err != nil {
		b.t.Fatal(err)
	}
	res.Body.Close()
	return res
}

// start opens /api/auth/oauth/<p>?next=… and returns the provider URL it was sent to.
func (b *browser) start(provider, next string) *url.URL {
	b.t.Helper()
	path := "/api/auth/oauth/" + provider
	if next != "" {
		path += "?next=" + url.QueryEscape(next)
	}
	res := b.get(path)
	to, _ := url.Parse(res.Header.Get("Location"))
	if res.StatusCode != 302 || to == nil {
		b.t.Fatalf("start %s: %d %v", provider, res.StatusCode, to)
	}
	return to
}

func (b *browser) me() int {
	b.t.Helper()
	res, err := b.c.Get(b.srv + "/api/auth/me")
	if err != nil {
		b.t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func sessionOf(res *http.Response) *http.Cookie {
	for _, ck := range res.Cookies() {
		if ck.Name == "togo_session" && ck.Value != "" && ck.MaxAge >= 0 {
			return ck
		}
	}
	return nil
}

// oauthSignIn runs start → provider → callback for Google or GitHub and returns the callback response.
func oauthSignIn(t *testing.T, srv, provider string, u fakeUser, next string) (*browser, *http.Response) {
	t.Helper()
	b := newBrowser(t, srv)
	to := b.start(provider, next)
	res := b.get("/api/auth/oauth/" + provider + "/callback?state=" + url.QueryEscape(to.Query().Get("state")) + "&code=" + url.QueryEscape(u.code()))
	if res.StatusCode != 302 {
		t.Fatalf("callback: %d", res.StatusCode)
	}
	return b, res
}

func TestOAuthReturn(t *testing.T) {
	t.Setenv("OAUTH_GOOGLE_CLIENT_ID", "test-client")
	t.Setenv("OAUTH_GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("OAUTH_GITHUB_CLIENT_ID", "")
	t.Setenv("APPLE_SERVICES_ID", "")
	t.Setenv("WEB_URL", "http://web.example")
	a, srv := bootStack(t)
	installFakeProviders(t)
	google := func(email string) fakeUser { return fakeUser{Sub: "g-" + rnd(), Email: email, Verified: true} }

	// 0. The methods list: our Google, a native-only Apple, no GitHub; unknown providers are 404,
	//    an unconfigured one 503 — never the plugin's own handler.
	_, body := getJSON(t, srv.URL+"/api/auth/methods")
	got := []string{}
	for _, m := range body["methods"].([]any) {
		mm := m.(map[string]any)
		got = append(got, mm["name"].(string)+":"+mm["type"].(string))
	}
	if strings.Join(got, ",") != "apple:native,google:oauth" {
		t.Errorf("methods: %v", got)
	}
	b := newBrowser(t, srv.URL)
	for path, want := range map[string]int{"/api/auth/oauth/facebook": 404, "/api/auth/oauth/facebook/callback": 404, "/api/auth/oauth/github": 503} {
		if res := b.get(path); res.StatusCode != want {
			t.Errorf("%s: %d, want %d", path, res.StatusCode, want)
		}
	}

	// 1. The app sign-in page comes back: `next` is honoured, and the browser is signed in.
	next := "/en/app-signin?redirect_uri=" + url.QueryEscape("mahaam://auth/callback") + "&code_challenge=abc&state=s1"
	b, res := oauthSignIn(t, srv.URL, "google", google("oauth-new-"+rnd()+"@example.test"), next)
	if loc := res.Header.Get("Location"); loc != "http://web.example"+next || sessionOf(res) == nil {
		t.Fatalf("with next: %q", loc)
	}
	if code := b.me(); code != 200 {
		t.Errorf("signed in after the callback: /api/auth/me %d", code)
	}
	for _, ck := range res.Cookies() {
		if ck.Name == oauthBindCookie && ck.MaxAge >= 0 {
			t.Errorf("the binding cookie was not cleared: %v", ck)
		}
	}

	// 2. No next, or an unsafe one: the web root (it forwards a signed-in person to their workspaces).
	for _, n := range []string{"", "//evil.example/x", "https://evil.example/"} {
		if _, res := oauthSignIn(t, srv.URL, "google", google("oauth-plain-"+rnd()+"@example.test"), n); res.Header.Get("Location") != "http://web.example/" || sessionOf(res) == nil {
			t.Errorf("next %q: %q", n, res.Header.Get("Location"))
		}
	}

	// 3. The state: replayed, fed to another browser (no binding), or tampered — refused, no session.
	u := google("oauth-state-" + rnd() + "@example.test")
	b = newBrowser(t, srv.URL)
	to := b.start("google", "/en/workspaces")
	cb := "/api/auth/oauth/google/callback?state=" + url.QueryEscape(to.Query().Get("state")) + "&code=" + url.QueryEscape(u.code())
	if res := newBrowser(t, srv.URL).get(cb); sessionOf(res) != nil || !strings.HasPrefix(res.Header.Get("Location"), "http://web.example/login?error=oauth_failed") {
		t.Errorf("another browser's callback: %q", res.Header.Get("Location"))
	}
	if res := b.get(cb); sessionOf(res) == nil {
		t.Errorf("the right browser: %q", res.Header.Get("Location"))
	}
	b2 := newBrowser(t, srv.URL)
	b2.start("google", "")
	if res := b2.get(cb); sessionOf(res) != nil {
		t.Errorf("a spent state was accepted again: %q", res.Header.Get("Location"))
	}
	tampered := strings.Replace(to.Query().Get("state"), ".", "x.", 1)
	b3 := newBrowser(t, srv.URL)
	b3.start("google", "")
	if res := b3.get("/api/auth/oauth/google/callback?state=" + url.QueryEscape(tampered) + "&code=" + url.QueryEscape(u.code())); sessionOf(res) != nil {
		t.Error("a tampered state was accepted")
	}
	// Cancelled at Google: back to the sign-in page with `next`, quietly.
	b4 := newBrowser(t, srv.URL)
	to = b4.start("google", "/en/workspaces")
	if res := b4.get("/api/auth/oauth/google/callback?error=access_denied&state=" + url.QueryEscape(to.Query().Get("state"))); res.Header.Get("Location") !=
		"http://web.example/login?error=oauth_cancelled&next="+url.QueryEscape("/en/workspaces") {
		t.Errorf("cancelled: %q", res.Header.Get("Location"))
	}

	// 4. A suspended account: no session, sent to the sign-in page with the reason.
	_, susID, susEmail := signup(t, a, srv.URL, "oauth-suspended")
	if _, err := a.SysDB.Exec(`INSERT INTO platform_users (user_id, suspended_at, updated_at) VALUES ($1, now(), now())
		ON CONFLICT (user_id) DO UPDATE SET suspended_at = now()`, susID); err != nil {
		t.Fatal(err)
	}
	platform.Invalidate(susID)
	b, res = oauthSignIn(t, srv.URL, "google", google(susEmail), "/en/workspaces")
	if res.Header.Get("Location") != "http://web.example/login?error=account_suspended" || sessionOf(res) != nil {
		t.Errorf("suspended: %q", res.Header.Get("Location"))
	}
	if code := b.me(); code != 401 {
		t.Errorf("suspended account holds a session: /api/auth/me %d", code)
	}

	// 5. Two-factor on: no session; the challenge rides in the fragment and finishes as usual.
	dana, danaID, danaEmail := signup(t, a, srv.URL, "oauth-2fa")
	secret := dana.must("POST", "/api/me/2fa/enroll", map[string]string{"password": "correct-horse-9"}, 200)["secret"].(string)
	dana.must("POST", "/api/me/2fa/confirm", map[string]string{"code": totpNow(t, secret)}, 200)
	if _, err := a.SysDB.Exec(`UPDATE user_totp SET last_step = 0 WHERE user_id = $1`, danaID); err != nil {
		t.Fatal(err)
	}
	b, res = oauthSignIn(t, srv.URL, "google", google(danaEmail), next)
	prefix := "http://web.example/login?error=mfa_required&next=" + url.QueryEscape(next) + "#mfa_challenge="
	loc := res.Header.Get("Location")
	if !strings.HasPrefix(loc, prefix) || sessionOf(res) != nil {
		t.Fatalf("2FA: %q", loc)
	}
	if code := b.me(); code != 401 {
		t.Errorf("2FA account signed in without a code: /api/auth/me %d", code)
	}
	ch, _ := url.QueryUnescape(strings.TrimPrefix(loc, prefix))
	if code, out := postJSON(t, srv.URL+"/api/auth/2fa/challenge", map[string]string{"challenge": ch, "code": totpNow(t, secret)}); code != 200 || out["token"] == nil {
		t.Errorf("finishing the challenge: %d %v", code, out)
	}

	// 6. OAUTH_AFTER_LOGIN can't open a way around the checks: the plugin is never reached.
	t.Setenv("OAUTH_AFTER_LOGIN", "/somewhere")
	if _, res := oauthSignIn(t, srv.URL, "google", google(susEmail), ""); res.Header.Get("Location") != "http://web.example/login?error=account_suspended" || sessionOf(res) != nil {
		t.Errorf("with OAUTH_AFTER_LOGIN: %q", res.Header.Get("Location"))
	}
}

func TestSocialIdentities(t *testing.T) {
	t.Setenv("OAUTH_GOOGLE_CLIENT_ID", "test-client")
	t.Setenv("OAUTH_GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("OAUTH_GITHUB_CLIENT_ID", "test-client")
	t.Setenv("OAUTH_GITHUB_CLIENT_SECRET", "test-secret")
	t.Setenv("WEB_URL", "http://web.example")
	a, srv := bootStack(t)
	installFakeProviders(t)

	userFor := func(res *http.Response) string {
		t.Helper()
		ck := sessionOf(res)
		if ck == nil {
			t.Fatalf("no session: %q", res.Header.Get("Location"))
		}
		c := newClient(t, srv.URL)
		c.bearer = ck.Value
		return c.must("GET", "/api/auth/me", nil, 200)["id"].(string)
	}
	linked := func(provider, sub string) string {
		var id string
		_ = a.SysDB.QueryRow(`SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2`, provider, sub).Scan(&id)
		return id
	}

	// 1. A new Google account: created passwordless, verified, named, in the locale of `next`; linked by sub.
	g := fakeUser{Sub: "g-" + rnd(), Email: "soc-g-" + rnd() + "@example.test", Verified: true, Name: "Grace Hopper"}
	_, res := oauthSignIn(t, srv.URL, "google", g, "/ar/workspaces")
	grace := userFor(res)
	if linked("google", g.Sub) != grace {
		t.Fatal("the Google subject was not linked")
	}
	var pw, name, loc string
	var verified bool
	_ = a.SysDB.QueryRow(`SELECT u.password_hash, p.name, coalesce(p.locale, ''), coalesce(pu.email_verified_at IS NOT NULL, false)
		FROM users u JOIN user_profiles p ON p.user_id = u.id LEFT JOIN platform_users pu ON pu.user_id = u.id WHERE u.id = $1`, grace).Scan(&pw, &name, &loc, &verified)
	if pw != "!sso" || name != "Grace Hopper" || loc != "ar" || !verified {
		t.Errorf("new Google account: %q %q %q verified %v", pw, name, loc, verified)
	}

	// 2. The Google account's address changes: the same account, by subject — no second account.
	g.Email = "soc-g-renamed-" + rnd() + "@example.test"
	if _, res := oauthSignIn(t, srv.URL, "google", g, ""); userFor(res) != grace {
		t.Error("a changed Google address made another account")
	}

	// 3. A password account is linked by a VERIFIED address, then found by subject.
	_, pwID, pwEmail := signup(t, a, srv.URL, "soc-link")
	gh := fakeUser{Sub: strconv.FormatInt(time.Now().UnixNano()%1e12, 10), Email: pwEmail, Verified: true, Name: "Linus"}
	if _, res := oauthSignIn(t, srv.URL, "github", gh, ""); userFor(res) != pwID || linked("github", gh.Sub) != pwID {
		t.Error("GitHub with the verified address should sign in to the password account")
	}
	var profName string
	_ = a.SysDB.QueryRow(`SELECT name FROM user_profiles WHERE user_id = $1`, pwID).Scan(&profName)
	if profName != "Linus" {
		t.Errorf("an empty profile name takes the provider's: %q", profName)
	}

	// 4. An UNVERIFIED address never links to an existing account.
	_, _, victim := signup(t, a, srv.URL, "soc-victim")
	evil := fakeUser{Sub: "g-" + rnd(), Email: victim, Verified: false}
	if _, res := oauthSignIn(t, srv.URL, "google", evil, "/en/workspaces"); sessionOf(res) != nil ||
		res.Header.Get("Location") != "http://web.example/login?error=account_exists&next="+url.QueryEscape("/en/workspaces") {
		t.Errorf("unverified address: %q", res.Header.Get("Location"))
	}
	if linked("google", evil.Sub) != "" {
		t.Error("an unverified address was linked")
	}

	// 5. Deleting the account (the purge) drops its links: the subject no longer reaches the row.
	if _, err := a.SysDB.Exec(`INSERT INTO platform_users (user_id, deletion_requested_at, purge_after, updated_at) VALUES ($1, now(), now(), now())
		ON CONFLICT (user_id) DO UPDATE SET deletion_requested_at = now(), purge_after = now()`, grace); err != nil {
		t.Fatal(err)
	}
	acct := &account.Service{DB: a.SysDB, Log: a.Log}
	if _, err := acct.PurgeDue(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if linked("google", g.Sub) != "" {
		t.Error("the purge kept the Google link")
	}
}

// appleWeb runs the web Sign in with Apple: start, then Apple's form_post with an id_token for sub.
func appleWeb(t *testing.T, srv string, idp *appleIDP, services, sub, email, next string, first bool) (*browser, *http.Response) {
	t.Helper()
	b := newBrowser(t, srv)
	to := b.start("apple", next)
	q := to.Query()
	if to.Host != "appleid.apple.com" || q.Get("client_id") != services || q.Get("response_mode") != "form_post" ||
		q.Get("response_type") != "code id_token" || q.Get("redirect_uri") != srv+"/api/auth/oauth/apple/callback" {
		t.Fatalf("authorize URL: %s", to)
	}
	tok, _ := idp.token(t, sub, email, true, func(c jwt.MapClaims) {
		c["aud"] = services
		c["nonce"] = q.Get("nonce") // Apple copies the request's nonce into the token
	})
	form := url.Values{"state": {q.Get("state")}, "code": {sub}, "id_token": {tok}}
	if first {
		form.Set("user", `{"name":{"firstName":"Tim","lastName":"Apple"},"email":"`+email+`"}`)
	}
	// As a browser sends Apple's form_post: a cross-site POST from appleid.apple.com.
	req, _ := http.NewRequest(http.MethodPost, srv+"/api/auth/oauth/apple/callback", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", "https://appleid.apple.com")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	res, err := b.c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return b, res
}

func TestAppleWebSignIn(t *testing.T) {
	const services = "com.fadymondy.mahaam.web.test"
	idp := newAppleIDP(t)
	t.Setenv("APPLE_SERVICES_ID", services)
	t.Setenv("WEB_URL", "http://web.example")
	f := installFakeProviders(t)
	withAppleKey(t, f)
	a, srv := bootStack(t)
	t.Setenv("APP_URL", srv.URL)

	// 0. Apple is listed for the browser (web and Android), first.
	_, body := getJSON(t, srv.URL+"/api/auth/methods")
	if m := body["methods"].([]any); len(m) == 0 || m[0].(map[string]any)["name"] != "apple" || m[0].(map[string]any)["type"] != "oauth" ||
		m[0].(map[string]any)["url"] != "/api/auth/oauth/apple" {
		t.Errorf("methods: %v", body)
	}

	// 1. First sign-in: a new account named from Apple's `user`, signed in, refresh token kept for the Services ID.
	sub, email := "001.web."+rnd(), "web-"+rnd()+"@privaterelay.appleid.com"
	b, res := appleWeb(t, srv.URL, idp, services, sub, email, "/en/workspaces", true)
	if res.Header.Get("Location") != "http://web.example/en/workspaces" || sessionOf(res) == nil {
		t.Fatalf("apple web: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	if b.me() != 200 {
		t.Error("not signed in after Apple")
	}
	var userID, name, client, sealed string
	if err := a.SysDB.QueryRow(`SELECT i.user_id, p.name, i.token_client_id, i.refresh_token FROM user_identities i JOIN user_profiles p ON p.user_id = i.user_id
		WHERE i.provider = 'apple' AND i.subject = $1`, sub).Scan(&userID, &name, &client, &sealed); err != nil {
		t.Fatal(err)
	}
	if name != "Tim Apple" || client != services || sealed == "" || strings.Contains(sealed, "rt-") {
		t.Errorf("identity: name %q client %q sealed %q", name, client, sealed)
	}

	// 2. Again (no `user` this time): the same account.
	if _, res := appleWeb(t, srv.URL, idp, services, sub, "", "", false); userOfSession(t, srv.URL, res) != userID {
		t.Error("a second Apple web sign-in made another account")
	}

	// 3. A token for another audience (the iOS bundle id) or with another nonce is refused.
	b = newBrowser(t, srv.URL)
	to := b.start("apple", "")
	tok, _ := idp.token(t, sub, email, true, func(c jwt.MapClaims) { c["nonce"] = to.Query().Get("nonce") }) // aud = the app's
	res, _ = b.c.PostForm(srv.URL+"/api/auth/oauth/apple/callback", url.Values{"state": {to.Query().Get("state")}, "id_token": {tok}})
	if sessionOf(res) != nil || !strings.Contains(res.Header.Get("Location"), "error=oauth_failed") {
		t.Errorf("wrong audience: %q", res.Header.Get("Location"))
	}
	b = newBrowser(t, srv.URL)
	to = b.start("apple", "")
	tok, _ = idp.token(t, sub, email, true, func(c jwt.MapClaims) { c["aud"] = services })
	res, _ = b.c.PostForm(srv.URL+"/api/auth/oauth/apple/callback", url.Values{"state": {to.Query().Get("state")}, "id_token": {tok}})
	if sessionOf(res) != nil {
		t.Error("an Apple token with another nonce was accepted")
	}

	// 4. Without the Apple key, the web flow still signs in; there is just no token to revoke.
	t.Setenv("APPLE_PRIVATE_KEY", "")
	sub2 := "001.web.nokey." + rnd()
	if _, res := appleWeb(t, srv.URL, idp, services, sub2, "nokey-"+rnd()+"@example.test", "", true); sessionOf(res) == nil {
		t.Errorf("without the key: %q", res.Header.Get("Location"))
	}
	var sealed2 string
	_ = a.SysDB.QueryRow(`SELECT refresh_token FROM user_identities WHERE provider = 'apple' AND subject = $1`, sub2).Scan(&sealed2)
	if sealed2 != "" {
		t.Error("a refresh token without the key?")
	}
}

func userOfSession(t *testing.T, srv string, res *http.Response) string {
	t.Helper()
	ck := sessionOf(res)
	if ck == nil {
		t.Fatalf("no session: %q", res.Header.Get("Location"))
	}
	c := newClient(t, srv)
	c.bearer = ck.Value
	return c.must("GET", "/api/auth/me", nil, 200)["id"].(string)
}

func TestAppleRevokeOnDelete(t *testing.T) {
	mailDir := t.TempDir()
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", mailDir)
	idp := newAppleIDP(t)
	f := installFakeProviders(t)
	withAppleKey(t, f)
	a, srv := bootStack(t)
	const codeMail = "لتأكيد أنك صاحب الحساب"

	// The iOS app sends the authorizationCode with the identity token: the server trades it for a
	// refresh token (client id = the token's audience, the bundle id) and keeps it sealed.
	sub, email := "001.native."+rnd(), "native-"+rnd()+"@privaterelay.appleid.com"
	tok, raw := idp.token(t, sub, email, true)
	code, out := postJSON(t, srv.URL+"/api/auth/apple", map[string]any{"identity_token": tok, "nonce": raw, "authorization_code": sub, "device_name": "iPhone"})
	if code != 200 {
		t.Fatalf("apple sign-in: %d %v", code, out)
	}
	var client, sealed string
	_ = a.SysDB.QueryRow(`SELECT token_client_id, refresh_token FROM user_identities WHERE provider = 'apple' AND subject = $1`, sub).Scan(&client, &sealed)
	if client != idp.aud || sealed == "" {
		t.Fatalf("kept token: client %q sealed %q", client, sealed)
	}
	// A code that belongs to another Apple ID is not kept against this one.
	sub2 := "001.native.other." + rnd()
	tok2, raw2 := idp.token(t, sub2, "other-"+rnd()+"@example.test", true)
	postJSON(t, srv.URL+"/api/auth/apple", map[string]any{"identity_token": tok2, "nonce": raw2, "authorization_code": "001.someone.else"})
	var sealed2 string
	_ = a.SysDB.QueryRow(`SELECT refresh_token FROM user_identities WHERE provider = 'apple' AND subject = $1`, sub2).Scan(&sealed2)
	if sealed2 != "" {
		t.Error("a refresh token for another subject was kept")
	}

	// Deleting the account (passwordless: the emailed code) revokes the grant at once.
	c := newClient(t, srv.URL)
	c.bearer = out["access_token"].(string)
	c.must("POST", "/api/me/reauth/code", map[string]string{"locale": "ar"}, 202)
	mailCode := codeIn(t, mailTo(t, mailDir, email, codeMail, 0))
	c.must("POST", "/api/me/delete", map[string]any{"email_code": mailCode}, 202)
	want := idp.aud + "/rt-" + sub
	found := false
	for _, r := range f.revokedList() {
		found = found || r == want
	}
	if !found {
		t.Errorf("revoked %v, want %s", f.revokedList(), want)
	}
	_ = a.SysDB.QueryRow(`SELECT refresh_token FROM user_identities WHERE provider = 'apple' AND subject = $1`, sub).Scan(&sealed)
	if sealed != "" {
		t.Error("the revoked token is still stored")
	}
}
