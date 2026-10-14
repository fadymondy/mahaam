package account

/*
Sign in with Apple, Google and GitHub in a browser (the web, and the apps through the system
browser and the /app-signin handoff, appsignin.go). Our own flow, not the auth-oauth plugin's:
the plugin matches people by email only and keeps no link, so a changed address made a second
account, and it has no Apple. server/oauth_return.go serves the routes:

	GET  /api/auth/oauth/{provider}?next=/path      → 302 to the provider
	GET  /api/auth/oauth/{google|github}/callback   ← the provider (code, state)
	POST /api/auth/oauth/apple/callback             ← Apple, response_mode=form_post (code, id_token, state, user)

The state. Apple answers with a cross-site POST, which carries no SameSite=Lax cookie, so the state
can't live in one. It is a signed value instead (secretbox.Sign): provider, the `next` to return to,
the Apple nonce, an expiry, and the SHA-256 of a random "binding" kept in a cookie that IS sent
cross-site (SameSite=None; Secure — Lax on plain-http development). The callback checks the
signature, the expiry and the binding (so a callback URL can't be fed to someone else's browser
to sign them in as the attacker), and spends the state once (signin_nonces).

The identity. Google: the OpenID userinfo (sub, email, email_verified). GitHub: the user id, and
the primary verified address from /user/emails. Apple: the id_token posted back, verified like the
native one (apple_verify.go) with the Services ID as its audience and our nonce. Then
SocialAccount (identities.go) finds, links or makes the account.

Configuration: Google OAUTH_GOOGLE_CLIENT_ID/_SECRET, GitHub OAUTH_GITHUB_CLIENT_ID/_SECRET, Apple
APPLE_SERVICES_ID (and the APPLE_* key from apple_client.go to keep a refresh token for revocation).
Every provider's redirect URI is APP_URL + /api/auth/oauth/{provider}/callback.
*/

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/secretbox"
)

const socialStateTTL = 10 * time.Minute

// SocialError is a refused or failed provider sign-in. Code goes to the web as /login?error=<code>.
type SocialError struct {
	Code string
	Err  error
}

func (e *SocialError) Error() string { return e.Code + ": " + e.Err.Error() }
func (e *SocialError) Unwrap() error { return e.Err }

func socialFail(code string, err error) *SocialError { return &SocialError{Code: code, Err: err} }

// SocialResult is a provider sign-in that found its account.
type SocialResult struct {
	UserID  string
	Next    string
	Created bool
}

type oauthApp struct {
	authURL, tokenURL, scope string
}

var oauthApps = map[string]oauthApp{
	"google": {authURL: "https://accounts.google.com/o/oauth2/v2/auth", tokenURL: "https://oauth2.googleapis.com/token", scope: "openid email profile"},
	"github": {authURL: "https://github.com/login/oauth/authorize", tokenURL: "https://github.com/login/oauth/access_token", scope: "read:user user:email"},
}

func oauthCreds(provider string) (id, secret string) {
	p := "OAUTH_" + strings.ToUpper(provider)
	return strings.TrimSpace(os.Getenv(p + "_CLIENT_ID")), strings.TrimSpace(os.Getenv(p + "_CLIENT_SECRET"))
}

func appleServicesID() string { return strings.TrimSpace(os.Getenv("APPLE_SERVICES_ID")) }

// SocialWebProviders lists the providers the browser flow has configured, in display order.
func SocialWebProviders() []string {
	out := []string{}
	if appleServicesID() != "" {
		out = append(out, "apple")
	}
	for _, p := range []string{"google", "github"} {
		if id, secret := oauthCreds(p); id != "" && secret != "" {
			out = append(out, p)
		}
	}
	return out
}

// SocialWebConfigured reports whether provider can sign in through the browser.
func SocialWebConfigured(provider string) bool {
	for _, p := range SocialWebProviders() {
		if p == provider {
			return true
		}
	}
	return false
}

// SocialRedirectURI is the callback registered with each provider.
func SocialRedirectURI(provider string) string {
	return strings.TrimRight(os.Getenv("APP_URL"), "/") + "/api/auth/oauth/" + provider + "/callback"
}

type socialState struct {
	Provider string `json:"p"`
	Next     string `json:"n,omitempty"`
	Bind     string `json:"b"`
	Nonce    string `json:"o,omitempty"`
	Expires  int64  `json:"x"`
	ID       string `json:"r"`
}

const statePurpose = "mahaam-oauth-state:"

func sealState(st socialState) string {
	b, _ := json.Marshal(st)
	payload := base64.RawURLEncoding.EncodeToString(b)
	return payload + "." + secretbox.Sign([]byte(statePurpose+payload))
}

func openState(raw string) (*socialState, error) {
	payload, sig, ok := strings.Cut(raw, ".")
	if !ok || payload == "" || sig == "" || !secretbox.Verify([]byte(statePurpose+payload), sig) {
		return nil, errors.New("bad state signature")
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, err
	}
	var st socialState
	if err := json.Unmarshal(b, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

// SocialStart returns the provider's authorization URL. next is an already-checked local path (or
// ""); bind is the random value the caller put in the binding cookie.
func (s *Service) SocialStart(provider, next, bind string) (string, error) {
	if !SocialWebConfigured(provider) {
		return "", fmt.Errorf("%s is not configured", provider)
	}
	st := socialState{Provider: provider, Next: next, Bind: sha256Hex(bind), Expires: time.Now().Add(socialStateTTL).Unix(), ID: randHex(16)}
	q := url.Values{"redirect_uri": {SocialRedirectURI(provider)}, "response_type": {"code"}}
	authURL := ""
	if provider == "apple" {
		st.Nonce = randHex(32)
		authURL = appleBase + "/auth/authorize"
		q.Set("client_id", appleServicesID())
		// code id_token + form_post: Apple posts the signed id_token back (with our nonce in it),
		// and the name the first time; asking for name/email requires form_post.
		q.Set("response_type", "code id_token")
		q.Set("response_mode", "form_post")
		q.Set("scope", "name email")
		q.Set("nonce", sha256Hex(st.Nonce))
	} else {
		app := oauthApps[provider]
		id, _ := oauthCreds(provider)
		authURL = app.authURL
		q.Set("client_id", id)
		q.Set("scope", app.scope)
	}
	q.Set("state", sealState(st))
	return authURL + "?" + q.Encode(), nil
}

// SocialFinish completes a provider callback: q is the query (Google/GitHub) or the posted form
// (Apple); bind is the binding cookie's value.
func (s *Service) SocialFinish(ctx context.Context, provider string, q url.Values, bind string) (*SocialResult, error) {
	st, err := openState(q.Get("state"))
	if err != nil {
		return nil, socialFail("oauth_failed", err)
	}
	res := &SocialResult{Next: st.Next}
	if st.Provider != provider {
		return res, socialFail("oauth_failed", errors.New("state is for another provider"))
	}
	if time.Now().Unix() > st.Expires {
		return res, socialFail("oauth_failed", errors.New("state expired"))
	}
	if bind == "" || subtle.ConstantTimeCompare([]byte(sha256Hex(bind)), []byte(st.Bind)) != 1 {
		return res, socialFail("oauth_failed", errors.New("state is not bound to this browser"))
	}
	if e := q.Get("error"); e != "" {
		// The person said no at the provider (access_denied, user_cancelled_authorize…).
		return res, socialFail("oauth_cancelled", errors.New(e))
	}
	if ok, err := s.spendNonce(ctx, sha256Hex("state:"+st.ID), time.Unix(st.Expires, 0)); err != nil {
		return res, socialFail("oauth_failed", err)
	} else if !ok {
		return res, socialFail("oauth_failed", errors.New("state already used"))
	}

	var id *SocialIdentity
	var apple *AppleTokens
	switch provider {
	case "google":
		id, err = s.googleIdentity(ctx, q.Get("code"))
	case "github":
		id, err = s.githubIdentity(ctx, q.Get("code"))
	case "apple":
		id, apple, err = s.appleWebIdentity(ctx, q, st.Nonce)
	default:
		err = errors.New("unknown provider")
	}
	if err != nil {
		return res, socialFail("oauth_failed", err)
	}
	locale := ""
	if strings.HasPrefix(st.Next, "/ar/") || st.Next == "/ar" {
		locale = "ar"
	} else if strings.HasPrefix(st.Next, "/en/") || st.Next == "/en" {
		locale = "en"
	}
	userID, created, err := s.SocialAccount(ctx, *id, locale)
	switch {
	case errors.Is(err, ErrSocialNoEmail):
		return res, socialFail("email_required", err)
	case errors.Is(err, ErrSocialEmailTaken):
		return res, socialFail("account_exists", err)
	case err != nil:
		return res, socialFail("oauth_failed", err)
	}
	if provider == "apple" && apple != nil {
		s.storeAppleToken(ctx, id.Subject, appleServicesID(), apple)
	}
	res.UserID, res.Created = userID, created
	return res, nil
}

func socialHTTP() *http.Client { return &http.Client{Timeout: 15 * time.Second} }

// codeExchange trades an OAuth code for an access token at a Google/GitHub token endpoint.
func codeExchange(ctx context.Context, provider, code string) (string, error) {
	if code == "" {
		return "", errors.New("no code")
	}
	id, secret := oauthCreds(provider)
	form := url.Values{"client_id": {id}, "client_secret": {secret}, "code": {code},
		"redirect_uri": {SocialRedirectURI(provider)}, "grant_type": {"authorization_code"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, oauthApps[provider].tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := doJSON(req, &out); err != nil {
		return "", fmt.Errorf("%s token: %w", provider, err)
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("%s token: no access_token", provider)
	}
	return out.AccessToken, nil
}

func getJSON(ctx context.Context, rawURL, token string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	return doJSON(req, out)
}

func doJSON(req *http.Request, out any) error {
	res, err := socialHTTP().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", res.StatusCode)
	}
	return json.Unmarshal(body, out)
}

func (s *Service) googleIdentity(ctx context.Context, code string) (*SocialIdentity, error) {
	token, err := codeExchange(ctx, "google", code)
	if err != nil {
		return nil, err
	}
	var u struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified any    `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := getJSON(ctx, "https://openidconnect.googleapis.com/v1/userinfo", token, &u); err != nil {
		return nil, fmt.Errorf("google userinfo: %w", err)
	}
	if u.Sub == "" {
		return nil, errors.New("google userinfo: no sub")
	}
	return &SocialIdentity{Provider: "google", Subject: u.Sub, Email: strings.TrimSpace(u.Email), EmailVerified: truthy(u.EmailVerified), Name: u.Name}, nil
}

func (s *Service) githubIdentity(ctx context.Context, code string) (*SocialIdentity, error) {
	token, err := codeExchange(ctx, "github", code)
	if err != nil {
		return nil, err
	}
	var u struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
		Name  string `json:"name"`
	}
	if err := getJSON(ctx, "https://api.github.com/user", token, &u); err != nil {
		return nil, fmt.Errorf("github user: %w", err)
	}
	if u.ID == 0 {
		return nil, errors.New("github user: no id")
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := getJSON(ctx, "https://api.github.com/user/emails", token, &emails); err != nil {
		return nil, fmt.Errorf("github emails: %w", err)
	}
	id := &SocialIdentity{Provider: "github", Subject: strconv.FormatInt(u.ID, 10), Name: u.Name}
	if id.Name == "" {
		id.Name = u.Login
	}
	// The primary address if GitHub verified it, else any verified one; an unverified address is
	// kept only as a last resort, and then it can't link to an existing account.
	for _, pass := range []func(p, v bool) bool{
		func(p, v bool) bool { return p && v },
		func(_, v bool) bool { return v },
		func(p, _ bool) bool { return p },
	} {
		for _, e := range emails {
			if id.Email == "" && e.Email != "" && pass(e.Primary, e.Verified) {
				id.Email, id.EmailVerified = strings.TrimSpace(e.Email), e.Verified
			}
		}
	}
	return id, nil
}

// appleWebIdentity verifies the id_token Apple posted back, and, when the Apple key is configured,
// exchanges the code for the refresh token kept for revocation.
func (s *Service) appleWebIdentity(ctx context.Context, form url.Values, nonce string) (*SocialIdentity, *AppleTokens, error) {
	if s.Apple == nil {
		s.Apple = NewAppleVerifier()
	}
	services := appleServicesID()
	c, err := s.Apple.VerifyFor(ctx, form.Get("id_token"), nonce, services)
	if err != nil {
		return nil, nil, err
	}
	id := &SocialIdentity{Provider: "apple", Subject: c.Subject, Email: c.Email, EmailVerified: c.EmailVerified}
	// `user` comes on the first authorization only: {"name":{"firstName","lastName"},"email"}.
	var u struct {
		Name struct {
			First string `json:"firstName"`
			Last  string `json:"lastName"`
		} `json:"name"`
	}
	if raw := form.Get("user"); raw != "" && json.Unmarshal([]byte(raw), &u) == nil {
		id.Name = strings.TrimSpace(u.Name.First + " " + u.Name.Last)
	}
	var toks *AppleTokens
	if client := s.appleClient(); client != nil && form.Get("code") != "" {
		if t, err := client.Exchange(ctx, services, form.Get("code"), SocialRedirectURI("apple")); err != nil {
			s.log().Warn("apple web code exchange", "err", err)
		} else {
			toks = t
		}
	}
	return id, toks, nil
}
