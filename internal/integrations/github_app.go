package integrations

import (
	"bytes"
	"context"
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
The GitHub App: Mahaam acts on a repository as an installed App, never as a person.

  - App JWT (RS256, stdlib only): iss = GITHUB_APP_ID, iat = now-60s, exp = now+9m.
  - Installation access token: POST /app/installations/{id}/access_tokens with the JWT, cached
    per installation until two minutes before it expires (tokens live an hour).
  - Webhooks: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(GITHUB_WEBHOOK_SECRET, body)).

Configuration (env, never hard-coded): GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY
(the PEM itself — literal "\n" escapes allowed — or a path to the .pem file),
GITHUB_WEBHOOK_SECRET, and GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET (the App's OAuth
credentials, used to prove the installing user can see the installation — required in
production). GITHUB_API_URL / GITHUB_WEB_URL override https://api.github.com / https://github.com
(GitHub Enterprise, tests).
*/

// GitHubApp is a configured GitHub App.
type GitHubApp struct {
	AppID         string
	Slug          string
	Key           *rsa.PrivateKey
	WebhookSecret string
	ClientID      string
	ClientSecret  string
	APIURL        string
	WebURL        string
	HTTP          *http.Client

	mu     sync.Mutex
	tokens map[string]cachedToken
}

type cachedToken struct {
	token string
	exp   time.Time
}

// ErrGitHubNotConfigured is returned when the App's env is missing.
var ErrGitHubNotConfigured = errors.New("the GitHub App is not configured on this server (GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY)")

var (
	ghOnce sync.Once
	ghApp  *GitHubApp
	ghErr  error
)

// GitHub returns the process-wide App (token cache shared by every request), or
// ErrGitHubNotConfigured.
func GitHub() (*GitHubApp, error) {
	ghOnce.Do(func() { ghApp, ghErr = GitHubFromEnv(os.Getenv) })
	return ghApp, ghErr
}

// WebhookSecret returns GITHUB_WEBHOOK_SECRET (the webhook works even if the App's key is
// missing — it only needs the secret to verify, and the key to call back).
func WebhookSecret() string { return strings.TrimSpace(os.Getenv("GITHUB_WEBHOOK_SECRET")) }

// GitHubFromEnv builds the App from the environment.
func GitHubFromEnv(getenv func(string) string) (*GitHubApp, error) {
	id, slug, rawKey := strings.TrimSpace(getenv("GITHUB_APP_ID")), strings.TrimSpace(getenv("GITHUB_APP_SLUG")), strings.TrimSpace(getenv("GITHUB_APP_PRIVATE_KEY"))
	if id == "" || slug == "" || rawKey == "" {
		return nil, ErrGitHubNotConfigured
	}
	pemBytes := []byte(strings.ReplaceAll(rawKey, `\n`, "\n"))
	if !strings.Contains(rawKey, "-----BEGIN") {
		b, err := os.ReadFile(rawKey)
		if err != nil {
			return nil, fmt.Errorf("GITHUB_APP_PRIVATE_KEY: not a PEM and not a readable file: %w", err)
		}
		pemBytes = b
	}
	key, err := ParseRSAKey(pemBytes)
	if err != nil {
		return nil, fmt.Errorf("GITHUB_APP_PRIVATE_KEY: %w", err)
	}
	g := &GitHubApp{
		AppID: id, Slug: slug, Key: key,
		WebhookSecret: strings.TrimSpace(getenv("GITHUB_WEBHOOK_SECRET")),
		ClientID:      strings.TrimSpace(getenv("GITHUB_APP_CLIENT_ID")),
		ClientSecret:  strings.TrimSpace(getenv("GITHUB_APP_CLIENT_SECRET")),
		APIURL:        strings.TrimRight(firstNonEmpty(getenv("GITHUB_API_URL"), "https://api.github.com"), "/"),
		WebURL:        strings.TrimRight(firstNonEmpty(getenv("GITHUB_WEB_URL"), "https://github.com"), "/"),
		HTTP:          &http.Client{Timeout: 30 * time.Second},
	}
	return g, nil
}

// ParseRSAKey reads a PKCS#1 ("RSA PRIVATE KEY", what GitHub hands out) or PKCS#8 PEM.
func ParseRSAKey(pemBytes []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("no PEM block found")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("not an RSA private key (PKCS#1 or PKCS#8)")
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("the key is not RSA")
	}
	return rk, nil
}

// SignAppJWT returns the App's RS256 JWT, valid for nine minutes from now (backdated 60s for
// clock drift, as GitHub recommends).
func SignAppJWT(key *rsa.PrivateKey, appID string, now time.Time) (string, error) {
	enc := base64.RawURLEncoding
	header := enc.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]any{
		"iat": now.Add(-60 * time.Second).Unix(),
		"exp": now.Add(9 * time.Minute).Unix(),
		"iss": appID,
	})
	signing := header + "." + enc.EncodeToString(claims)
	sum := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		return "", err
	}
	return signing + "." + enc.EncodeToString(sig), nil
}

// VerifyWebhookSignature checks X-Hub-Signature-256 against the raw body in constant time.
func VerifyWebhookSignature(secret string, body []byte, header string) bool {
	if secret == "" || !strings.HasPrefix(header, "sha256=") {
		return false
	}
	got, err := hex.DecodeString(strings.TrimPrefix(header, "sha256="))
	if err != nil {
		return false
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return hmac.Equal(m.Sum(nil), got)
}

// installationToken returns a cached or fresh installation access token.
func (g *GitHubApp) installationToken(ctx context.Context, installationID string) (string, error) {
	if _, err := strconv.ParseInt(installationID, 10, 64); err != nil {
		return "", errors.New("the integration has no valid GitHub installation — install the App again")
	}
	g.mu.Lock()
	if g.tokens == nil {
		g.tokens = map[string]cachedToken{}
	}
	if c, ok := g.tokens[installationID]; ok && time.Until(c.exp) > 2*time.Minute {
		g.mu.Unlock()
		return c.token, nil
	}
	g.mu.Unlock()

	jwt, err := SignAppJWT(g.Key, g.AppID, time.Now())
	if err != nil {
		return "", err
	}
	var out struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if _, err := g.request(ctx, "Bearer "+jwt, http.MethodPost, "/app/installations/"+installationID+"/access_tokens", nil, &out); err != nil {
		return "", err
	}
	if out.Token == "" {
		return "", errors.New("GitHub returned no installation token")
	}
	g.mu.Lock()
	g.tokens[installationID] = cachedToken{out.Token, out.ExpiresAt}
	g.mu.Unlock()
	return out.Token, nil
}

// api calls the REST API as an installation. path may carry a query string.
func (g *GitHubApp) api(ctx context.Context, installationID, method, path string, body, out any) (http.Header, error) {
	tok, err := g.installationToken(ctx, installationID)
	if err != nil {
		return nil, err
	}
	return g.request(ctx, "token "+tok, method, path, body, out)
}

// UpstreamError is a non-2xx answer from a provider API.
type UpstreamError struct {
	Status int
	Msg    string
}

func (e *UpstreamError) Error() string { return e.Msg }

func (g *GitHubApp) request(ctx context.Context, auth, method, path string, body, out any) (http.Header, error) {
	url := path
	if !strings.HasPrefix(path, "http") {
		url = g.APIURL + path
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "mahaam")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := g.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GitHub unreachable: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 16<<20))
	if res.StatusCode/100 != 2 {
		var e struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &e)
		if e.Message == "" {
			e.Message = res.Status
		}
		return res.Header, &UpstreamError{Status: res.StatusCode, Msg: "GitHub: " + e.Message}
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return res.Header, fmt.Errorf("GitHub: unexpected response: %w", err)
		}
	}
	return res.Header, nil
}

// userInstallations lists the installation ids the OAuth user can access (GET /user/installations).
func (g *GitHubApp) userInstallations(ctx context.Context, userToken string) (map[string]bool, error) {
	out := map[string]bool{}
	for page := 1; page <= 10; page++ {
		var res struct {
			Installations []struct {
				ID int64 `json:"id"`
			} `json:"installations"`
		}
		if _, err := g.request(ctx, "token "+userToken, http.MethodGet, fmt.Sprintf("/user/installations?per_page=100&page=%d", page), nil, &res); err != nil {
			return nil, err
		}
		for _, i := range res.Installations {
			out[strconv.FormatInt(i.ID, 10)] = true
		}
		if len(res.Installations) < 100 {
			break
		}
	}
	return out, nil
}

// exchangeCode trades the OAuth code GitHub sends with the setup callback for a user token.
func (g *GitHubApp) exchangeCode(ctx context.Context, code string) (string, error) {
	var out struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error_description"`
	}
	if _, err := g.request(ctx, "", http.MethodPost, g.WebURL+"/login/oauth/access_token",
		map[string]string{"client_id": g.ClientID, "client_secret": g.ClientSecret, "code": code}, &out); err != nil {
		return "", err
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("GitHub refused the authorization code: %s", out.Error)
	}
	return out.AccessToken, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
