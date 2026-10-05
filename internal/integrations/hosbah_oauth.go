package integrations

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/circlexo/circlexo-go/service"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/circlexo"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/secretbox"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
Connecting Hosbah is OAuth; nobody pastes a token. Two ways, both authorization code + PKCE:

  - via=circlexo (preferred; needs CircleXO on, HOSBAH_CIRCLEXO_APP_ID, and the manager's Mahaam
    account linked to the hub). Mahaam sends the manager to the hub, trades the code for their hub
    access token (audience Mahaam), checks the hub subject is the same person, then exchanges it
    (RFC 8693) for a token whose audience is Hosbah, with Mahaam as the actor. That token lists the
    manager's Hosbah apps; they pick one in Mahaam and Hosbah mints the app token. Between the
    callback and the pick the exchanged token travels sealed (secretbox, bound to workspace,
    project and user, 10 minutes) in the settings URL's fragment, never in a query string.
  - via=hosbah (HOSBAH_CLIENT_ID / HOSBAH_CLIENT_SECRET): Hosbah's own authorization server. The
    app is picked on Hosbah's consent screen and /oauth/token answers with the app token itself.

POST …/integrations/hosbah/authorize (manager+) returns the authorization URL and sets an HttpOnly
nonce cookie scoped to the callback, so a flow started in one browser cannot finish in another.
The state is signed (MAHAAM_SECRET_KEY) and the PKCE verifier is derived from the nonce with the
same key, so it never leaves the server. The callback, GET /integrations/hosbah/callback, is outside
/api (public, like /auth/circlexo/*; the web app proxies it); it trusts only the signed state, the
cookie and the provider, and re-checks that the person still manages the workspace's integrations.
*/

// HosbahCallbackPath is the OAuth redirect for both ways (registered at the hub and at Hosbah).
const HosbahCallbackPath = "/integrations/hosbah/callback"

const hosbahStateCookie = "managy_hosbah_connect"

// HosbahMethods says which ways to connect are available to the caller.
type HosbahMethods struct {
	CircleXO bool `json:"circlexo" doc:"Connect through the CircleXO account (the caller's Mahaam account is linked to the hub)"`
	Hosbah   bool `json:"hosbah" doc:"Connect through Hosbah's own OAuth"`
}

// HosbahStart is the authorization URL plus the nonce cookie to set.
type HosbahStart struct {
	URL    string
	Cookie *http.Cookie
}

type hosbahState struct {
	W     string `json:"w"` // workspace
	P     string `json:"p"` // project
	U     string `json:"u"` // user who started
	Slug  string `json:"s"`
	L     string `json:"l"` // UI locale for the way back
	Via   string `json:"v"` // circlexo | hosbah
	Nonce string `json:"n"`
	Exp   int64  `json:"e"`
}

// hosbahPending is the exchanged hub token between the callback and the app pick.
type hosbahPending struct {
	W     string `json:"w"`
	P     string `json:"p"`
	U     string `json:"u"`
	Token string `json:"t"`
	Exp   int64  `json:"e"`
}

func hosbahURL() string { return strings.TrimRight(strings.TrimSpace(os.Getenv("HOSBAH_URL")), "/") }

func hosbahHubAudience() string { return strings.TrimSpace(os.Getenv("HOSBAH_CIRCLEXO_APP_ID")) }

func hosbahClientCreds() (id, secret string, ok bool) {
	id, secret = strings.TrimSpace(os.Getenv("HOSBAH_CLIENT_ID")), strings.TrimSpace(os.Getenv("HOSBAH_CLIENT_SECRET"))
	return id, secret, id != "" && secret != ""
}

func webOrigin() string {
	base := strings.TrimRight(os.Getenv("WEB_URL"), "/")
	if u, err := url.Parse(base); base == "" || err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return base
}

func hosbahRedirectURL() string { return webOrigin() + HosbahCallbackPath }

func signHosbahState(st hosbahState) string {
	b, _ := json.Marshal(st)
	enc := base64.RawURLEncoding.EncodeToString(b)
	return enc + "." + secretbox.Sign([]byte("hosbah-connect:"+enc))
}

func verifyHosbahState(raw string, now time.Time) (*hosbahState, error) {
	bad := invalid("the Hosbah sign-in is invalid — start again from the project settings")
	enc, sig, ok := strings.Cut(raw, ".")
	if !ok || !secretbox.Verify([]byte("hosbah-connect:"+enc), sig) {
		return nil, bad
	}
	b, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return nil, bad
	}
	var st hosbahState
	if json.Unmarshal(b, &st) != nil || st.W == "" || st.P == "" || st.U == "" || st.Nonce == "" {
		return nil, bad
	}
	if now.Unix() > st.Exp {
		return nil, invalid("the Hosbah sign-in took too long — start again from the project settings")
	}
	return &st, nil
}

// hosbahPKCE derives the verifier from the nonce under MAHAAM_SECRET_KEY (43 base64url chars).
func hosbahPKCE(nonce string) (verifier, challenge string) {
	verifier = secretbox.Sign([]byte("hosbah-pkce:" + nonce))
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

func randomToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func sealPending(pd hosbahPending) (string, error) {
	b, _ := json.Marshal(pd)
	return secretbox.Seal(b)
}

// openPending opens a pending token for s and project, or says to start again.
func openPending(raw string, s *tenant.Scope, projectID string, now time.Time) (*hosbahPending, error) {
	again := invalid("the CircleXO sign-in for Hosbah has expired — connect again")
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, invalid("pending is required — connect with CircleXO first")
	}
	b, err := secretbox.Open(raw)
	if err != nil {
		return nil, again
	}
	var pd hosbahPending
	if json.Unmarshal(b, &pd) != nil || pd.Token == "" {
		return nil, again
	}
	if pd.W != s.WorkspaceID || pd.P != projectID || pd.U != s.UserID {
		return nil, forbidden("this CircleXO sign-in belongs to another person or project — connect again")
	}
	if now.Unix() > pd.Exp {
		return nil, again
	}
	return &pd, nil
}

// hubReady is the CircleXO service when connecting through it is configured at all.
func hubReady() *circlexo.Service {
	cs := circlexo.Current()
	if cs == nil || cs.RP == nil || hosbahHubAudience() == "" || hosbahURL() == "" || webOrigin() == "" {
		return nil
	}
	return cs
}

func (sv *Service) hubLinked(ctx context.Context, userID string) bool {
	var one int
	return sv.Sys != nil && sv.Sys.QueryRowContext(ctx, `SELECT 1 FROM circlexo_user_links WHERE user_id = $1`, userID).Scan(&one) == nil
}

func (sv *Service) hosbahMethods(ctx context.Context, userID string) HosbahMethods {
	_, _, creds := hosbahClientCreds()
	return HosbahMethods{
		CircleXO: hubReady() != nil && sv.hubLinked(ctx, userID),
		Hosbah:   creds && hosbahURL() != "" && webOrigin() != "",
	}
}

// HosbahConnectMethods lists the ways the caller can connect Hosbah (manager+).
func (sv *Service) HosbahConnectMethods(ctx context.Context, projectRef string) (*HosbahMethods, error) {
	s, _, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	m := sv.hosbahMethods(ctx, s.UserID)
	return &m, nil
}

// StartHosbahConnect builds the authorization URL for via (manager+).
func (sv *Service) StartHosbahConnect(ctx context.Context, projectRef, via, locale string) (*HosbahStart, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	if err := limits.Integration(ctx, s.WorkspaceID, "hosbah"); err != nil {
		return nil, err
	}
	if locale != "ar" {
		locale = "en"
	}
	m := sv.hosbahMethods(ctx, s.UserID)
	nonce := randomToken()
	st := hosbahState{W: s.WorkspaceID, P: p.ID, U: s.UserID, Slug: s.WorkspaceSlug, L: locale, Via: via, Nonce: nonce,
		Exp: time.Now().Add(15 * time.Minute).Unix()}
	verifier, challenge := hosbahPKCE(nonce)
	var to string
	switch via {
	case "circlexo":
		if !m.CircleXO {
			return nil, conflict("connecting through CircleXO needs CircleXO on this server (HOSBAH_CIRCLEXO_APP_ID) and your account signed in with CircleXO once")
		}
		rp := *hubReady().RP // same client, this callback
		rp.RedirectURL = hosbahRedirectURL()
		to, err = rp.AuthURL(ctx, signHosbahState(st), nonce, verifier, "", "")
		if err != nil {
			return nil, upstream(&UpstreamError{Status: http.StatusBadGateway, Msg: "CircleXO is unreachable"})
		}
	case "hosbah":
		if !m.Hosbah {
			return nil, conflict("Hosbah OAuth is not configured on this server (HOSBAH_URL, HOSBAH_CLIENT_ID, HOSBAH_CLIENT_SECRET)")
		}
		id, _, _ := hosbahClientCreds()
		q := url.Values{
			"response_type": {"code"}, "client_id": {id}, "redirect_uri": {hosbahRedirectURL()}, "scope": {"app"},
			"state": {signHosbahState(st)}, "code_challenge": {challenge}, "code_challenge_method": {"S256"},
			"ui_locales": {locale},
		}
		to = hosbahURL() + "/oauth/authorize?" + q.Encode()
	default:
		return nil, invalid("via must be circlexo or hosbah")
	}
	return &HosbahStart{URL: to, Cookie: &http.Cookie{Name: hosbahStateCookie, Value: nonce, Path: HosbahCallbackPath, MaxAge: 900,
		HttpOnly: true, Secure: strings.HasPrefix(hosbahRedirectURL(), "https://"), SameSite: http.SameSiteLaxMode}}, nil
}

// HosbahCallback serves GET /integrations/hosbah/callback (public; outside /api). It trusts only
// the signed state, the nonce cookie and the provider's answer.
func (sv *Service) HosbahCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		st, err := verifyHosbahState(q.Get("state"), time.Now())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		c, cerr := r.Cookie(hosbahStateCookie)
		if cerr != nil || c.Value == "" || c.Value != st.Nonce {
			http.Error(w, "This Hosbah sign-in was started in another browser — start again from the project settings.", http.StatusBadRequest)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: hosbahStateCookie, Value: "", Path: HosbahCallbackPath, MaxAge: -1, HttpOnly: true})
		back := webOrigin() + "/" + st.L + "/w/" + url.PathEscape(st.Slug) + "/projects/" + url.PathEscape(st.P) + "/settings?s=integrations"
		fail := func(msg string) { http.Redirect(w, r, back+"&hosbah_error="+url.QueryEscape(msg), http.StatusFound) }
		if e := q.Get("error"); e != "" {
			if d := q.Get("error_description"); d != "" {
				e = d
			}
			fail(e)
			return
		}
		frag, err := sv.finishHosbah(r.Context(), st, q.Get("code"))
		if err != nil {
			msg := "Hosbah could not be connected"
			if e, ok := asMsg(err); ok {
				msg = e
			} else if sv.Log != nil {
				sv.Log.Error("hosbah connect", "err", err)
			}
			fail(msg)
			return
		}
		http.Redirect(w, r, back+frag, http.StatusFound)
	}
}

// finishHosbah completes the flow and returns what to append to the settings URL.
func (sv *Service) finishHosbah(ctx context.Context, st *hosbahState, code string) (string, error) {
	if code == "" {
		return "", invalid("the provider sent no authorization code")
	}
	// The person who started must still manage the workspace's integrations.
	var role string
	err := sv.Sys.QueryRowContext(ctx, `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, st.W, st.U).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !authz.Can(role, authz.IntegrationsManage)) {
		return "", forbidden("you can no longer manage this project's integrations")
	}
	if err != nil {
		return "", err
	}
	s := &tenant.Scope{WorkspaceID: st.W, WorkspaceSlug: st.Slug, UserID: st.U, Role: role, Via: "session"}
	ctx = tenant.With(ctx, s)
	p, err := sv.Work.FindProject(ctx, st.P)
	if err != nil {
		return "", err
	}
	verifier, _ := hosbahPKCE(st.Nonce)

	switch st.Via {
	case "circlexo":
		cs := hubReady()
		if cs == nil {
			return "", conflict("CircleXO is not configured on this server")
		}
		hub, err := service.New(cs.Cfg)
		if err != nil {
			return "", err
		}
		tok, err := hub.Post(ctx, url.Values{"grant_type": {"authorization_code"}, "code": {code},
			"redirect_uri": {hosbahRedirectURL()}, "code_verifier": {verifier}})
		if err != nil {
			return "", upstream(&UpstreamError{Status: http.StatusBadGateway, Msg: "CircleXO refused the sign-in"})
		}
		claims, err := cs.RP.Verifier.VerifyAccessToken(ctx, tok.AccessToken)
		if err != nil {
			return "", forbidden("CircleXO sent a token Mahaam cannot verify")
		}
		var userID string
		if err := sv.Sys.QueryRowContext(ctx, `SELECT user_id FROM circlexo_user_links WHERE subject = $1`, claims.Subject).Scan(&userID); err != nil || userID != st.U {
			return "", forbidden("that CircleXO account is not the one linked to your Mahaam account")
		}
		ex, err := hub.Exchange(ctx, tok.AccessToken, service.AccessTokenType, hosbahHubAudience())
		if err != nil {
			return "", upstream(&UpstreamError{Status: http.StatusBadGateway, Msg: "CircleXO would not issue a Hosbah token (is Mahaam allowed to act for Hosbah at the hub?)"})
		}
		exp := time.Now().Add(10 * time.Minute)
		if !ex.Expiry.IsZero() && ex.Expiry.Before(exp) {
			exp = ex.Expiry
		}
		sealed, err := sealPending(hosbahPending{W: st.W, P: p.ID, U: st.U, Token: ex.AccessToken, Exp: exp.Unix()})
		if err != nil {
			return "", err
		}
		return "#hosbah=" + url.QueryEscape(sealed), nil
	case "hosbah":
		appTok, app, err := sv.hosbahCodeToken(ctx, code, verifier)
		if err != nil {
			return "", err
		}
		if _, err := sv.linkHosbah(ctx, s, p.ID, hosbahURL(), appTok, app); err != nil {
			return "", err
		}
		return "&integration=hosbah", nil
	}
	return "", invalid("the Hosbah sign-in is invalid — start again from the project settings")
}

// hosbahCodeToken trades a Hosbah authorization code for the app token and its app.
func (sv *Service) hosbahCodeToken(ctx context.Context, code, verifier string) (string, *HosbahApp, error) {
	id, secret, ok := hosbahClientCreds()
	base := hosbahURL()
	if !ok || base == "" {
		return "", nil, conflict("Hosbah OAuth is not configured on this server")
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {hosbahRedirectURL()},
		"code_verifier": {verifier}, "client_id": {id}, "client_secret": {secret}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := sv.HTTP.Do(req)
	if err != nil {
		return "", nil, upstream(&UpstreamError{Status: http.StatusBadGateway, Msg: "Hosbah is unreachable"})
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var out struct {
		AccessToken string     `json:"access_token"`
		App         *HosbahApp `json:"app"`
		Error       string     `json:"error"`
		Description string     `json:"error_description"`
	}
	_ = json.Unmarshal(raw, &out)
	if res.StatusCode >= 300 || out.AccessToken == "" {
		msg := out.Description
		if msg == "" {
			msg = out.Error
		}
		if msg == "" {
			msg = "no app token returned"
		}
		return "", nil, upstream(&UpstreamError{Status: http.StatusBadGateway, Msg: "Hosbah: " + msg})
	}
	if out.App == nil || out.App.ID == "" {
		h, err := sv.hosbah(base, out.AccessToken).app(ctx)
		if err != nil {
			return "", nil, upstream(err)
		}
		out.App = &h.App
	}
	a := normApps([]HosbahApp{*out.App})[0]
	return out.AccessToken, &a, nil
}

// asMsg is the user-facing message of a domain error.
func asMsg(err error) (string, bool) {
	var ue *UpstreamError
	if errors.As(err, &ue) {
		return ue.Msg, true
	}
	if e, ok := work.AsError(err); ok {
		return e.Msg, true
	}
	return "", false
}
