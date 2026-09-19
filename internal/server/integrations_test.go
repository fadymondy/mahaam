package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/db/migrate"
)

/*
TestIntegrations — the GitHub webhook and the integration settings on the real stack (no GitHub,
Jira or Linear is called: the webhook is fed signed deliveries, and the credential-bearing
connect paths are checked for sealing and authorization only).

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run Integrations -v
*/
func TestIntegrations(t *testing.T) {
	owner, appURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_APP_DATABASE_URL")
	if owner == "" || appURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_APP_DATABASE_URL to run the integrations test")
	}
	const secret = "webhook-test-secret"
	t.Setenv("DATABASE_URL", owner)
	t.Setenv("APP_DATABASE_URL", appURL)
	t.Setenv("DB_DRIVER", "pgx")
	t.Setenv("AUTH_SECRET", "integrations-test-secret-integrations-test-0123")
	t.Setenv("STORAGE_DIR", t.TempDir())
	// Workspaces created by these tests start unlimited (the plan tests move them explicitly).
	t.Setenv("PLAN_DEFAULT", "unlimited")
	t.Setenv("GITHUB_WEBHOOK_SECRET", secret)

	k0 := togo.New()
	sys, err := k0.SQL(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate.Run(context.Background(), sys, appURL, "../..", t.Logf); err != nil {
		t.Fatal(err)
	}
	k0.Close()
	a := Boot()
	defer a.Kernel.Close()
	srv := httptest.NewServer(a.Kernel.Handler())
	defer srv.Close()

	alice, bob := newClient(t, srv.URL), newClient(t, srv.URL)
	ae, be := "gh-alice-"+rnd()+"@example.test", "gh-bob-"+rnd()+"@example.test"
	alice.must("POST", "/api/auth/register", map[string]string{"email": ae, "password": "correct-horse-1"}, 201)
	bob.must("POST", "/api/auth/register", map[string]string{"email": be, "password": "correct-horse-2"}, 201)
	aID := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "GH A " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	bID := bob.must("POST", "/api/me/workspaces", map[string]string{"name": "GH B " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	alice.ws, bob.ws = aID, bID
	prA := alice.must("POST", "/api/w/projects", map[string]any{"name": "Repo project"}, 201)["id"].(string)
	prB := bob.must("POST", "/api/w/projects", map[string]any{"name": "Other"}, 201)["id"].(string)
	var aliceID string
	_ = a.SysDB.QueryRow(`SELECT id FROM users WHERE email = $1`, ae).Scan(&aliceID)

	// A's project is linked to acme/web on a fresh installation id (the install + repo pick need GitHub).
	inst := fmt.Sprint(time.Now().UnixNano() % 1_000_000_000_000)
	repo := "acme/web-" + rnd()
	if _, err := a.SysDB.Exec(`INSERT INTO project_integrations (workspace_id, project_id, provider, status, config, created_by)
		VALUES ($1, $2, 'github', 'active', jsonb_build_object('installation_id', $3::text, 'repo', $4::text, 'default_branch', 'main'), $5)`,
		aID, prA, inst, repo, aliceID); err != nil {
		t.Fatal(err)
	}

	deliver := func(event string, payload map[string]any, sign bool) int {
		payload["installation"] = map[string]any{"id": json.Number(inst)}
		payload["repository"] = map[string]any{"full_name": repo}
		body, _ := json.Marshal(payload)
		req, _ := http.NewRequest("POST", srv.URL+"/api/integrations/github/webhook", bytes.NewReader(body))
		req.Header.Set("X-GitHub-Event", event)
		m := hmac.New(sha256.New, []byte(secret))
		m.Write(body)
		sig := "sha256=" + hex.EncodeToString(m.Sum(nil))
		if !sign {
			sig = "sha256=" + strings.Repeat("0", 64)
		}
		req.Header.Set("X-Hub-Signature-256", sig)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	issue := func(state string) map[string]any {
		return map[string]any{"id": 9001, "number": 12, "title": "Checkout fails", "body": "500 on pay", "state": state,
			"html_url": "https://github.com/" + repo + "/issues/12", "labels": []any{map[string]any{"name": "bug"}}}
	}
	count := func(q string, args ...any) int {
		var n int
		if err := a.SysDB.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	if code := deliver("issues", map[string]any{"action": "opened", "issue": issue("open")}, false); code != 401 {
		t.Fatalf("an unsigned delivery must be 401, got %d", code)
	}
	if n := count(`SELECT count(*) FROM reports WHERE workspace_id = $1`, aID); n != 0 {
		t.Fatalf("an unsigned delivery changed data: %d", n)
	}
	for i := 0; i < 2; i++ { // a redelivery is an update, not a second issue
		if code := deliver("issues", map[string]any{"action": "opened", "issue": issue("open")}, true); code != 202 {
			t.Fatalf("delivery: %d", code)
		}
	}
	var key, status, typ, extKey string
	if err := a.SysDB.QueryRow(`SELECT key, status, issue_type, external_key FROM reports WHERE workspace_id = $1 AND external_source = 'github' AND external_id = '9001'`,
		aID).Scan(&key, &status, &typ, &extKey); err != nil {
		t.Fatalf("the GitHub issue was not imported: %v", err)
	}
	if n := count(`SELECT count(*) FROM reports WHERE workspace_id = $1`, aID); n != 1 {
		t.Fatalf("redelivery duplicated the issue: %d rows", n)
	}
	if status != "backlog" || typ != "bug" || extKey != repo+"#12" {
		t.Fatalf("mapping: status=%s type=%s key=%s", status, typ, extKey)
	}

	// Closed on GitHub → done in Mahaam.
	deliver("issues", map[string]any{"action": "closed", "issue": issue("closed")}, true)
	_ = a.SysDB.QueryRow(`SELECT status FROM reports WHERE workspace_id = $1 AND key = $2`, aID, key).Scan(&status)
	if status != "done" {
		t.Fatalf("closed on GitHub should be done, got %s", status)
	}

	// A comment, delivered twice, lands once.
	for i := 0; i < 2; i++ {
		deliver("issue_comment", map[string]any{"action": "created", "issue": issue("closed"),
			"comment": map[string]any{"id": 55, "body": "repro attached", "user": map[string]any{"login": "octo"}, "html_url": "u"}}, true)
	}
	if n := count(`SELECT count(*) FROM report_comments c JOIN reports r ON r.id = c.report_id WHERE r.workspace_id = $1 AND r.key = $2 AND c.body LIKE '%repro attached%'`, aID, key); n != 1 {
		t.Fatalf("comment count %d, want 1", n)
	}

	// Push → commit log; redelivery deduped.
	for i := 0; i < 2; i++ {
		deliver("push", map[string]any{"ref": "refs/heads/main", "commits": []any{
			map[string]any{"id": "abc123", "message": "fix checkout\n\nbody", "url": "u", "timestamp": "2026-09-01T10:00:00Z",
				"author": map[string]any{"name": "Octo", "email": "o@x.test", "username": "octo"}}}}, true)
	}
	if n := count(`SELECT count(*) FROM github_events WHERE workspace_id = $1 AND kind = 'commit' AND sha = 'abc123' AND title = 'fix checkout'`, aID); n != 1 {
		t.Fatalf("commit log %d, want 1", n)
	}
	// Nothing reached B.
	if n := count(`SELECT count(*) FROM reports WHERE workspace_id = $1`, bID) + count(`SELECT count(*) FROM github_events WHERE workspace_id = $1`, bID); n != 0 {
		t.Fatalf("a delivery for A's repo wrote %d rows into B", n)
	}

	// Uninstalled on GitHub → disabled.
	deliver("installation", map[string]any{"action": "deleted"}, true)
	_ = a.SysDB.QueryRow(`SELECT status FROM project_integrations WHERE workspace_id = $1 AND provider = 'github'`, aID).Scan(&status)
	if status != "disabled" {
		t.Fatalf("uninstall should disable, got %s", status)
	}

	// Connecting Linear seals the key; the API never returns it.
	body := alice.must("PUT", "/api/w/projects/"+prA+"/integrations/linear", map[string]any{"team_id": "ENG", "api_key": "lin_api_SECRET"}, 200)
	if body["has_secret"] != true {
		t.Fatalf("has_secret: %v", body)
	}
	code, list := alice.do("GET", "/api/w/projects/"+prA+"/integrations", nil)
	if code != 200 || strings.Contains(string(list), "lin_api_SECRET") {
		t.Fatalf("list %d leaked the key: %s", code, list)
	}
	var stored string
	_ = a.SysDB.QueryRow(`SELECT secret FROM project_integrations WHERE workspace_id = $1 AND provider = 'linear'`, aID).Scan(&stored)
	if strings.Contains(stored, "lin_api_SECRET") || !strings.HasPrefix(stored, "v") {
		t.Fatalf("the key is not sealed at rest: %q", stored)
	}
	// Reconfigure without the key keeps the stored one.
	alice.must("PUT", "/api/w/projects/"+prA+"/integrations/linear", map[string]any{"team_id": "OPS"}, 200)
	var again string
	_ = a.SysDB.QueryRow(`SELECT secret FROM project_integrations WHERE workspace_id = $1 AND provider = 'linear'`, aID).Scan(&again)
	if again != stored {
		t.Fatal("an update without api_key must keep the stored key")
	}

	// B cannot touch A's project; Jira refuses a non-Atlassian host (SSRF fence).
	if code, _ := bob.do("PUT", "/api/w/projects/"+prA+"/integrations/linear", map[string]any{"team_id": "X", "api_key": "k"}); code != 404 {
		t.Fatalf("B connecting A's project: %d", code)
	}
	if code, b := bob.do("PUT", "/api/w/projects/"+prB+"/integrations/jira", map[string]any{"base_url": "https://169.254.169.254",
		"email": "b@x.test", "project_key": "X", "api_token": "t"}); code != 422 {
		t.Fatalf("jira base_url fence: %d %s", code, b)
	}
	// A member (not manager) cannot connect.
	carolEmail := "gh-carol-" + rnd() + "@example.test"
	carol := newClient(t, srv.URL)
	carol.must("POST", "/api/auth/register", map[string]string{"email": carolEmail, "password": "correct-horse-3"}, 201)
	var carolID string
	_ = a.SysDB.QueryRow(`SELECT id FROM users WHERE email = $1`, carolEmail).Scan(&carolID)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, aID, carolID); err != nil {
		t.Fatal(err)
	}
	carol.ws = aID
	if code, b := carol.do("PUT", "/api/w/projects/"+prA+"/integrations/linear", map[string]any{"team_id": "X", "api_key": "k"}); code != 403 {
		t.Fatalf("a member connecting: %d %s", code, b)
	}
	if code, _ := carol.do("GET", "/api/w/projects/"+prA+"/integrations", nil); code != 200 {
		t.Fatalf("a member reads integration status: %d", code)
	}
}
