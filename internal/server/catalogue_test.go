package server

/*
TestCatalogue checks a project's agent/skill catalogue end to end: add via REST (and the
same name again updates it), sync with replace drops only synced rows missing from the
payload, a member without manage rights cannot write, another workspace gets 404, and the
MCP tools list and sync the same rows.
*/

import (
	"strings"
	"testing"
)

func TestCatalogue(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "cowner")
	mem, memID, _ := signup(t, a, srv.URL, "cmember")
	outsider, _, _ := signup(t, a, srv.URL, "coutsider")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Catalogue " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	other := outsider.must("POST", "/api/me/workspaces", map[string]string{"name": "Other " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, memID); err != nil {
		t.Fatal(err)
	}
	owner.ws, mem.ws = ws, ws
	proj := "Catalogue site " + rnd()
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": proj, "visibility": "workspace"}, 201)["id"].(string)
	base := "/api/w/projects/" + pid + "/catalogue"

	names := func(list any) []string {
		out := []string{}
		for _, it := range list.([]any) {
			m := it.(map[string]any)
			out = append(out, m["name"].(string)+":"+m["source"].(string))
		}
		return out
	}

	// Add via REST; the same name (any case) updates the description.
	item := owner.must("POST", base, map[string]any{"kind": "agent", "name": "backend-engineer", "description": "Go"}, 201)
	if item["source"] != "ui" || item["kind"] != "agent" {
		t.Errorf("add: %v", item)
	}
	again := owner.must("POST", base, map[string]any{"kind": "agent", "name": "Backend-Engineer", "description": "Go + Postgres"}, 201)
	if again["id"] != item["id"] || again["description"] != "Go + Postgres" {
		t.Errorf("upsert by name: %v", again)
	}
	owner.must("POST", base, map[string]any{"kind": "skill", "name": "hand-skill"}, 201)
	if code, _ := owner.do("POST", base, map[string]any{"kind": "agent", "name": "bad name!"}); code != 422 && code != 400 {
		t.Errorf("an invalid name was accepted: %d", code)
	}

	// A plain member can read but not write.
	mem.must("GET", base, nil, 200)
	if code, _ := mem.do("POST", base, map[string]any{"kind": "agent", "name": "x"}); code != 403 {
		t.Errorf("member wrote the catalogue: %d", code)
	}

	// Sync, then sync with replace: only synced rows missing from the payload go.
	owner.must("PUT", base+"/sync", map[string]any{
		"agents": []map[string]any{{"name": "planner", "description": "Plans"}, {"name": "reviewer"}},
		"skills": []map[string]any{{"name": "deploy", "description": "Ship it"}},
	}, 200)
	out := owner.must("PUT", base+"/sync", map[string]any{
		"agents":  []map[string]any{{"name": "planner", "description": "Plans v2"}},
		"skills":  []map[string]any{},
		"replace": true,
	}, 200)
	if got := strings.Join(names(out["agents"]), ","); got != "Backend-Engineer:ui,planner:sync" {
		t.Errorf("agents after replace: %s", got)
	}
	if got := strings.Join(names(out["skills"]), ","); got != "hand-skill:ui" {
		t.Errorf("skills after replace: %s", got)
	}

	// Delete by id.
	owner.must("DELETE", base+"/"+item["id"].(string), nil, 204)
	if code, _ := owner.do("DELETE", base+"/"+item["id"].(string), nil); code != 404 {
		t.Errorf("second delete: %d", code)
	}

	// Another workspace's user gets 404, naming our workspace or theirs.
	for _, w := range []string{ws, other} {
		outsider.ws = w
		for _, c := range []struct {
			method, path string
			body         any
		}{{"GET", base, nil}, {"POST", base, map[string]any{"kind": "agent", "name": "x"}}, {"PUT", base + "/sync", map[string]any{}}} {
			if code, b := outsider.do(c.method, c.path, c.body); code != 404 {
				t.Errorf("outsider %s %s in %s: %d %s", c.method, c.path, w, code, b)
			}
		}
	}

	// MCP: list and sync.
	tok := owner.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "catalogue " + rnd(), "scopes": []string{"projects:read", "projects:write"}}, 201)
	agent := newClient(t, srv.URL)
	agent.bearer = tok["plaintext"].(string)
	call := func(tool string, args map[string]any) (string, bool) {
		t.Helper()
		code, out, _ := rpc(t, agent, "tools/call", map[string]any{"name": tool, "arguments": args})
		if code != 200 || out["error"] != nil {
			t.Fatalf("%s: %d %v", tool, code, out)
		}
		res := out["result"].(map[string]any)
		isErr, _ := res["isError"].(bool)
		return res["content"].([]any)[0].(map[string]any)["text"].(string), isErr
	}
	if text, isErr := call("list_project_agents", map[string]any{"project": proj}); isErr || !strings.Contains(text, "planner") || !strings.Contains(text, "hand-skill") {
		t.Errorf("list_project_agents: %v %q", isErr, text)
	}
	if text, isErr := call("add_project_agent", map[string]any{"project": proj, "kind": "skill", "name": "from-mcp", "description": "via MCP"}); isErr {
		t.Errorf("add_project_agent: %q", text)
	}
	if text, isErr := call("sync_project_agents", map[string]any{"project": proj, "agents": []map[string]any{{"name": "qa"}}, "replace": true}); isErr ||
		strings.Contains(text, "planner") || !strings.Contains(text, "qa [sync]") || !strings.Contains(text, "from-mcp [mcp]") {
		t.Errorf("sync_project_agents: %v %q", isErr, text)
	}
	if text, isErr := call("remove_project_agent", map[string]any{"project": proj, "kind": "skill", "name": "FROM-MCP"}); isErr {
		t.Errorf("remove_project_agent: %q", text)
	}
	list := owner.must("GET", base, nil, 200)
	if got := strings.Join(names(list["skills"]), ","); got != "hand-skill:ui" {
		t.Errorf("skills after MCP remove: %s", got)
	}
}
