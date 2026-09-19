package work

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/secretbox"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Per-user GitHub accounts (user_github_accounts): which GitHub login and e-mail addresses are
which workspace member, so the GitHub App's event log (github_events: commits, pull requests,
deployments) can be attributed to a person in the employee KPI (kpi.go). Attribution happens at
query time (author_login or author_email matches), so connecting an account covers every event
logged before it too.

Two ways in:

  - OAuth, by the member themself: GET /api/w/me/github/connect returns GitHub's authorize URL for
    the GitHub App's user authorization (GITHUB_APP_CLIENT_ID) with a state signed by secretbox
    {workspace, user, slug, locale, nonce, expiry}; the nonce is also an HttpOnly cookie scoped to
    the callback, so a link started by someone else cannot bind their GitHub account to you.
    GET /api/integrations/github/user-callback (PUBLIC, guard allowlist) verifies both, exchanges
    the code, reads /user and /user/emails (verified addresses only, plus the account's
    <id>+<login>@users.noreply.github.com), stores them with the user token sealed, and sends the
    browser back to /{locale}/w/{slug}/me.
  - manual, by a manager (kpi:all): PUT /api/w/members/{user}/github {login, emails} for people who
    will not connect.

Configuration (env): GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET, GITHUB_WEB_URL /
GITHUB_API_URL (defaults github.com / api.github.com), APP_URL (the callback is
<APP_URL>/api/integrations/github/user-callback — add it to the App's "Callback URLs"; or set
GITHUB_USER_REDIRECT_URL), WEB_URL (where the browser goes back).
*/

// GitHubUserCallbackPath is the public OAuth redirect (internal/server mounts it; guard allowlist).
const GitHubUserCallbackPath = "/api/integrations/github/user-callback"

// GitHubUserStateCookie carries the connect nonce, scoped to the callback path.
const GitHubUserStateCookie = "managy_github_user"

const ghUserStateTTL = 15 * time.Minute

// GitHubAccount is a member's mapped GitHub identity.
type GitHubAccount struct {
	UserID       string    `json:"user_id"`
	Login        string    `json:"login"`
	GitHubID     *int64    `json:"github_id"`
	Emails       []string  `json:"emails"`
	ConnectedVia string    `json:"connected_via" doc:"oauth (the member connected it) or manual (a manager mapped it)"`
	ConnectedAt  time.Time `json:"connected_at"`
}

// GitHubStatus is GET /api/w/me/github and /api/w/members/{user}/github.
type GitHubStatus struct {
	Account        *GitHubAccount `json:"account"`
	OAuthAvailable bool           `json:"oauth_available" doc:"GITHUB_APP_CLIENT_ID / SECRET are set: \"Connect GitHub\" works"`
}

// GitHubMapping is PUT /api/w/members/{user}/github.
type GitHubMapping struct {
	Login  string   `json:"login" doc:"GitHub username" maxLength:"39"`
	Emails []string `json:"emails,omitempty" maxItems:"20" doc:"Commit e-mail addresses of this person"`
}

var ghLoginRe = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`)

type ghUserOAuth struct {
	ClientID, ClientSecret, WebURL, APIURL, RedirectURL string
}

func ghUserConfig() (*ghUserOAuth, bool) {
	c := &ghUserOAuth{
		ClientID:     strings.TrimSpace(os.Getenv("GITHUB_APP_CLIENT_ID")),
		ClientSecret: strings.TrimSpace(os.Getenv("GITHUB_APP_CLIENT_SECRET")),
		WebURL:       strings.TrimRight(ghEnvOr("GITHUB_WEB_URL", "https://github.com"), "/"),
		APIURL:       strings.TrimRight(ghEnvOr("GITHUB_API_URL", "https://api.github.com"), "/"),
		RedirectURL:  strings.TrimSpace(os.Getenv("GITHUB_USER_REDIRECT_URL")),
	}
	if c.RedirectURL == "" {
		c.RedirectURL = strings.TrimRight(os.Getenv("APP_URL"), "/") + GitHubUserCallbackPath
	}
	return c, c.ClientID != "" && c.ClientSecret != ""
}

func ghEnvOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

// ---- signed state -----------------------------------------------------------------------------

// GitHubUserState is what the connect state carries through GitHub and back.
type GitHubUserState struct {
	WS     string `json:"w"`
	User   string `json:"u"`
	Slug   string `json:"s"`
	Locale string `json:"l"`
	Nonce  string `json:"n"`
	Exp    int64  `json:"e"`
}

// The purpose prefix keeps this signature from verifying as any other signed state (the App
// install state, the Google import state) and vice versa.
const ghUserStatePurpose = "github-user:"

// SignGitHubUserState encodes and signs st.
func SignGitHubUserState(st GitHubUserState) string {
	body, _ := json.Marshal(st)
	enc := base64.RawURLEncoding.EncodeToString(body)
	return enc + "." + secretbox.Sign([]byte(ghUserStatePurpose+enc))
}

// VerifyGitHubUserState checks the signature, the fields and the expiry.
func VerifyGitHubUserState(raw string, now time.Time) (*GitHubUserState, error) {
	bad := invalid("the GitHub connect link is invalid — start again from your profile")
	enc, sig, ok := strings.Cut(raw, ".")
	if !ok || sig == "" || !secretbox.Verify([]byte(ghUserStatePurpose+enc), sig) {
		return nil, bad
	}
	body, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return nil, bad
	}
	var st GitHubUserState
	if err := json.Unmarshal(body, &st); err != nil || st.WS == "" || st.User == "" || st.Slug == "" || st.Nonce == "" {
		return nil, bad
	}
	if now.Unix() > st.Exp {
		return nil, invalid("the GitHub connect link expired — start again from your profile")
	}
	return &st, nil
}

// GitHubConnect is the authorize URL plus the nonce cookie to set.
type GitHubConnect struct {
	URL    string
	Cookie *http.Cookie
}

// GitHubConnectURL starts "Connect GitHub" for the signed-in member.
func (sv *Service) GitHubConnectURL(ctx context.Context, locale string) (*GitHubConnect, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.KPIRead); err != nil {
		return nil, err
	}
	cfg, ok := ghUserConfig()
	if !ok {
		return nil, &Error{http.StatusServiceUnavailable, "GitHub sign-in is not configured on this server (GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET) — ask a manager to map your GitHub login instead"}
	}
	if locale != "ar" {
		locale = "en"
	}
	nonce := newID()
	st := GitHubUserState{WS: s.WorkspaceID, User: s.UserID, Slug: s.WorkspaceSlug, Locale: locale, Nonce: nonce, Exp: time.Now().Add(ghUserStateTTL).Unix()}
	q := url.Values{"client_id": {cfg.ClientID}, "redirect_uri": {cfg.RedirectURL}, "state": {SignGitHubUserState(st)}, "allow_signup": {"false"}}
	return &GitHubConnect{
		URL: cfg.WebURL + "/login/oauth/authorize?" + q.Encode(),
		Cookie: &http.Cookie{Name: GitHubUserStateCookie, Value: nonce, Path: GitHubUserCallbackPath, MaxAge: int(ghUserStateTTL / time.Second),
			HttpOnly: true, Secure: strings.HasPrefix(cfg.RedirectURL, "https://"), SameSite: http.SameSiteLaxMode},
	}, nil
}

// GitHubUserCallback serves GET /api/integrations/github/user-callback (PUBLIC; see the guard).
// It trusts nothing but the signed state and the matching nonce cookie.
func (sv *Service) GitHubUserCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		st, err := VerifyGitHubUserState(q.Get("state"), time.Now())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		c, cerr := r.Cookie(GitHubUserStateCookie)
		if cerr != nil || c.Value == "" || c.Value != st.Nonce {
			http.Error(w, "This GitHub connection was started in another browser — start again from your profile.", http.StatusBadRequest)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: GitHubUserStateCookie, Value: "", Path: GitHubUserCallbackPath, MaxAge: -1, HttpOnly: true})
		back := kpiWebBase() + "/" + st.Locale + "/w/" + url.PathEscape(st.Slug) + "/me"
		fail := func(msg string) { http.Redirect(w, r, back+"?github_error="+url.QueryEscape(msg), http.StatusFound) }
		if e := q.Get("error"); e != "" {
			fail("GitHub: " + firstNonEmptyStr(q.Get("error_description"), e))
			return
		}
		if err := sv.completeGitHubUser(r.Context(), st, q.Get("code")); err != nil {
			msg := "your GitHub account could not be connected"
			if e, ok := AsError(err); ok {
				msg = e.Msg
			} else if sv.Log != nil {
				sv.Log.Error("github user connect", "err", err)
			}
			fail(msg)
			return
		}
		http.Redirect(w, r, back+"?github=connected", http.StatusFound)
	}
}

func kpiWebBase() string {
	base := strings.TrimRight(os.Getenv("WEB_URL"), "/")
	if u, err := url.Parse(base); base == "" || err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return base
}

func firstNonEmptyStr(v ...string) string {
	for _, s := range v {
		if strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func (sv *Service) completeGitHubUser(ctx context.Context, st *GitHubUserState, code string) error {
	cfg, ok := ghUserConfig()
	if !ok {
		return &Error{http.StatusServiceUnavailable, "GitHub sign-in is not configured on this server"}
	}
	if strings.TrimSpace(code) == "" {
		return invalid("GitHub sent no authorization code")
	}
	// The person who started it must still be an active, non-client member.
	var role, slug string
	err := sv.Sys.QueryRowContext(ctx, `SELECT m.role, w.slug FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
		WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'`, st.WS, st.User).Scan(&role, &slug)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !authz.Can(role, authz.KPIRead)) {
		return forbidden("you are no longer a member of this workspace")
	}
	if err != nil {
		return err
	}
	token, err := ghExchange(ctx, cfg, code)
	if err != nil {
		return err
	}
	var user struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
		Email string `json:"email"`
	}
	if err := ghGet(ctx, cfg, token, "/user", &user); err != nil {
		return err
	}
	if !ghLoginRe.MatchString(user.Login) {
		return &Error{http.StatusBadGateway, "GitHub returned no usable login"}
	}
	emails := []string{fmt.Sprintf("%d+%s@users.noreply.github.com", user.ID, strings.ToLower(user.Login))}
	var list []struct {
		Email    string `json:"email"`
		Verified bool   `json:"verified"`
	}
	// Needs the App's "Email addresses: read" account permission; without it, fall back to the
	// public profile address.
	if err := ghGet(ctx, cfg, token, "/user/emails", &list); err == nil {
		for _, e := range list {
			if e.Verified {
				emails = append(emails, e.Email)
			}
		}
	} else if user.Email != "" {
		emails = append(emails, user.Email)
	}
	sealed, _ := secretbox.Seal([]byte(token))
	s := &tenant.Scope{WorkspaceID: st.WS, WorkspaceSlug: slug, UserID: st.User, Role: role, Via: "session"}
	ctx = tenant.With(ctx, s)
	id := user.ID
	return sv.saveGitHubAccount(ctx, s, st.User, user.Login, &id, emails, "oauth", sealed)
}

func ghExchange(ctx context.Context, cfg *ghUserOAuth, code string) (string, error) {
	form := url.Values{"client_id": {cfg.ClientID}, "client_secret": {cfg.ClientSecret}, "code": {code}, "redirect_uri": {cfg.RedirectURL}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.WebURL+"/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var out struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error_description"`
	}
	if err := ghDo(req, &out); err != nil {
		return "", err
	}
	if out.AccessToken == "" {
		return "", &Error{http.StatusBadGateway, "GitHub refused the authorization code: " + out.Error}
	}
	return out.AccessToken, nil
}

func ghGet(ctx context.Context, cfg *ghUserOAuth, token, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.APIURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Authorization", "Bearer "+token)
	return ghDo(req, out)
}

func ghDo(req *http.Request, out any) error {
	req.Header.Set("User-Agent", "mahaam")
	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return &Error{http.StatusBadGateway, "GitHub is unreachable"}
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode/100 != 2 {
		return &Error{http.StatusBadGateway, "GitHub answered " + strconv.Itoa(res.StatusCode)}
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &Error{http.StatusBadGateway, "GitHub sent an unexpected response"}
	}
	return nil
}

// ---- storage ---------------------------------------------------------------------------------------

func cleanEmails(in []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, e := range in {
		e = strings.ToLower(strings.TrimSpace(e))
		if e == "" || seen[e] {
			continue
		}
		if len(e) > 254 || strings.ContainsAny(e, ", \t") || !strings.Contains(e, "@") {
			return nil, invalid("%q is not an e-mail address", e)
		}
		seen[e] = true
		out = append(out, e)
	}
	if len(out) > 20 {
		return nil, invalid("at most 20 e-mail addresses")
	}
	return out, nil
}

func (sv *Service) saveGitHubAccount(ctx context.Context, s *tenant.Scope, userID, login string, githubID *int64, emails []string, via, sealed string) error {
	login = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(login), "@"))
	if !ghLoginRe.MatchString(login) {
		return invalid("%q is not a GitHub username", login)
	}
	emails, err := cleanEmails(emails)
	if err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		var other string
		err := tx.QueryRowContext(ctx, `SELECT user_id FROM user_github_accounts WHERE workspace_id = $1 AND lower(login) = lower($2) AND user_id <> $3`,
			s.WorkspaceID, login, userID).Scan(&other)
		if err == nil {
			return conflict("GitHub account @" + login + " is already mapped to another member of this workspace")
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_github_accounts (workspace_id, user_id, login, github_id, emails, connected_via, token_sealed, connected_by)
			VALUES ($1, $2, $3, $4, string_to_array($5, ','), $6, NULLIF($7, ''), $8)
			ON CONFLICT (workspace_id, user_id) DO UPDATE SET login = EXCLUDED.login, github_id = EXCLUDED.github_id, emails = EXCLUDED.emails,
				connected_via = EXCLUDED.connected_via, token_sealed = EXCLUDED.token_sealed, connected_by = EXCLUDED.connected_by,
				connected_at = now(), updated_at = now()`,
			s.WorkspaceID, userID, login, githubID, strings.Join(emails, ","), via, sealed, s.UserID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "github_account.connected", SubjectType: "user", SubjectID: userID,
			Changes: map[string]any{"login": login, "via": via, "emails": len(emails)}})
	})
}

func (sv *Service) loadGitHubAccount(ctx context.Context, q querier, ws, userID string) (*GitHubAccount, error) {
	a := &GitHubAccount{}
	var emails string
	err := q.QueryRowContext(ctx, `SELECT user_id, login, github_id, array_to_string(emails, ','), connected_via, connected_at
		FROM user_github_accounts WHERE workspace_id = $1 AND user_id = $2`, ws, userID).
		Scan(&a.UserID, &a.Login, &a.GitHubID, &emails, &a.ConnectedVia, &a.ConnectedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.Emails = splitIDs(emails)
	return a, nil
}

// memberFor resolves whose KPI / account / reviews a call is about: "", "me", your id or your
// e-mail → you; anyone else needs kpi:all and must be an active, non-client member (404 otherwise,
// including a user of another workspace).
func (sv *Service) memberFor(ctx context.Context, s *tenant.Scope, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.EqualFold(ref, "me") || ref == s.UserID || (s.Email != "" && strings.EqualFold(ref, s.Email)) {
		return s.UserID, nil
	}
	if sv.Sys == nil {
		return "", notFound("member")
	}
	var id string
	err := sv.Sys.QueryRowContext(ctx, `SELECT m.user_id FROM workspace_members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.status = 'active' AND m.role <> 'client' AND (m.user_id = $2 OR lower(u.email) = lower($2))`,
		s.WorkspaceID, ref).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", notFound("member")
	}
	if err != nil {
		return "", err
	}
	if id == s.UserID {
		return id, nil
	}
	if err := require(s, authz.KPIAll); err != nil {
		return "", err
	}
	return id, nil
}

// GitHubAccountOf is a member's mapping (yours, or anyone's with kpi:all).
func (sv *Service) GitHubAccountOf(ctx context.Context, userRef string) (*GitHubStatus, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.KPIRead); err != nil {
		return nil, err
	}
	uid, err := sv.memberFor(ctx, s, userRef)
	if err != nil {
		return nil, err
	}
	acc, err := sv.loadGitHubAccount(ctx, sv.DB, s.WorkspaceID, uid)
	if err != nil {
		return nil, err
	}
	_, ok := ghUserConfig()
	return &GitHubStatus{Account: acc, OAuthAvailable: ok}, nil
}

// SetMemberGitHub maps a member to a GitHub login + e-mails by hand (kpi:all).
func (sv *Service) SetMemberGitHub(ctx context.Context, userRef string, in GitHubMapping) (*GitHubStatus, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.KPIAll); err != nil {
		return nil, err
	}
	uid, err := sv.memberFor(ctx, s, userRef)
	if err != nil {
		return nil, err
	}
	if err := sv.saveGitHubAccount(ctx, s, uid, in.Login, nil, in.Emails, "manual", ""); err != nil {
		return nil, err
	}
	return sv.GitHubAccountOf(ctx, uid)
}

// DisconnectGitHub removes a mapping (your own, or anyone's with kpi:all).
func (sv *Service) DisconnectGitHub(ctx context.Context, userRef string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.KPIRead); err != nil {
		return err
	}
	uid, err := sv.memberFor(ctx, s, userRef)
	if err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM user_github_accounts WHERE workspace_id = $1 AND user_id = $2`, s.WorkspaceID, uid)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return notFound("GitHub account")
		}
		return record(ctx, tx, s, entry{Action: "github_account.disconnected", SubjectType: "user", SubjectID: uid})
	})
}
