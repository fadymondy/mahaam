package push

import (
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

/*
Native push for the mobile apps (MH-352), through Firebase Cloud Messaging's HTTP v1 API.

FCM for both platforms, APNs included, so there's one credential and one sender: Firebase relays
to APNs for iOS once the APNs key is uploaded to the Firebase project. Configured by

	FCM_PROJECT_ID       the Firebase project id
	FCM_SERVICE_ACCOUNT  the service account JSON, inline or as a path to the file
	FCM_ENDPOINT         optional; the API base URL, for tests (default https://fcm.googleapis.com)

With either missing, native push is off and Web Push carries on alone.

Authentication is the OAuth 2 JWT-bearer grant a service account uses: sign a short JWT with the
account's private key, trade it at the account's token_uri for an access token, and reuse that token
until shortly before it expires. It is written here rather than pulled in as the Google client
library, which would add a large dependency tree for one POST.
*/

const fcmScope = "https://www.googleapis.com/auth/firebase.messaging"

type serviceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
	ProjectID   string `json:"project_id"`
}

type fcmSender struct {
	project, email, tokenURI, endpoint string
	key                                *rsa.PrivateKey
	http                               *http.Client

	mu      sync.Mutex
	access  string
	expires time.Time
}

var (
	sendersMu sync.Mutex
	senders   = map[string]*fcmSender{}
)

// nativeSender returns the FCM sender for the current configuration, or nil when it's off. Senders
// are cached by configuration so that the access token is shared by every caller in the process,
// rather than each request signing and trading a new JWT.
func nativeSender() (*fcmSender, error) {
	project := strings.TrimSpace(os.Getenv("FCM_PROJECT_ID"))
	raw := strings.TrimSpace(os.Getenv("FCM_SERVICE_ACCOUNT"))
	if project == "" || raw == "" {
		return nil, nil
	}
	endpoint := strings.TrimRight(strings.TrimSpace(os.Getenv("FCM_ENDPOINT")), "/")
	if endpoint == "" {
		endpoint = "https://fcm.googleapis.com"
	}
	cacheKey := project + "\x00" + endpoint + "\x00" + raw
	sendersMu.Lock()
	defer sendersMu.Unlock()
	if s, ok := senders[cacheKey]; ok {
		return s, nil
	}
	body := []byte(raw)
	if !strings.HasPrefix(raw, "{") {
		b, err := os.ReadFile(raw)
		if err != nil {
			return nil, fmt.Errorf("FCM_SERVICE_ACCOUNT: %w", err)
		}
		body = b
	}
	var sa serviceAccount
	if err := json.Unmarshal(body, &sa); err != nil {
		return nil, fmt.Errorf("FCM_SERVICE_ACCOUNT is not a service account JSON: %w", err)
	}
	key, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(sa.PrivateKey))
	if err != nil {
		return nil, fmt.Errorf("FCM_SERVICE_ACCOUNT private_key: %w", err)
	}
	if sa.ClientEmail == "" {
		return nil, errors.New("FCM_SERVICE_ACCOUNT has no client_email")
	}
	if sa.TokenURI == "" {
		sa.TokenURI = "https://oauth2.googleapis.com/token"
	}
	s := &fcmSender{project: project, email: sa.ClientEmail, tokenURI: sa.TokenURI, endpoint: endpoint, key: key,
		http: &http.Client{Timeout: 20 * time.Second}}
	senders[cacheKey] = s
	return s, nil
}

// token returns a valid access token, fetching one when there is none or it is about to expire.
func (f *fcmSender) token(ctx context.Context) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.access != "" && time.Until(f.expires) > time.Minute {
		return f.access, nil
	}
	now := time.Now()
	assertion, err := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss": f.email, "scope": fcmScope, "aud": f.tokenURI,
		"iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
	}).SignedString(f.key)
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {assertion}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, f.tokenURI, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := f.http.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return "", fmt.Errorf("fcm token: %d %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil || out.AccessToken == "" {
		return "", fmt.Errorf("fcm token: unreadable response (%v)", err)
	}
	f.access, f.expires = out.AccessToken, now.Add(time.Duration(out.ExpiresIn)*time.Second)
	return f.access, nil
}

func (f *fcmSender) forgetToken() {
	f.mu.Lock()
	f.access = ""
	f.mu.Unlock()
}

// sendResult is what became of one message.
type sendResult int

const (
	sentOK sendResult = iota
	sentGone            // the token names no install any more: delete the device
	sentFailed          // anything else: keep the device, try again next time
)

// send delivers one message to one device token.
func (f *fcmSender) send(ctx context.Context, token string, m Message, locale string) (sendResult, error) {
	title, body := m.Title, m.Body
	if t, ok := m.Titles[locale]; ok && t != "" {
		title = t
	}
	data := map[string]string{}
	for k, v := range m.Data {
		data[k] = v
	}
	if m.URL != "" {
		data["url"] = m.URL
	}
	msg := map[string]any{
		"token":        token,
		"notification": map[string]string{"title": title, "body": body},
		"data":         data,
	}
	if tag := collapseTag(m.Tag, m.Data["key"]); tag != "" {
		// Collapse repeats of the same thing (three comments on one task are one banner, updated),
		// the native equivalent of Web Push's Topic.
		msg["android"] = map[string]any{"collapse_key": tag, "notification": map[string]string{"tag": tag}}
		msg["apns"] = map[string]any{"headers": map[string]string{"apns-collapse-id": tag},
			"payload": map[string]any{"aps": map[string]any{"thread-id": m.Tag}}}
	}
	return f.post(ctx, msg)
}

// post sends one FCM v1 message (the "message" object) and classifies the answer.
func (f *fcmSender) post(ctx context.Context, msg map[string]any) (sendResult, error) {
	access, err := f.token(ctx)
	if err != nil {
		return sentFailed, err
	}
	payload, _ := json.Marshal(map[string]any{"message": msg})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		f.endpoint+"/v1/projects/"+url.PathEscape(f.project)+"/messages:send", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")
	res, err := f.http.Do(req)
	if err != nil {
		return sentFailed, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	switch {
	case res.StatusCode < 300:
		return sentOK, nil
	case res.StatusCode == http.StatusUnauthorized:
		f.forgetToken() // revoked or expired early: fetch a fresh one next time
		return sentFailed, fmt.Errorf("fcm: 401 %s", strings.TrimSpace(string(b)))
	case res.StatusCode == http.StatusNotFound || bytes.Contains(b, []byte("UNREGISTERED")):
		// The app was uninstalled, or the token rotated and this one is dead. Keeping it would
		// mean one failed request per notification for ever.
		return sentGone, nil
	case res.StatusCode == http.StatusBadRequest && bytes.Contains(b, []byte("registration token")):
		// A token that was never valid (truncated, from another project).
		return sentGone, nil
	default:
		return sentFailed, fmt.Errorf("fcm: %d %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
}

// collapseTag is kind + key, trimmed to APNs' 64-byte limit on apns-collapse-id.
func collapseTag(kind, key string) string {
	t := kind
	if key != "" {
		t += ":" + key
	}
	if len(t) > 64 {
		t = t[:64]
	}
	return t
}
