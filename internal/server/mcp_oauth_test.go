package server

/*
TestMCPOAuth — the whole "Connect" flow a remote MCP client (Claude.ai, ChatGPT) would run: it
registers itself (RFC 7591, no manual setup), sends the signed-in user to /api/oauth/authorize with
a PKCE challenge, the user allows the connection on the consent endpoint (the browser step; this
test calls it directly rather than driving the Next.js page), the client exchanges the code (with
its verifier) for an access token, that token works against the real MCP JSON-RPC endpoint, and a
refresh rotates it. Also: a bad verifier is rejected, and revoke actually kills the token.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run MCPOAuth -v
*/

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func randVerifier() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func challengeFor(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func postFormValues(t *testing.T, url string, form url.Values) (int, map[string]any) {
	t.Helper()
	res, err := http.PostForm(url, form)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func TestMCPOAuth(t *testing.T) {
	a, srv := bootStack(t)
	t.Setenv("APP_URL", srv.URL) // oauth.go reads APP_URL/WEB_URL per-request, so this is enough
	owner, _, _ := signup(t, a, srv.URL, "oauth")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "OAuth " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	owner.ws = ws
	owner.must("POST", "/api/w/projects", map[string]any{"name": "P " + rnd()}, 201)

	// 1. Dynamic client registration — no manual setup, exactly how a real connector self-registers.
	code, reg := postJSON(t, srv.URL+"/api/oauth/register", map[string]any{
		"client_name":   "Test Connector",
		"redirect_uris": []string{"https://connector.example.com/callback"},
	})
	if code != 201 {
		t.Fatalf("register: %d %v", code, reg)
	}
	clientID := reg["client_id"].(string)
	if !strings.HasPrefix(clientID, "mcpc_") {
		t.Fatalf("client_id prefix: %v", reg)
	}

	// 2. The authorize redirect: validates client_id/redirect_uri, sends the browser to the
	// web app's consent page (a 302 we don't follow — this is the browser's job, not a client's).
	verifier := randVerifier()
	challenge := challengeFor(verifier)
	authQS := url.Values{
		"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {"https://connector.example.com/callback"},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"}, "state": {"xyz"},
	}
	noRedirect := &http.Client{Jar: owner.http.Jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := noRedirect.Get(srv.URL + "/api/oauth/authorize?" + authQS.Encode())
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("authorize: got %d want 302", res.StatusCode)
	}
	loc := res.Header.Get("Location")
	if !strings.Contains(loc, "/oauth/authorize") || !strings.Contains(loc, "client_id="+clientID) {
		t.Fatalf("authorize redirected to %q", loc)
	}

	// 3. Discovery metadata a real client uses to find these endpoints in the first place.
	_, as := getJSON(t, srv.URL+"/.well-known/oauth-authorization-server")
	if as["token_endpoint"] != srv.URL+"/api/oauth/token" || as["registration_endpoint"] != srv.URL+"/api/oauth/register" {
		t.Errorf("authorization server metadata: %v", as)
	}
	_, rs := getJSON(t, srv.URL+"/.well-known/oauth-protected-resource")
	if rs["resource"] != srv.URL+"/api/mcp" {
		t.Errorf("protected resource metadata: %v", rs)
	}

	// 4. The consent screen (what the Next.js page reads, then posts to).
	info := owner.must("GET", "/api/oauth/consent?client_id="+clientID, nil, 200)
	if info["client_name"] != "Test Connector" {
		t.Fatalf("consent info: %v", info)
	}

	// 5. Allow, in the chosen workspace — this is the step that actually creates the code.
	decide := owner.must("POST", "/api/oauth/consent", map[string]any{
		"client_id": clientID, "redirect_uri": "https://connector.example.com/callback",
		"code_challenge": challenge, "code_challenge_method": "S256", "state": "xyz", "workspace_id": ws, "allow": true,
	}, 200)
	redirectTo, err := url.Parse(decide["redirect_to"].(string))
	if err != nil {
		t.Fatal(err)
	}
	authCode := redirectTo.Query().Get("code")
	if authCode == "" || redirectTo.Query().Get("state") != "xyz" {
		t.Fatalf("consent redirect_to: %v", decide)
	}

	// 6. Wrong verifier is rejected (PKCE actually enforced, not decorative).
	if sc, out := postFormValues(t, srv.URL+"/api/oauth/token", url.Values{
		"grant_type": {"authorization_code"}, "code": {authCode}, "redirect_uri": {"https://connector.example.com/callback"},
		"client_id": {clientID}, "code_verifier": {"wrong-verifier-entirely"},
	}); sc != 400 || out["error"] != "invalid_grant" {
		t.Fatalf("bad verifier should be rejected: %d %v", sc, out)
	}

	// 7. The real exchange (the code is still live — the failed attempt above didn't consume it).
	sc, tok := postFormValues(t, srv.URL+"/api/oauth/token", url.Values{
		"grant_type": {"authorization_code"}, "code": {authCode}, "redirect_uri": {"https://connector.example.com/callback"},
		"client_id": {clientID}, "code_verifier": {verifier},
	})
	if sc != 200 || tok["access_token"] == nil || tok["refresh_token"] == nil {
		t.Fatalf("token exchange: %d %v", sc, tok)
	}
	access1 := tok["access_token"].(string)
	refresh1 := tok["refresh_token"].(string)
	if !strings.HasPrefix(access1, "mhm_") {
		t.Fatalf("access_token prefix: %v", tok)
	}

	// The code is single-use: exchanging it again must fail.
	if sc, out := postFormValues(t, srv.URL+"/api/oauth/token", url.Values{
		"grant_type": {"authorization_code"}, "code": {authCode}, "redirect_uri": {"https://connector.example.com/callback"},
		"client_id": {clientID}, "code_verifier": {verifier},
	}); sc != 400 || out["error"] != "invalid_grant" {
		t.Fatalf("replayed code should be rejected: %d %v", sc, out)
	}

	// 8. The access token actually works against the real MCP JSON-RPC endpoint.
	agent := newClient(t, srv.URL)
	agent.bearer = access1
	rcode, list, _ := rpc(t, agent, "tools/list", map[string]any{})
	if rcode != 200 {
		t.Fatalf("tools/list with OAuth-issued token: %d %v", rcode, list)
	}

	// 9. Refresh rotates both tokens; the old access token dies with it.
	sc, tok2 := postFormValues(t, srv.URL+"/api/oauth/token", url.Values{
		"grant_type": {"refresh_token"}, "refresh_token": {refresh1}, "client_id": {clientID},
	})
	if sc != 200 || tok2["access_token"] == nil || tok2["access_token"] == access1 {
		t.Fatalf("refresh: %d %v", sc, tok2)
	}
	access2 := tok2["access_token"].(string)
	agent.bearer = access1
	if rcode, _, _ := rpc(t, agent, "tools/list", map[string]any{}); rcode != 401 {
		t.Errorf("the rotated-out access token should be dead: %d", rcode)
	}
	agent.bearer = access2
	if rcode, _, _ := rpc(t, agent, "tools/list", map[string]any{}); rcode != 200 {
		t.Errorf("the new access token should work: %d", rcode)
	}

	// The old refresh token is one-time-use too.
	if sc, out := postFormValues(t, srv.URL+"/api/oauth/token", url.Values{
		"grant_type": {"refresh_token"}, "refresh_token": {refresh1}, "client_id": {clientID},
	}); sc != 400 || out["error"] != "invalid_grant" {
		t.Fatalf("reused refresh_token should be rejected: %d %v", sc, out)
	}

	// 10. Revoke actually kills the live access token.
	if sc, _ := postFormValues(t, srv.URL+"/api/oauth/revoke", url.Values{"token": {access2}, "client_id": {clientID}}); sc != 200 {
		t.Fatalf("revoke: %d", sc)
	}
	agent.bearer = access2
	if rcode, _, _ := rpc(t, agent, "tools/list", map[string]any{}); rcode != 401 {
		t.Errorf("a revoked access token should be dead: %d", rcode)
	}

	// 11. Deny: no code, and the redirect carries an error, not silence.
	decideDeny := owner.must("POST", "/api/oauth/consent", map[string]any{
		"client_id": clientID, "redirect_uri": "https://connector.example.com/callback",
		"code_challenge": challenge, "code_challenge_method": "S256", "workspace_id": ws, "allow": false,
	}, 200)
	denyTo, _ := url.Parse(decideDeny["redirect_to"].(string))
	if denyTo.Query().Get("error") != "access_denied" {
		t.Errorf("deny redirect_to: %v", decideDeny)
	}

	// 12. A redirect_uri the client never registered is refused outright (no redirect at all —
	// that would be an open redirect).
	if code, _ := postJSON(t, srv.URL+"/api/oauth/register", map[string]any{"redirect_uris": []string{"javascript:alert(1)"}}); code != 400 {
		t.Errorf("an unsafe redirect_uri should be refused at registration: %d", code)
	}
	res2, err := noRedirect.Get(srv.URL + "/api/oauth/authorize?" + url.Values{
		"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {"https://not-registered.example.com/x"},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"},
	}.Encode())
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if res2.StatusCode == http.StatusFound {
		t.Errorf("an unregistered redirect_uri must never be redirected to")
	}
}

func postJSON(t *testing.T, u string, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	res, err := http.Post(u, "application/json", strings.NewReader(string(b)))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func getJSON(t *testing.T, u string) (int, map[string]any) {
	t.Helper()
	res, err := http.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}
