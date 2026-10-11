package server

/*
TestMCPProjectScope — a project-scoped MCP token (Settings → MCP tokens → Projects) sees and files
issues and projects only inside its projects: list_issues hides the other project's and the
workspace-level issues, get_issue on them fails, create_issue defaults to its single project,
list_projects shows only it. An unscoped token still sees everything. create_project with a
scoped token succeeds and the token gains the new project (it used to answer "project not found"
after committing an orphan), and the *_project_status tools rebuild its board columns.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run MCPProjectScope -v
*/

import (
	"regexp"
	"strings"
	"testing"
)

func TestMCPProjectScope(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "pscope")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Scope " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	owner.ws = ws
	alpha := owner.must("POST", "/api/w/projects", map[string]any{"name": "Alpha " + rnd(), "billing_mode": "hourly"}, 201)
	beta := owner.must("POST", "/api/w/projects", map[string]any{"name": "Beta " + rnd(), "billing_mode": "hourly"}, 201)
	alphaID, betaID := alpha["id"].(string), beta["id"].(string)

	inAlpha := owner.must("POST", "/api/w/issues", map[string]any{"title": "alpha bug", "project": alphaID}, 201)["key"].(string)
	inBeta := owner.must("POST", "/api/w/issues", map[string]any{"title": "beta bug", "project": betaID}, 201)["key"].(string)
	loose := owner.must("POST", "/api/w/issues", map[string]any{"title": "workspace bug"}, 201)["key"].(string)

	scopes := []string{"projects:read", "projects:write", "issues:read", "issues:write"}
	tok := owner.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "alpha agent", "scopes": scopes, "projects": []string{alphaID}}, 201)
	if ids, _ := tok["token"].(map[string]any)["project_ids"].([]any); len(ids) != 1 || ids[0] != alphaID {
		t.Fatalf("token project_ids = %v", tok["token"])
	}
	agent := newClient(t, srv.URL)
	agent.bearer = tok["plaintext"].(string)
	full := newClient(t, srv.URL)
	full.bearer = owner.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "all", "scopes": scopes}, 201)["plaintext"].(string)

	call := func(c *client, tool string, args map[string]any) (string, bool) {
		t.Helper()
		code, out, _ := rpc(t, c, "tools/call", map[string]any{"name": tool, "arguments": args})
		if code != 200 || out["error"] != nil {
			t.Fatalf("%s: %d %v", tool, code, out)
		}
		res := out["result"].(map[string]any)
		text := res["content"].([]any)[0].(map[string]any)["text"].(string)
		isErr, _ := res["isError"].(bool)
		return text, isErr
	}

	text, _ := call(agent, "list_issues", map[string]any{})
	if !strings.Contains(text, inAlpha) || strings.Contains(text, inBeta) || strings.Contains(text, loose) {
		t.Errorf("scoped list_issues: %q", text)
	}
	if text, isErr := call(agent, "get_issue", map[string]any{"key": inBeta}); !isErr && strings.Contains(text, "beta bug") {
		t.Errorf("scoped get_issue reached another project: %q", text)
	}
	text, isErr := call(agent, "create_issue", map[string]any{"title": "filed by the agent"})
	key := regexp.MustCompile(`M[HG]-\d+`).FindString(text)
	if isErr || key == "" {
		t.Fatalf("scoped create_issue: %v %q", isErr, text)
	}
	got := owner.must("GET", "/api/w/issues/"+key, nil, 200)
	if got["project_id"] != alphaID {
		t.Errorf("create_issue landed in %v, want the token's project", got["project_id"])
	}
	if text, _ := call(agent, "list_projects", map[string]any{}); strings.Contains(text, beta["name"].(string)) {
		t.Errorf("scoped list_projects shows Beta: %q", text)
	}

	// A scoped token creates a project and keeps working in it.
	gamma := "Gamma " + rnd()
	text, isErr = call(agent, "create_project", map[string]any{"name": gamma})
	if isErr || !strings.Contains(text, gamma) {
		t.Fatalf("scoped create_project: %v %q", isErr, text)
	}
	if text, _ := call(agent, "list_projects", map[string]any{}); !strings.Contains(text, gamma) || strings.Contains(text, beta["name"].(string)) {
		t.Errorf("scoped list_projects after create: %q", text)
	}
	var stored string
	if err := a.SysDB.QueryRow(`SELECT project_ids FROM mcp_tokens WHERE id = $1`, tok["token"].(map[string]any)["id"]).Scan(&stored); err != nil ||
		!strings.Contains(stored, alphaID) || strings.Count(stored, ",") != 1 {
		t.Errorf("token project_ids after create = %q (%v)", stored, err)
	}
	if _, isErr := call(agent, "create_project_status", map[string]any{"project": gamma, "name": "Needs Fady", "category": "doing", "index": 0}); isErr {
		t.Fatal("create_project_status failed")
	}
	if _, isErr := call(agent, "update_project_status", map[string]any{"project": gamma, "status": "to do", "name": "Todo"}); isErr {
		t.Fatal("update_project_status (rename) failed")
	}
	if _, isErr := call(agent, "delete_project_status", map[string]any{"project": gamma, "status": "Backlog"}); isErr {
		t.Fatal("delete_project_status failed")
	}
	if _, isErr := call(agent, "reorder_project_statuses", map[string]any{"project": gamma, "order": []string{"Todo", "In progress", "Needs Fady"}}); isErr {
		t.Fatal("reorder_project_statuses failed")
	}
	text, _ = call(agent, "list_project_statuses", map[string]any{"project": gamma})
	want := []string{"0. Todo ", "1. In progress ", "2. Needs Fady ", "3. Waiting approval ", "4. In review ", "5. Done "}
	for _, w := range want {
		if !strings.Contains(text, w) {
			t.Errorf("columns after edits lack %q: %q", w, text)
		}
	}
	if strings.Contains(text, "Backlog") {
		t.Errorf("Backlog still there: %q", text)
	}

	text, _ = call(full, "list_issues", map[string]any{})
	for _, k := range []string{inAlpha, inBeta, loose} {
		if !strings.Contains(text, k) {
			t.Errorf("unscoped list_issues lacks %s: %q", k, text)
		}
	}
}
