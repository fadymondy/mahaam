package server

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"unicode"

	"github.com/togo-framework/auth"

	"github.com/fadymondy/mahaam/internal/account"
	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/platform"
)

/*
Sign in with Apple, Google and GitHub in a browser, served by the guard (account/social_flow.go
does the provider work and the account linking).

Every route under /api/auth/oauth/ is answered here, before the auth-oauth plugin's handlers: a
provider we know is ours, anything else is 404. So no sign-in can reach the plugin's callback,
which would issue a session without asking whether the account is suspended or has a second
factor (and whose success redirect, OAUTH_AFTER_LOGIN, is not ours to rely on).

  - GET /api/auth/oauth/{provider}?next=/path — a same-origin relative `next` (one leading "/", no
    scheme, host, backslash or control characters) goes into the signed state; a random binding
    goes into a short-lived HttpOnly cookie scoped to /api/auth/oauth/; 302 to the provider.
  - GET (Google, GitHub) or POST (Apple's form_post) /api/auth/oauth/{provider}/callback — the
    provider's answer is checked and the account found or made, then:
      suspended (or anonymised) account → no session; /login?error=account_suspended;
      two-factor on                     → no session; /login?error=mfa_required&next=…, with the
                                          sealed challenge in the fragment (#mfa_challenge=…) for
                                          POST /api/auth/2fa/challenge. A provider sign-in is the
                                          first factor only, exactly like a password;
      a refusal                         → /login?error=<code> (oauth_failed, oauth_cancelled,
                                          account_exists, email_required), with `next` kept;
      otherwise                         → a session, and the saved `next`, or "/" (the web sends a
                                          signed-in person on to their workspaces).
    Every Location is WEB_URL + path when WEB_URL is set (the callback is served on the API's
    origin), else relative.

GET /api/auth/methods is answered here too: the auth plugin's list with its OAuth entries replaced
by ours (apple, google, github, as configured). Apple is listed even without the web flow, as
type "native": the iOS app's native sign-in (POST /api/auth/apple) needs no server setting.
*/

const (
	oauthPrefix     = "/api/auth/oauth/"
	oauthBindCookie = "mahaam_oauth_bind"
)

// oauthRoute splits a path under /api/auth/oauth/ into its provider and kind.
func oauthRoute(path string) (provider string, start, callback bool) {
	rest, ok := strings.CutPrefix(path, oauthPrefix)
	if !ok || rest == "" {
		return "", false, false
	}
	provider, tail, hasTail := strings.Cut(rest, "/")
	if provider == "" {
		return "", false, false
	}
	if !hasTail {
		return provider, true, false
	}
	return provider, false, tail == "callback"
}

// safeNext accepts only a same-origin path: "/x…", never "//host", "/\host", a scheme, or
// anything with control characters or whitespace a browser might normalise away.
func safeNext(raw string) (string, bool) {
	if raw == "" || len(raw) > 2048 || raw[0] != '/' {
		return "", false
	}
	if len(raw) > 1 && (raw[1] == '/' || raw[1] == '\\') {
		return "", false
	}
	for _, r := range raw {
		if r == '\\' || unicode.IsControl(r) || unicode.IsSpace(r) {
			return "", false
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil || u.Opaque != "" {
		return "", false
	}
	return raw, true
}

func webBase() string {
	if v := strings.TrimRight(os.Getenv("WEB_URL"), "/"); v != "" {
		return v
	}
	return ""
}

func cookiesSecure() bool {
	if v := os.Getenv("COOKIE_SECURE"); v != "" {
		return v == "1" || v == "true"
	}
	for _, k := range []string{"APP_ENV", "ENV", "TOGO_ENV"} {
		if e := strings.ToLower(os.Getenv(k)); e != "" {
			return e == "production" || e == "prod"
		}
	}
	return false
}

// oauthBindCookieFor is the binding cookie. Apple's callback is a cross-site POST, which only
// carries SameSite=None cookies, and those must be Secure; plain-http development uses Lax (and
// can't run Apple's web flow, which wants an https return URL anyway).
func oauthBindCookieFor(value string, maxAge int) *http.Cookie {
	c := &http.Cookie{Name: oauthBindCookie, Value: value, Path: oauthPrefix, HttpOnly: true, MaxAge: maxAge, SameSite: http.SameSiteLaxMode}
	if cookiesSecure() {
		c.Secure, c.SameSite = true, http.SameSiteNoneMode
	}
	return c
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func knownProvider(p string) bool {
	for _, k := range account.SocialProviders {
		if k == p {
			return true
		}
	}
	return false
}

// socialRoutes serves everything under /api/auth/oauth/.
func socialRoutes(svc *auth.Service, a *app.App, acct *account.Service) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provider, start, callback := oauthRoute(r.URL.Path)
		switch {
		case !knownProvider(provider) || (!start && !callback):
			writeError(w, http.StatusNotFound, "not found")
		case start && r.Method == http.MethodGet:
			socialStart(w, r, acct, provider)
		case callback && (r.Method == http.MethodGet || (r.Method == http.MethodPost && provider == "apple")):
			socialCallback(w, r, svc, a, acct, provider)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}

func socialStart(w http.ResponseWriter, r *http.Request, acct *account.Service, provider string) {
	if !account.SocialWebConfigured(provider) {
		writeError(w, http.StatusServiceUnavailable, provider+" sign-in is not configured")
		return
	}
	next, _ := safeNext(r.URL.Query().Get("next"))
	bind := randHex(32)
	to, err := acct.SocialStart(provider, next, bind)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, provider+" sign-in is not configured")
		return
	}
	http.SetCookie(w, oauthBindCookieFor(bind, 600))
	http.Redirect(w, r, to, http.StatusFound)
}

func socialCallback(w http.ResponseWriter, r *http.Request, svc *auth.Service, a *app.App, acct *account.Service, provider string) {
	params := r.URL.Query()
	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		if err := r.ParseForm(); err != nil {
			writeError(w, http.StatusBadRequest, "bad form")
			return
		}
		params = r.PostForm
	}
	bind := ""
	if c, err := r.Cookie(oauthBindCookie); err == nil {
		bind = c.Value
	}
	// The binding is single-use, whatever happens next.
	http.SetCookie(w, oauthBindCookieFor("", -1))

	base := webBase()
	login := func(code, next string, fragment string) {
		loc := "/login?error=" + url.QueryEscape(code)
		if n, ok := safeNext(next); ok {
			loc += "&next=" + url.QueryEscape(n)
		}
		http.Redirect(w, r, base+loc+fragment, http.StatusFound)
	}

	res, err := acct.SocialFinish(r.Context(), provider, params, bind)
	if err != nil {
		code := "oauth_failed"
		if se, ok := err.(*account.SocialError); ok {
			code = se.Code
		}
		next := ""
		if res != nil {
			next = res.Next
		}
		a.Log.Info("social sign-in refused", "provider", provider, "err", err)
		login(code, next, "")
		return
	}
	// The same gates as a password sign-in (guard.go): suspended accounts don't get in, and a
	// second factor is asked for before any session is issued.
	u, err := platform.Load(r.Context(), a.SysDB, res.UserID)
	if err != nil || u.DeletedAt != nil {
		login("oauth_failed", res.Next, "")
		return
	}
	if u.Suspended() {
		login("account_suspended", "", "")
		return
	}
	if account.TwoFAEnabled(r.Context(), a.SysDB, res.UserID) {
		frag := ""
		if ch, err := acct.SignInChallenge(r.Context(), res.UserID); err == nil {
			frag = "#mfa_challenge=" + url.QueryEscape(ch)
		}
		login("mfa_required", res.Next, frag)
		return
	}
	id, err := acct.IdentityOf(r.Context(), res.UserID)
	if err != nil {
		login("oauth_failed", res.Next, "")
		return
	}
	if _, err := svc.IssueSession(w, *id); err != nil {
		a.Log.Error("social sign-in session", "err", err)
		login("oauth_failed", res.Next, "")
		return
	}
	dest := res.Next
	if dest == "" {
		dest = "/"
	}
	http.Redirect(w, r, base+dest, http.StatusFound)
}

// loginMethods answers GET /api/auth/methods: the plugin's list without its OAuth entries, then
// ours.
func loginMethods(next http.Handler) http.Handler {
	labels := map[string]string{"apple": "Apple", "google": "Google", "github": "GitHub"}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := httptest.NewRecorder()
		next.ServeHTTP(rec, r)
		var body struct {
			Methods []auth.LoginMethod `json:"methods"`
		}
		if rec.Code != http.StatusOK || json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&body) != nil {
			for k, v := range rec.Header() {
				w.Header()[k] = v
			}
			w.WriteHeader(rec.Code)
			_, _ = w.Write(rec.Body.Bytes())
			return
		}
		out := []auth.LoginMethod{}
		for _, m := range body.Methods {
			if m.Type == "oauth" {
				continue
			}
			out = append(out, m)
		}
		web := account.SocialWebProviders()
		if len(web) == 0 || web[0] != "apple" {
			out = append(out, auth.LoginMethod{Name: "apple", Label: "Continue with Apple", Type: "native", URL: "/api/auth/apple"})
		}
		for _, p := range web {
			out = append(out, auth.LoginMethod{Name: p, Label: "Continue with " + labels[p], Type: "oauth", URL: oauthPrefix + p})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"methods": out})
	})
}
