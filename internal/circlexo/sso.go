package circlexo

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"

	circlexo "github.com/circlexo/circlexo-go"
	"github.com/circlexo/circlexo-go/oidc"

	"github.com/fadymondy/mahaam/internal/platform"
)

/*
Sign in with CircleXO, next to (not instead of) Mahaam's own login.

Callback rules, in order:
 1. a hub subject already linked to a Mahaam user signs in as that user;
 2. otherwise the hub must vouch for the e-mail (email_verified) — an unverified address is refused;
 3. a Mahaam account with that address is linked — but only one that is "usable" (see
    userByEmail: passwordless, or an address Mahaam itself verified), so nobody can squat someone's
    address with a password and inherit their hub sign-in; anything else is refused;
 4. otherwise a passwordless Mahaam account is created and linked.

A suspended or deleted account is refused in every case. The session is Mahaam's normal one
(auth.IssueSession), so every existing login method keeps working alongside. Mahaam's 2FA is not
asked for: the hub is the identity provider and owns second factors.
*/

// Errors the login page can show, by code (web/lang: auth.circlexo_error.<code>).
const (
	errFailed      = "failed"
	errUnverified  = "email_unverified"
	errUnlinkable  = "account_conflict"
	errSuspended   = "suspended"
	errNoEmail     = "no_email"
	errNotMember   = "not_member"
	errUnavailable = "unavailable"
)

// loginErr is a refusal with a code for the page.
type loginErr struct {
	code string
	err  error
}

func (e *loginErr) Error() string { return e.code + ": " + e.err.Error() }

func refuse(code, msg string) *loginErr { return &loginErr{code, errors.New(msg)} }

// launchHint is the pseudo local path /sso/circlexo hands the OIDC round trip so the org named by
// the hub's launch link survives it; the callback reads the org slug off it.
const launchHint = "/__cxo"

// Login starts the sign-in (GET /auth/circlexo/login[?return_to=/local/path]).
func (s *Service) Login(w http.ResponseWriter, r *http.Request) { s.RP.Login(w, r) }

// Launch is the hub's app launch URL (GET /sso/circlexo?org=<slug>): the hub sends people here
// from its dashboard. They are signed in at the hub already, so the round trip is silent.
func (s *Service) Launch(w http.ResponseWriter, r *http.Request) {
	q := url.Values{}
	if org := strings.TrimSpace(r.URL.Query().Get("org")); org != "" {
		q.Set("return_to", launchHint+"?org="+url.QueryEscape(org))
	}
	http.Redirect(w, r, LoginPath+"?"+q.Encode(), http.StatusFound)
}

// Callback completes the sign-in (GET /auth/circlexo/callback).
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	login, err := s.RP.Exchange(w, r)
	if err != nil {
		s.Log.Warn("circlexo: sign-in failed", "err", err)
		s.fail(w, r, errFailed)
		return
	}
	to, lerr := s.FinishLogin(r.Context(), w, login)
	if lerr != nil {
		s.Log.Warn("circlexo: sign-in refused", "code", lerr.code, "err", lerr.err)
		s.fail(w, r, lerr.code)
		return
	}
	http.Redirect(w, r, to, http.StatusFound)
}

func (s *Service) fail(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/login?circlexo_error="+url.QueryEscape(code), http.StatusFound)
}

func rawString(c *circlexo.Claims, key string) string {
	if c == nil {
		return ""
	}
	v, _ := c.Raw[key].(string)
	return v
}

func rawBool(c *circlexo.Claims, key string) bool {
	if c == nil {
		return false
	}
	switch v := c.Raw[key].(type) {
	case bool:
		return v
	case string:
		return v == "true"
	}
	return false
}

// FinishLogin turns a verified hub sign-in into a Mahaam session and says where to land.
func (s *Service) FinishLogin(ctx context.Context, w http.ResponseWriter, l *oidc.Login) (string, *loginErr) {
	id := l.IDClaims
	if id == nil || id.Subject == "" {
		return "", refuse(errFailed, "no subject")
	}
	userID, lerr := s.linkedUser(ctx, l)
	if lerr != nil {
		return "", lerr
	}

	u, err := platform.Load(ctx, s.DB, userID)
	if err != nil || u.Suspended() || u.DeletedAt != nil {
		return "", refuse(errSuspended, "the account is suspended or deleted")
	}

	to, lerr := s.landing(ctx, l, userID)
	if lerr != nil {
		return "", lerr
	}

	ident, err := s.Auth.FindOrCreateByEmail(ctx, u.Email)
	if err != nil || ident.ID != userID {
		return "", refuse(errFailed, "could not start the session")
	}
	token, err := s.Auth.IssueSession(w, *ident)
	if err != nil {
		return "", refuse(errFailed, "could not start the session")
	}
	sid := l.AccessClaims.SessionID
	if sid == "" {
		sid = id.SessionID
	}
	s.recordSession(ctx, sid, userID, token)
	return to, nil
}

// linkedUser is rules 1-4 of the header comment.
func (s *Service) linkedUser(ctx context.Context, l *oidc.Login) (string, *loginErr) {
	id := l.IDClaims
	if uid, err := s.UserBySubject(ctx, id.Subject); err == nil {
		return uid, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return "", &loginErr{errUnavailable, err}
	}

	email := norm(firstNonEmpty(rawString(id, "email"), rawString(l.AccessClaims, "email")))
	if email == "" {
		return "", refuse(errNoEmail, "the hub sent no e-mail address")
	}
	verified := rawBool(id, "email_verified") || rawBool(l.AccessClaims, "email_verified")
	if !verified {
		return "", refuse(errUnverified, "the hub has not verified this address")
	}

	uid, _, usable, err := s.userByEmail(ctx, email)
	switch {
	case err == nil:
		if !usable {
			return "", refuse(errUnlinkable, "an account with this address exists but has not confirmed it")
		}
		got, err := s.linkUser(ctx, id.Subject, uid, email, "email")
		if err != nil {
			return "", &loginErr{errUnavailable, err}
		}
		if got != uid {
			return "", refuse(errUnlinkable, "the account is already linked to another CircleXO user")
		}
		return uid, nil
	case !errors.Is(err, sql.ErrNoRows):
		return "", &loginErr{errUnavailable, err}
	}

	ident, err := s.Auth.FindOrCreateByEmail(ctx, email)
	if err != nil {
		return "", &loginErr{errUnavailable, err}
	}
	// The hub vouched for the address, so Mahaam need not ask again.
	if _, err := s.DB.ExecContext(ctx, `
		INSERT INTO platform_users (user_id, email_verified_at, updated_at) VALUES ($1, now(), now())
		ON CONFLICT (user_id) DO UPDATE SET email_verified_at = coalesce(platform_users.email_verified_at, now()), updated_at = now()`, ident.ID); err != nil {
		return "", &loginErr{errUnavailable, err}
	}
	got, err := s.linkUser(ctx, id.Subject, ident.ID, email, "created")
	if err != nil {
		return "", &loginErr{errUnavailable, err}
	}
	if got != ident.ID {
		return "", refuse(errUnlinkable, "the account is already linked to another CircleXO user")
	}
	return got, nil
}

// landing puts the user into the workspace mapped to the token's org (adding them with the hub
// role) and returns the page to open. With no org in play, the web app's own home decides.
func (s *Service) landing(ctx context.Context, l *oidc.Login, userID string) (string, *loginErr) {
	ac := l.AccessClaims
	orgID := ac.OrgID
	slugHint := ""
	if strings.HasPrefix(l.ReturnTo, launchHint) {
		v, _ := url.ParseQuery(strings.TrimPrefix(l.ReturnTo, launchHint+"?"))
		slugHint = v.Get("org")
	} else if l.ReturnTo != "" && orgID == "" {
		return l.ReturnTo, nil
	}
	if orgID == "" && slugHint != "" {
		_ = s.DB.QueryRowContext(ctx, `SELECT org_id FROM circlexo_org_links WHERE org_slug = $1 AND status = 'active'`, slugHint).Scan(&orgID)
	}
	if orgID == "" {
		return "/", nil
	}
	link, err := s.OrgByID(ctx, orgID)
	if errors.Is(err, sql.ErrNoRows) {
		// The hub installed the app but the webhook has not (or did not) arrive: provision now if
		// the hub confirms the org has the app.
		if _, terr := s.Client.TenantByOrg(ctx, orgID); terr != nil {
			return "/", nil
		}
		if link, err = s.Provision(ctx, ProvisionInput{OrgID: orgID, Slug: slugHint}); err != nil {
			s.Log.Error("circlexo: provisioning at sign-in", "org", orgID, "err", err)
			return "/", nil
		}
	} else if err != nil {
		return "", &loginErr{errUnavailable, err}
	}
	if !link.Active {
		return "/", nil
	}
	if err := s.setMember(ctx, link.WorkspaceID, userID, ac.OrgRole); err != nil {
		return "", &loginErr{errUnavailable, err}
	}
	locale := link.Locale
	if locale != "ar" {
		locale = "en"
	}
	return "/" + locale + "/w/" + link.WorkspaceSlug, nil
}

// Logout clears Mahaam's session and returns to the login page. Mahaam's session is a stateless
// token, so this ends it in this browser only; a copy of the token stays valid until it expires
// or the user is signed out everywhere (the same as Mahaam's own sign-out).
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	secure := strings.HasPrefix(baseURL(), "https://") || os.Getenv("COOKIE_SECURE") == "true"
	http.SetCookie(w, &http.Cookie{Name: "togo_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	post := baseURL() + "/login"
	s.RP.Logout(post)(w, r)
}

// LoginError is a refused sign-in, exported so callers and tests can read its code.
type LoginError = loginErr

// Code is the short refusal code the login page translates.
func (e *loginErr) Code() string { return e.code }
