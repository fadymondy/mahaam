package server

import (
	"net/http"
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
Google/GitHub sign-in through the auth-oauth plugin (v0.2.0), finished on our terms.

The plugin's callback signs the person in and then always redirects to a hard-coded "/dashboard"
(auth-oauth oauth.go:147). It ignores the `next` the web puts on the provider button, and Mahaam
has no /dashboard: the browser landed on the web's 404, and an app sign-in started in the system
browser (/{locale}/app-signin?…, README "Clients") never got back to the app. The callback also
issued the session without asking whether the account is suspended or has a second factor.

The module cache is not ours to edit, so the guard wraps the two routes:

  - GET /api/auth/oauth/{provider}?next=/path — a same-origin relative `next` (starts with one "/",
    no scheme, no host, no backslash, no control characters) is kept in a short-lived HttpOnly
    cookie scoped to /api/auth/oauth/, then the plugin redirects to the provider as before.
  - GET /api/auth/oauth/{provider}/callback — the plugin runs untouched. Only its success, the 302
    to /dashboard, is rewritten before any byte is sent:
      suspended (or anonymised) account → its new session cookie is withdrawn and cleared, and the
                                          browser goes to /login?error=account_suspended;
      two-factor on                     → the same, to /login?error=mfa_required&next=…, with the
                                          sealed challenge in the fragment (#mfa_challenge=…) for
                                          POST /api/auth/2fa/challenge. A Google/GitHub sign-in is
                                          the first factor only, exactly like a password;
      otherwise                         → the saved `next`, or "/" (the web sends a signed-in
                                          person on to their workspaces).
    Every rewritten Location is WEB_URL + path when WEB_URL is set (the callback may be served on
    the API's own origin), else relative. Failures (bad state, provider errors) pass through as
    the plugin wrote them.

Identifying the user reads the plugin's session cookie, which with SESSION_DRIVER=cookie (the only
driver Mahaam runs, see the 2FA notes) holds the JWT itself. If it can't be read and verified, the
sign-in is refused rather than let through unchecked.
*/

const (
	oauthPrefix     = "/api/auth/oauth/"
	oauthNextCookie = "mahaam_oauth_next"
)

// oauthRoute reports whether path is the plugin's start route or its callback.
func oauthRoute(path string) (start, callback bool) {
	rest, ok := strings.CutPrefix(path, oauthPrefix)
	if !ok || rest == "" {
		return false, false
	}
	provider, tail, hasTail := strings.Cut(rest, "/")
	if provider == "" {
		return false, false
	}
	if !hasTail {
		return true, false
	}
	return false, tail == "callback"
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

func oauthNextCookieFor(value string, maxAge int) *http.Cookie {
	secure := false
	if v := os.Getenv("COOKIE_SECURE"); v != "" {
		secure = v == "1" || v == "true"
	} else {
		for _, k := range []string{"APP_ENV", "ENV", "TOGO_ENV"} {
			if e := strings.ToLower(os.Getenv(k)); e != "" {
				secure = e == "production" || e == "prod"
				break
			}
		}
	}
	// Lax: the callback is a top-level GET navigation from the provider, which Lax cookies ride.
	return &http.Cookie{Name: oauthNextCookie, Value: value, Path: oauthPrefix, HttpOnly: true, Secure: secure,
		SameSite: http.SameSiteLaxMode, MaxAge: maxAge}
}

// oauthStart remembers a valid `next` for the callback. A missing or unsafe one clears any
// leftover, so an abandoned earlier attempt can't choose where this one lands.
func oauthStart(w http.ResponseWriter, r *http.Request) {
	if n, ok := safeNext(r.URL.Query().Get("next")); ok {
		http.SetCookie(w, oauthNextCookieFor(url.QueryEscape(n), 600))
		return
	}
	if _, err := r.Cookie(oauthNextCookie); err == nil {
		http.SetCookie(w, oauthNextCookieFor("", -1))
	}
}

// oauthCallback runs the plugin's callback with its success redirect intercepted.
func oauthCallback(next http.Handler, svc *auth.Service, a *app.App, acct *account.Service) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dest := ""
		if c, err := r.Cookie(oauthNextCookie); err == nil {
			if v, err := url.QueryUnescape(c.Value); err == nil {
				dest, _ = safeNext(v)
			}
		}
		iw := &oauthRedirectWriter{ResponseWriter: w}
		iw.decide = func(h http.Header) {
			h.Del("Content-Type") // http.Redirect's little HTML body is dropped with it
			base := webBase()
			refuse := func(loc string) {
				withdrawSession(h)
				h.Set("Location", base+loc)
			}
			token := sessionFromSetCookie(h)
			id, err := svc.Verify(token)
			if token == "" || err != nil || id == nil {
				refuse("/login?error=oauth_failed")
				return
			}
			u, err := platform.Load(r.Context(), a.SysDB, id.ID)
			if err != nil || u.DeletedAt != nil {
				refuse("/login?error=oauth_failed")
				return
			}
			if u.Suspended() {
				refuse("/login?error=account_suspended")
				return
			}
			if account.TwoFAEnabled(r.Context(), a.SysDB, id.ID) {
				loc := "/login?error=mfa_required"
				if dest != "" {
					loc += "&next=" + url.QueryEscape(dest)
				}
				if ch, err := acct.SignInChallenge(r.Context(), id.ID); err == nil {
					loc += "#mfa_challenge=" + url.QueryEscape(ch)
				}
				refuse(loc)
				return
			}
			if dest == "" {
				dest = "/"
			}
			h.Set("Location", base+dest)
		}
		if _, err := r.Cookie(oauthNextCookie); err == nil {
			http.SetCookie(w, oauthNextCookieFor("", -1))
		}
		next.ServeHTTP(iw, r)
	})
}

// sessionFromSetCookie finds the session token the plugin just set.
func sessionFromSetCookie(h http.Header) string {
	token := ""
	for _, c := range (&http.Response{Header: http.Header{"Set-Cookie": h.Values("Set-Cookie")}}).Cookies() {
		if c.Name == auth.SessionCookie && c.Value != "" {
			token = c.Value
		}
	}
	return token
}

// withdrawSession removes the session cookie the plugin set and clears any the browser holds.
func withdrawSession(h http.Header) {
	kept := []string{}
	for _, line := range h.Values("Set-Cookie") {
		if c, err := http.ParseSetCookie(line); err == nil && c.Name == auth.SessionCookie {
			continue
		}
		kept = append(kept, line)
	}
	h.Del("Set-Cookie")
	for _, line := range kept {
		h.Add("Set-Cookie", line)
	}
	h.Add("Set-Cookie", (&http.Cookie{Name: auth.SessionCookie, Value: "", Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: -1}).String())
}

// oauthRedirectWriter rewrites the plugin's success redirect (302 Location: /dashboard) in place,
// before the header is written, and swallows the body http.Redirect writes for it.
type oauthRedirectWriter struct {
	http.ResponseWriter
	decide    func(http.Header)
	wrote     bool
	rewritten bool
}

func (o *oauthRedirectWriter) WriteHeader(code int) {
	if o.wrote {
		return
	}
	o.wrote = true
	if code == http.StatusFound && o.Header().Get("Location") == "/dashboard" {
		o.rewritten = true
		o.decide(o.Header())
	}
	o.ResponseWriter.WriteHeader(code)
}

func (o *oauthRedirectWriter) Write(b []byte) (int, error) {
	if !o.wrote {
		o.WriteHeader(http.StatusOK)
	}
	if o.rewritten {
		return len(b), nil
	}
	return o.ResponseWriter.Write(b)
}
