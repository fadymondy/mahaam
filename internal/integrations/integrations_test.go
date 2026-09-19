package integrations

import (
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
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestVerifyWebhookSignature(t *testing.T) {
	body := []byte(`{"action":"opened"}`)
	m := hmac.New(sha256.New, []byte("s3cret"))
	m.Write(body)
	good := "sha256=" + hex.EncodeToString(m.Sum(nil))
	if !VerifyWebhookSignature("s3cret", body, good) {
		t.Fatal("a correct signature must verify")
	}
	for name, c := range map[string]struct {
		secret, header string
		body           []byte
	}{
		"wrong secret": {"other", good, body},
		"changed body": {"s3cret", good, []byte(`{"action":"closed"}`)},
		"no prefix":    {"s3cret", strings.TrimPrefix(good, "sha256="), body},
		"sha1":         {"s3cret", "sha1=" + strings.TrimPrefix(good, "sha256="), body},
		"empty secret": {"", good, body},
		"garbage":      {"s3cret", "sha256=zz", body},
		"empty header": {"s3cret", "", body},
	} {
		if VerifyWebhookSignature(c.secret, c.body, c.header) {
			t.Errorf("%s: must not verify", name)
		}
	}
}

func TestSignAppJWT(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	tok, err := SignAppJWT(key, "12345", now)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("a JWT has three parts: %q", tok)
	}
	hdr, _ := base64.RawURLEncoding.DecodeString(parts[0])
	if string(hdr) != `{"alg":"RS256","typ":"JWT"}` {
		t.Fatalf("header: %s", hdr)
	}
	var claims map[string]any
	raw, _ := base64.RawURLEncoding.DecodeString(parts[1])
	_ = json.Unmarshal(raw, &claims)
	if claims["iss"] != "12345" || int64(claims["iat"].(float64)) != now.Unix()-60 || int64(claims["exp"].(float64)) != now.Unix()+540 {
		t.Fatalf("claims: %v", claims)
	}
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, sum[:], sig); err != nil {
		t.Fatalf("signature does not verify with the public key: %v", err)
	}

	// Both PEM encodings GitHub users meet parse.
	p1 := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	p8 := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	for _, p := range [][]byte{p1, p8} {
		if k, err := ParseRSAKey(p); err != nil || k.N.Cmp(key.N) != 0 {
			t.Fatalf("ParseRSAKey: %v", err)
		}
	}
	// And the env form with literal \n escapes.
	env := map[string]string{"GITHUB_APP_ID": "1", "GITHUB_APP_SLUG": "mahaam", "GITHUB_APP_PRIVATE_KEY": strings.ReplaceAll(string(p1), "\n", `\n`)}
	if _, err := GitHubFromEnv(func(k string) string { return env[k] }); err != nil {
		t.Fatalf("escaped PEM from env: %v", err)
	}
	if _, err := GitHubFromEnv(func(string) string { return "" }); err != ErrGitHubNotConfigured {
		t.Fatalf("missing env: %v", err)
	}
}

func TestInstallationTokenCached(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/app/installations/42/access_tokens" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			http.Error(w, `{"message":"bad"}`, 401)
			return
		}
		calls++
		_, _ = io.WriteString(w, `{"token":"ghs_x","expires_at":"`+time.Now().Add(time.Hour).UTC().Format(time.RFC3339)+`"}`)
	}))
	defer srv.Close()
	g := &GitHubApp{AppID: "1", Key: key, APIURL: srv.URL, HTTP: srv.Client()}
	for i := 0; i < 3; i++ {
		tok, err := g.installationToken(context.Background(), "42")
		if err != nil || tok != "ghs_x" {
			t.Fatalf("token: %q %v", tok, err)
		}
	}
	if calls != 1 {
		t.Fatalf("the token must be cached, fetched %d times", calls)
	}
	if _, err := g.installationToken(context.Background(), "../x"); err == nil {
		t.Fatal("a non-numeric installation id must be refused")
	}
}

func TestJiraImportMapping(t *testing.T) {
	var pages int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, p, ok := r.BasicAuth()
		if r.URL.Path != "/rest/api/3/search/jql" || !ok || u != "me@x.test" || p != "tok" {
			http.Error(w, `{"errorMessages":["nope"]}`, 401)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		pages++
		if body["nextPageToken"] == nil {
			_, _ = io.WriteString(w, `{"issues":[{"id":"10001","key":"PROJ-1","fields":{"summary":"Crash on save",
				"description":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Steps"}]},{"type":"paragraph","content":[{"type":"text","text":"Then boom"}]}]},
				"status":{"name":"In Progress","statusCategory":{"key":"indeterminate"}},"issuetype":{"name":"Bug"},"priority":{"name":"Blocker"}}}],
				"nextPageToken":"p2","isLast":false}`)
			return
		}
		_, _ = io.WriteString(w, `{"issues":[{"id":"10002","key":"PROJ-2","fields":{"summary":"Dark mode",
			"status":{"statusCategory":{"key":"done"}},"issuetype":{"name":"New Feature"},"priority":{"name":"Minor"}}},
			{"id":"10003","key":"PROJ-3","fields":{"summary":"Docs","status":{"statusCategory":{"key":"new"}},"issuetype":{"name":"Task"}}}],"isLast":true}`)
	}))
	defer srv.Close()
	c := &jiraClient{base: srv.URL, email: "me@x.test", token: "tok", http: srv.Client()}
	got, err := c.all(context.Background(), "project = PROJ")
	if err != nil {
		t.Fatal(err)
	}
	if pages != 2 || len(got) != 3 {
		t.Fatalf("paged %d times, %d issues", pages, len(got))
	}
	want := []ExternalIssue{
		{Source: "jira", ExternalID: "10001", Key: "PROJ-1", URL: srv.URL + "/browse/PROJ-1", Title: "Crash on save", Body: "Steps\nThen boom", Status: "in_progress", IssueType: "bug", Priority: "highest"},
		{Source: "jira", ExternalID: "10002", Key: "PROJ-2", URL: srv.URL + "/browse/PROJ-2", Title: "Dark mode", Status: "done", IssueType: "feature", Priority: "low"},
		{Source: "jira", ExternalID: "10003", Key: "PROJ-3", URL: srv.URL + "/browse/PROJ-3", Title: "Docs", Status: "todo", IssueType: "task", Priority: "medium"},
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("issue %d:\n got %+v\nwant %+v", i, got[i], want[i])
		}
	}
	bad := &jiraClient{base: srv.URL, email: "me@x.test", token: "wrong", http: srv.Client()}
	if _, err := bad.all(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "credentials") {
		t.Fatalf("a refused token must say so: %v", err)
	}
}

func TestValidateJiraURL(t *testing.T) {
	if u, err := validateJiraURL("https://acme.atlassian.net/jira/software"); err != nil || u != "https://acme.atlassian.net" {
		t.Fatalf("got %q %v", u, err)
	}
	for _, bad := range []string{"http://acme.atlassian.net", "https://127.0.0.1", "https://localhost", "https://evil.example.com", "acme", ""} {
		if _, err := validateJiraURL(bad); err == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
	t.Setenv("JIRA_ALLOWED_HOSTS", "jira.acme.com")
	if _, err := validateJiraURL("https://jira.acme.com"); err != nil {
		t.Fatalf("an allowlisted host must pass: %v", err)
	}
}

func TestLinearImportMapping(t *testing.T) {
	var sawFilter []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "lin_api_x" {
			w.WriteHeader(401)
			_, _ = io.WriteString(w, `{"errors":[{"message":"Authentication required"}]}`)
			return
		}
		var body struct {
			Variables map[string]any `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		sawFilter = append(sawFilter, body.Variables["filter"].(map[string]any))
		if body.Variables["after"] == nil {
			_, _ = io.WriteString(w, `{"data":{"issues":{"nodes":[{"id":"a1","identifier":"ENG-1","title":"Login bug","description":"broken",
				"url":"https://linear.app/x/issue/ENG-1","priority":1,"state":{"type":"started","name":"In Progress"},"labels":{"nodes":[{"name":"Bug"}]}}],
				"pageInfo":{"hasNextPage":true,"endCursor":"c1"}}}}`)
			return
		}
		_, _ = io.WriteString(w, `{"data":{"issues":{"nodes":[
			{"id":"a2","identifier":"ENG-2","title":"Export","description":null,"url":"u2","priority":0,"state":{"type":"canceled"},"labels":{"nodes":[{"name":"Feature"}]}},
			{"id":"a3","identifier":"ENG-3","title":"Triage me","url":"u3","priority":4,"state":{"type":"triage"},"labels":{"nodes":[]}},
			{"id":"a4","identifier":"ENG-4","title":"Later","url":"u4","priority":2,"state":{"type":"backlog"},"labels":{"nodes":[]}}],
			"pageInfo":{"hasNextPage":false,"endCursor":"c2"}}}}`)
	}))
	defer srv.Close()
	c := &linearClient{url: srv.URL, key: "lin_api_x", http: srv.Client()}
	got, err := c.all(context.Background(), "eng")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 4 {
		t.Fatalf("got %d issues", len(got))
	}
	want := []struct{ key, status, prio, typ string }{
		{"ENG-1", "in_progress", "highest", "bug"}, {"ENG-2", "done", "medium", "feature"},
		{"ENG-3", "todo", "low", "task"}, {"ENG-4", "backlog", "high", "task"},
	}
	for i, w := range want {
		g := got[i]
		if g.Key != w.key || g.Status != w.status || g.Priority != w.prio || g.IssueType != w.typ || g.Source != "linear" {
			t.Errorf("issue %d: got %+v want %+v", i, g, w)
		}
	}
	if got[0].Body != "broken" || got[0].URL != "https://linear.app/x/issue/ENG-1" {
		t.Errorf("body/url: %+v", got[0])
	}
	// A team key filters on key (upper-cased); a UUID filters on id.
	if k := sawFilter[0]["team"].(map[string]any)["key"].(map[string]any)["eq"]; k != "ENG" {
		t.Errorf("team key filter: %v", sawFilter[0])
	}
	if _, err := c.all(context.Background(), "3f2a1c4e-1111-4222-8333-444455556666"); err != nil {
		t.Fatal(err)
	}
	if _, ok := sawFilter[len(sawFilter)-1]["team"].(map[string]any)["id"]; !ok {
		t.Errorf("uuid team filter: %v", sawFilter[len(sawFilter)-1])
	}
	bad := &linearClient{url: srv.URL, key: "nope", http: srv.Client()}
	if _, err := bad.all(context.Background(), "ENG"); err == nil || !strings.Contains(err.Error(), "API key") {
		t.Fatalf("a refused key must say so: %v", err)
	}
}

func TestGitHubIssueMapping(t *testing.T) {
	body := "details"
	x := mapGitHub("acme/web", ghIssue{ID: 99, Number: 7, Title: "Broken", Body: &body, State: "closed", HTMLURL: "u",
		Labels: []struct {
			Name string `json:"name"`
		}{{"bug"}}})
	if x.ExternalID != "99" || x.Key != "acme/web#7" || x.Status != "done" || x.IssueType != "bug" || !x.OpenClosedOnly || x.state() != "closed" {
		t.Fatalf("%+v", x)
	}
}

func TestInstallState(t *testing.T) {
	now := time.Now()
	st := signState(installState{W: "w1", P: "p1", U: "u1", L: "ar", Exp: now.Add(time.Minute).Unix()})
	got, err := parseState(st, now)
	if err != nil || got.W != "w1" || got.P != "p1" || got.U != "u1" || got.L != "ar" {
		t.Fatalf("round trip: %+v %v", got, err)
	}
	if _, err := parseState(st, now.Add(2*time.Minute)); err == nil {
		t.Fatal("an expired state must be refused")
	}
	payload, sig, _ := strings.Cut(st, ".")
	forged, _ := json.Marshal(installState{W: "w2", P: "p1", U: "u1", Exp: now.Add(time.Hour).Unix()})
	if _, err := parseState(base64.RawURLEncoding.EncodeToString(forged)+"."+sig, now); err == nil {
		t.Fatal("a state with a changed payload must be refused")
	}
	if _, err := parseState(payload+".AAAA", now); err == nil {
		t.Fatal("a bad signature must be refused")
	}
}

func TestADFText(t *testing.T) {
	if adfText(json.RawMessage(`"plain"`)) != "plain" || adfText(nil) != "" || adfText(json.RawMessage(`null`)) != "" {
		t.Fatal("plain / empty")
	}
}
