package server

/*
TestPersonalAccessTokens — the token a desktop, mobile or extension client holds instead of the
user's password.

This exists because the route was blocked. `/api/auth/tokens` sat in the guard's blocked list, so
every client's "mint a PAT" call got a 404 and silently fell back to keeping the password — the
exact thing adopting PATs was meant to stop. Mocked client tests were all green, because they
mocked the server. So these run against the real one.

What it pins down: a PAT authenticates like a session, it is scoped to the user and not to a
workspace, one user cannot revoke another's, and a token that claims to be narrowed is refused
rather than over-granted.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run PersonalAccessTokens -v
*/

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/fadymondy/mahaam/internal/platform"
)

func TestPersonalAccessTokens(t *testing.T) {
	a, srv := bootStack(t)
	alice, aliceID, _ := signup(t, a, srv.URL, "pat-alice")
	bob, _, _ := signup(t, a, srv.URL, "pat-bob")

	ws := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "PAT " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	alice.ws = ws

	// 1. The route is reachable at all. This is the regression: it used to answer 404 from the
	// guard, which every client treated as "this server is too old" and worked around by keeping
	// the password.
	minted := alice.must("POST", "/api/auth/tokens", map[string]any{"name": "Mahaam extension — test"}, 201)
	token, _ := minted["token"].(string)
	if !strings.HasPrefix(token, "togo_pat_") {
		t.Fatalf("minted token is not a PAT: %v", minted)
	}

	// 2. It is returned once and stored only as a hash, so a leaked database is not a leaked token.
	var hash, name string
	if err := a.SysDB.QueryRow(`SELECT token_hash, name FROM personal_access_tokens WHERE user_id = $1`, aliceID).Scan(&hash, &name); err != nil {
		t.Fatal(err)
	}
	if hash == token || strings.Contains(hash, "togo_pat_") {
		t.Error("the plaintext token is in the database")
	}
	if name != "Mahaam extension — test" {
		t.Errorf("name round-trip: %q", name)
	}

	// 3. It authenticates. A client holding only this, with no cookie and no password, is signed in
	// as alice and sees her workspace.
	byToken := newClient(t, srv.URL)
	byToken.bearer = token
	byToken.ws = ws
	me := byToken.must("GET", "/api/auth/me", nil, 200)
	if id, _ := me["id"].(string); id != aliceID {
		// The user may be nested; either shape is fine as long as it is alice.
		if u, _ := me["user"].(map[string]any); u == nil || u["id"] != aliceID {
			t.Fatalf("a PAT did not authenticate as its owner: %v", me)
		}
	}
	if code, b := byToken.do("GET", "/api/w/projects", nil); code != http.StatusOK {
		t.Fatalf("PAT against a workspace route: got %d: %s", code, b)
	}

	// 4. It carries the user's own access and no more: the workspace role still comes from our
	// membership table, so a PAT cannot reach a workspace alice is not in.
	bobWS := bob.must("POST", "/api/me/workspaces", map[string]string{"name": "Bob " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	byToken.ws = bobWS
	if code, b := byToken.do("GET", "/api/w/projects", nil); code != http.StatusNotFound {
		t.Errorf("alice's PAT in bob's workspace: got %d, want 404: %s", code, b)
	}
	byToken.ws = ws

	// 5. A token that claims to be scoped is refused rather than quietly over-granted. Nothing in
	// Mahaam checks the auth plugin's "abilities", so issuing one would hand someone a
	// narrow-looking token that can do everything they can.
	code, b := alice.do("POST", "/api/auth/tokens", map[string]any{"name": "scoped", "abilities": []string{"issues:read"}})
	if code != http.StatusUnprocessableEntity {
		t.Errorf("a scoped PAT request: got %d, want 422: %s", code, b)
	}
	if !strings.Contains(string(b), "abilities_unsupported") {
		t.Errorf("the refusal does not say why: %s", b)
	}
	var scoped int
	if err := a.SysDB.QueryRow(`SELECT count(*) FROM personal_access_tokens WHERE user_id = $1 AND abilities <> ''`, aliceID).Scan(&scoped); err != nil {
		t.Fatal(err)
	}
	if scoped != 0 {
		t.Errorf("%d scoped token(s) were issued anyway", scoped)
	}

	// 6. Listing shows the user their own devices, and only their own.
	listed := listTokens(t, alice)
	if len(listed) != 1 {
		t.Fatalf("alice sees %d of her tokens, want 1", len(listed))
	}
	tokenID, _ := listed[0]["id"].(string)
	if tokenID == "" {
		t.Fatalf("listed token has no id: %v", listed[0])
	}
	if got := listTokens(t, bob); len(got) != 0 {
		t.Errorf("bob sees %d of alice's tokens", len(got))
	}

	// 7. Bob cannot revoke alice's device. The plugin scopes the delete by user_id, so this answers
	// 200 without deleting anything — which is why the check is that the token still WORKS, not
	// that the call failed. A status code would not have caught it.
	if code, b := bob.do("DELETE", "/api/auth/tokens/"+tokenID, nil); code >= 500 {
		t.Fatalf("bob revoking alice's token: %d %s", code, b)
	}
	if code, b := byToken.do("GET", "/api/w/projects", nil); code != http.StatusOK {
		t.Fatalf("bob revoked alice's token: got %d: %s", code, b)
	}

	// 8. Alice can. Revocation is the whole reason to hold one of these instead of a password.
	alice.must("DELETE", "/api/auth/tokens/"+tokenID, nil, 200)
	if code, _ := byToken.do("GET", "/api/w/projects", nil); code != http.StatusUnauthorized {
		t.Errorf("a revoked PAT still works: got %d, want 401", code)
	}

	// 9. Anonymous callers get 401, not a 404 that would hide the route from an honest client.
	anon := newClient(t, srv.URL)
	if code, b := anon.do("GET", "/api/auth/tokens", nil); code != http.StatusUnauthorized {
		t.Errorf("anonymous list: got %d, want 401: %s", code, b)
	}
	if code, b := anon.do("POST", "/api/auth/tokens", map[string]any{"name": "x"}); code != http.StatusUnauthorized {
		t.Errorf("anonymous mint: got %d, want 401: %s", code, b)
	}

	// 10. A suspended account cannot mint one. Minting is signed-in tier precisely so accountGate
	// runs — otherwise suspending someone would leave them able to issue a token that outlives the
	// suspension, which is the opposite of why these are worth holding.
	if _, err := a.SysDB.Exec(`INSERT INTO platform_users (user_id, suspended_at, suspended_reason)
		VALUES ($1, now(), 'suspended for a test') ON CONFLICT (user_id) DO UPDATE SET suspended_at = now()`, aliceID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = a.SysDB.Exec(`UPDATE platform_users SET suspended_at = NULL WHERE user_id = $1`, aliceID)
	}()
	// Platform state is cached for a few seconds, so a direct UPDATE is not visible yet — the
	// admin path that suspends someone calls this too.
	platform.Invalidate(aliceID)
	if code, b := alice.do("POST", "/api/auth/tokens", map[string]any{"name": "after suspension"}); code == http.StatusCreated {
		t.Errorf("a suspended account minted a token: %s", b)
	}
}

func listTokens(t *testing.T, c *client) []map[string]any {
	t.Helper()
	code, b := c.do("GET", "/api/auth/tokens", nil)
	if code != http.StatusOK {
		t.Fatalf("list tokens: got %d: %s", code, b)
	}
	return decodeList(t, b)
}

// The plugin answers a bare JSON array, not the {items: …} envelope the domain routes use.
func decodeList(t *testing.T, b []byte) []map[string]any {
	t.Helper()
	var raw []map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("list body: %v: %s", err, b)
	}
	return raw
}
