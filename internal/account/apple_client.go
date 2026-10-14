package account

/*
Talking to Apple with our own key: the authorization-code exchange and token revocation.

Both need a client secret, which for Apple is not a fixed string but a short JWT we sign with a
Sign in with Apple private key (.p8, ES256) from the developer account:

	header  {alg: ES256, kid: APPLE_KEY_ID}
	claims  {iss: APPLE_TEAM_ID, iat, exp (≤ 6 months; we use 5 minutes), aud: https://appleid.apple.com,
	         sub: the client id — the bundle id for the iOS app, the Services ID for the web}

	POST https://appleid.apple.com/auth/token   code → {id_token, refresh_token}
	POST https://appleid.apple.com/auth/revoke  the refresh token, when the account is deleted

Configuration (all optional; without them native sign-in still works, the web has no Apple button,
and deleting an account cannot revoke the Apple grant — logged, not an error):

	APPLE_TEAM_ID       the 10-character Team ID
	APPLE_KEY_ID        the key's id
	APPLE_PRIVATE_KEY   the .p8 contents (PEM; "\n" escapes are accepted), or
	APPLE_PRIVATE_KEY_FILE  a path to it
	APPLE_SERVICES_ID   the Services ID the web signs in with (com.fadymondy.mahaam.web)
*/

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const appleBase = "https://appleid.apple.com"

// AppleClient signs client secrets and calls Apple's token and revoke endpoints.
type AppleClient struct {
	TeamID     string
	KeyID      string
	Key        *ecdsa.PrivateKey
	ServicesID string
	HTTP       *http.Client
}

// NewAppleClientFromEnv reads the APPLE_* key settings; nil when the key isn't configured.
func NewAppleClientFromEnv() (*AppleClient, error) {
	team, kid := strings.TrimSpace(os.Getenv("APPLE_TEAM_ID")), strings.TrimSpace(os.Getenv("APPLE_KEY_ID"))
	pemText := os.Getenv("APPLE_PRIVATE_KEY")
	if pemText == "" {
		if f := strings.TrimSpace(os.Getenv("APPLE_PRIVATE_KEY_FILE")); f != "" {
			b, err := os.ReadFile(f) //#nosec G304 -- operator-provided key path
			if err != nil {
				return nil, fmt.Errorf("APPLE_PRIVATE_KEY_FILE: %w", err)
			}
			pemText = string(b)
		}
	}
	if team == "" || kid == "" || strings.TrimSpace(pemText) == "" {
		return nil, nil
	}
	key, err := parseAppleKey(pemText)
	if err != nil {
		return nil, err
	}
	return &AppleClient{TeamID: team, KeyID: kid, Key: key, ServicesID: strings.TrimSpace(os.Getenv("APPLE_SERVICES_ID")),
		HTTP: &http.Client{Timeout: 15 * time.Second}}, nil
}

func parseAppleKey(text string) (*ecdsa.PrivateKey, error) {
	text = strings.ReplaceAll(strings.TrimSpace(text), `\n`, "\n")
	block, _ := pem.Decode([]byte(text))
	if block == nil {
		return nil, errors.New("APPLE_PRIVATE_KEY: not a PEM key")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("APPLE_PRIVATE_KEY: %w", err)
	}
	ec, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("APPLE_PRIVATE_KEY: not an EC (ES256) key")
	}
	return ec, nil
}

// ClientSecret is the signed JWT that stands in for a client secret for clientID.
func (c *AppleClient) ClientSecret(clientID string) (string, error) {
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": c.TeamID, "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(), "aud": appleBase, "sub": clientID,
	})
	tok.Header["kid"] = c.KeyID
	return tok.SignedString(c.Key)
}

// AppleTokens is what the code exchange returns.
type AppleTokens struct {
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
}

func (c *AppleClient) post(ctx context.Context, path string, form url.Values) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, appleBase+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	h := c.HTTP
	if h == nil {
		h = &http.Client{Timeout: 15 * time.Second}
	}
	return h.Do(req)
}

// Exchange trades an authorization code for tokens. redirectURI is the web flow's; empty for the
// native app's code.
func (c *AppleClient) Exchange(ctx context.Context, clientID, code, redirectURI string) (*AppleTokens, error) {
	secret, err := c.ClientSecret(clientID)
	if err != nil {
		return nil, err
	}
	form := url.Values{"client_id": {clientID}, "client_secret": {secret}, "code": {code}, "grant_type": {"authorization_code"}}
	if redirectURI != "" {
		form.Set("redirect_uri", redirectURI)
	}
	res, err := c.post(ctx, "/auth/token", form)
	if err != nil {
		return nil, fmt.Errorf("apple token: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("apple token: status %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var out AppleTokens
	if err := json.Unmarshal(body, &out); err != nil || out.IDToken == "" {
		return nil, errors.New("apple token: no id_token")
	}
	return &out, nil
}

// Revoke invalidates a refresh token, ending the person's Sign in with Apple grant for clientID.
func (c *AppleClient) Revoke(ctx context.Context, clientID, refreshToken string) error {
	secret, err := c.ClientSecret(clientID)
	if err != nil {
		return err
	}
	res, err := c.post(ctx, "/auth/revoke", url.Values{"client_id": {clientID}, "client_secret": {secret},
		"token": {refreshToken}, "token_type_hint": {"refresh_token"}})
	if err != nil {
		return fmt.Errorf("apple revoke: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("apple revoke: status %d", res.StatusCode)
	}
	return nil
}

// subjectOf reads `sub` from an id_token Apple returned to us directly over TLS (the code exchange),
// to check the refresh token belongs to the identity just verified.
func subjectOf(idToken string) string {
	claims := jwt.MapClaims{}
	if _, _, err := jwt.NewParser().ParseUnverified(idToken, claims); err != nil {
		return ""
	}
	sub, _ := claims["sub"].(string)
	return sub
}
