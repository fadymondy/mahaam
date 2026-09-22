package server

/*
TestNativePush: device registration and the FCM sender (MH-352), against a fake FCM.

The fake plays both Google endpoints: the OAuth token exchange, where it checks the service
account's JWT really is signed by that account's key, and messages:send, where it records what
arrives and answers UNREGISTERED for a token that no longer names an install. So this pins the
wire format the real FCM expects, without the real FCM.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run NativePush -v
*/

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type fakeFCM struct {
	mu       sync.Mutex
	tokens   int              // access tokens issued
	messages []map[string]any // what messages:send received
	auth     []string         // Authorization header of each send
	pub      *rsa.PublicKey
	email    string
}

func (f *fakeFCM) handler(t *testing.T) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" {
			http.Error(w, "bad grant", 400)
			return
		}
		// The assertion must be signed by the service account's own key and name it.
		tok, err := jwt.Parse(r.Form.Get("assertion"), func(*jwt.Token) (any, error) { return f.pub, nil },
			jwt.WithValidMethods([]string{"RS256"}))
		if err != nil || !tok.Valid {
			http.Error(w, "bad assertion: "+err.Error(), 400)
			return
		}
		claims := tok.Claims.(jwt.MapClaims)
		if claims["iss"] != f.email || claims["scope"] != "https://www.googleapis.com/auth/firebase.messaging" {
			http.Error(w, "wrong claims", 400)
			return
		}
		f.mu.Lock()
		f.tokens++
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "ya29.fake", "expires_in": 3600})
	})
	mux.HandleFunc("/v1/projects/test-proj/messages:send", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		msg, _ := body["message"].(map[string]any)
		f.mu.Lock()
		f.messages = append(f.messages, msg)
		f.auth = append(f.auth, r.Header.Get("Authorization"))
		f.mu.Unlock()
		if msg["token"] == "dead-token" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":{"code":404,"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}`)
			return
		}
		_, _ = io.WriteString(w, `{"name":"projects/test-proj/messages/1"}`)
	})
	return mux
}

func (f *fakeFCM) sentTo(token string) []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []map[string]any
	for _, m := range f.messages {
		if m["token"] == token {
			out = append(out, m)
		}
	}
	return out
}

func TestNativePush(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: must(x509.MarshalPKCS8PrivateKey(key))})
	fake := &fakeFCM{pub: &key.PublicKey, email: "push@test-proj.iam.gserviceaccount.com"}
	fcm := httptest.NewServer(fake.handler(t))
	defer fcm.Close()
	sa, _ := json.Marshal(map[string]string{
		"type": "service_account", "project_id": "test-proj", "client_email": fake.email,
		"private_key": string(pemKey), "token_uri": fcm.URL + "/token",
	})
	t.Setenv("FCM_PROJECT_ID", "test-proj")
	t.Setenv("FCM_SERVICE_ACCOUNT", string(sa))
	t.Setenv("FCM_ENDPOINT", fcm.URL)

	a, srv := bootStack(t)
	alice, _, _ := signup(t, a, srv.URL, "push-alice")
	bob, bobID, _ := signup(t, a, srv.URL, "push-bob")
	carol, _, _ := signup(t, a, srv.URL, "push-carol")
	ws := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Push " + rnd()}, 201)["workspace"].(map[string]any)
	wsID, slug := ws["id"].(string), ws["slug"].(string)
	alice.ws = wsID
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, wsID, bobID); err != nil {
		t.Fatal(err)
	}

	// 1. Registration. native_enabled tells the app that something will actually be sent.
	out := bob.must("POST", "/api/me/devices", map[string]any{"platform": "android", "app": "team", "push_token": "bob-phone-v1", "locale": "ar", "app_version": "1.0.0"}, 200)
	if out["native_enabled"] != true {
		t.Errorf("native_enabled with FCM configured: %v", out)
	}
	// FCM rotated the token: the old row is replaced, not left to fail.
	bob.must("POST", "/api/me/devices", map[string]any{"platform": "android", "app": "team", "push_token": "bob-phone", "previous_token": "bob-phone-v1", "locale": "ar"}, 200)
	bob.must("POST", "/api/me/devices", map[string]any{"platform": "ios", "app": "team", "push_token": "dead-token"}, 200)
	var n int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM devices WHERE user_id = $1`, bobID).Scan(&n)
	if n != 2 {
		t.Fatalf("bob has %d devices after a rotation, want 2", n)
	}
	// A bad platform is refused by the schema, not stored.
	if code, _ := bob.do("POST", "/api/me/devices", map[string]any{"platform": "windows", "app": "team", "push_token": "x"}); code != 422 {
		t.Errorf("platform windows: %d", code)
	}

	// 2. A notification for bob reaches both phones.
	project := alice.must("POST", "/api/w/projects", map[string]any{"name": "Push " + rnd(), "visibility": "workspace"}, 201)["id"].(string)
	alice.must("POST", "/api/w/projects/"+project+"/tasks", map[string]any{"title": "Ship the push", "assignee_ids": []string{bobID}}, 201)

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && (len(fake.sentTo("bob-phone")) == 0 || len(fake.sentTo("dead-token")) == 0) {
		time.Sleep(50 * time.Millisecond)
	}
	got := fake.sentTo("bob-phone")
	if len(got) != 1 {
		t.Fatalf("bob's phone got %d message(s), want 1", len(got))
	}
	msg := got[0]
	data, _ := msg["data"].(map[string]any)
	for _, k := range []string{"workspace_id", "workspace_slug", "kind", "project_id", "key", "notification_id", "url"} {
		if s, _ := data[k].(string); s == "" {
			t.Errorf("data.%s is missing: %v", k, data)
		}
	}
	if data["workspace_id"] != wsID || data["workspace_slug"] != slug || data["kind"] != "task.assigned" || data["project_id"] != project {
		t.Errorf("payload: %v", data)
	}
	// The phone is set to Arabic, the workspace is English: the banner is Arabic.
	note, _ := msg["notification"].(map[string]any)
	if title, _ := note["title"].(string); !strings.Contains(title, "أسند") {
		t.Errorf("an Arabic phone got the title %q", title)
	}
	// Repeats of the same thing collapse.
	android, _ := msg["android"].(map[string]any)
	if ck, _ := android["collapse_key"].(string); !strings.HasPrefix(ck, "task.assigned:") {
		t.Errorf("collapse_key %q", ck)
	}
	if fake.auth[0] != "Bearer ya29.fake" {
		t.Errorf("sent with %q, not the access token", fake.auth[0])
	}

	// 3. The token FCM called UNREGISTERED is deleted; the live one is kept.
	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_ = a.SysDB.QueryRow(`SELECT count(*) FROM devices WHERE push_token = 'dead-token'`).Scan(&n)
		if n == 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if n != 0 {
		t.Error("an UNREGISTERED token was kept")
	}

	// 4. The access token is reused, not fetched per message.
	alice.must("POST", "/api/w/projects/"+project+"/tasks", map[string]any{"title": "And again", "assignee_ids": []string{bobID}}, 201)
	deadline = time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && len(fake.sentTo("bob-phone")) < 2 {
		time.Sleep(50 * time.Millisecond)
	}
	if fake.tokens != 1 {
		t.Errorf("fetched %d access tokens for two notifications, want 1", fake.tokens)
	}

	// 5. The same phone, someone else signs in: the token moves, and bob stops getting carol's
	// notifications on it and vice versa.
	carol.must("POST", "/api/me/devices", map[string]any{"platform": "android", "app": "team", "push_token": "bob-phone"}, 200)
	var owner string
	_ = a.SysDB.QueryRow(`SELECT user_id FROM devices WHERE push_token = 'bob-phone'`).Scan(&owner)
	if owner == bobID {
		t.Error("the token stayed with bob after carol registered it")
	}

	// 6. Removal is scoped to the caller.
	if code, _ := bob.do("DELETE", "/api/me/devices/"+url.PathEscape("bob-phone"), nil); code != 204 {
		t.Errorf("bob removing a token that is now carol's: %d", code)
	}
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM devices WHERE push_token = 'bob-phone'`).Scan(&n)
	if n != 1 {
		t.Error("bob deleted carol's device")
	}
	carol.must("DELETE", "/api/me/devices/"+url.PathEscape("bob-phone"), nil, 204)
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM devices WHERE push_token = 'bob-phone'`).Scan(&n)
	if n != 0 {
		t.Error("carol could not remove her own device")
	}
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}
