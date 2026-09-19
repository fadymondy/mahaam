package server

/*
TestVault checks the project vault end to end: a member writes and recalls memory but
cannot store or reveal a secret; a manager stores one (sealed at rest — the column never
holds the plaintext), lists never carry the value, a reveal returns it and is recorded in
the activity feed; another workspace cannot see the item; and the MCP tools behave the same.
*/

import (
	"strings"
	"testing"
)

func TestVault(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "vowner")
	mem, memID, _ := signup(t, a, srv.URL, "vmember")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Vault " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, memID); err != nil {
		t.Fatal(err)
	}
	owner.ws, mem.ws = ws, ws
	proj := "Vault site " + rnd()
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": proj, "visibility": "workspace"}, 201)["id"].(string)
	base := "/api/w/projects/" + pid + "/vault"

	// Memory: a member writes and recalls it.
	note := mem.must("POST", base, map[string]any{"kind": "memory", "title": "Deploy steps", "body": "Run make deploy from the bastion host.", "tags": []string{"Deploy"}}, 201)
	if note["tags"].([]any)[0] != "deploy" {
		t.Errorf("tags are normalised: %v", note["tags"])
	}
	got := mem.must("GET", base+"/recall?q=bastion", nil, 200)["items"].([]any)
	if len(got) != 1 {
		t.Fatalf("recall bastion: %v", got)
	}

	// Secrets: a member cannot store one.
	if code, _ := mem.do("POST", base, map[string]any{"kind": "secret", "title": "DB", "value": "hunter2"}); code != 403 {
		t.Errorf("member stored a secret: %d", code)
	}
	sec := owner.must("POST", base, map[string]any{"kind": "secret", "title": "Production DB", "value": "s3cr3t-pa55", "body": "user: app"}, 201)
	sid := sec["id"].(string)
	var sealed string
	_ = a.SysDB.QueryRow(`SELECT sealed_value FROM project_vault_items WHERE id = $1`, sid).Scan(&sealed)
	if sealed == "" || strings.Contains(sealed, "s3cr3t") {
		t.Errorf("the secret must be sealed at rest: %q", sealed)
	}
	for _, c := range []*client{owner, mem} {
		_, b := c.do("GET", base, nil)
		if strings.Contains(string(b), "s3cr3t") {
			t.Errorf("a list leaked the secret value: %s", b)
		}
	}
	if code, _ := mem.do("POST", "/api/w/vault/"+sid+"/reveal", nil); code != 403 {
		t.Errorf("member revealed a secret: %d", code)
	}
	out := owner.must("POST", "/api/w/vault/"+sid+"/reveal", nil, 200)
	if out["value"] != "s3cr3t-pa55" {
		t.Errorf("reveal: %v", out["value"])
	}
	var n int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM activity_logs WHERE workspace_id = $1 AND action = 'vault.secret_revealed' AND subject_id = $2`, ws, sid).Scan(&n)
	if n != 1 {
		t.Errorf("the reveal must be recorded once, got %d", n)
	}

	// Another workspace cannot see the item.
	other, _, _ := signup(t, a, srv.URL, "voutsider")
	other.ws = other.must("POST", "/api/me/workspaces", map[string]string{"name": "Other " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	for _, path := range []string{"/api/w/vault/" + sid, base} {
		if code, _ := other.do("GET", path, nil); code != 404 {
			t.Errorf("other workspace GET %s: %d", path, code)
		}
	}

	// MCP: recall + remember with vault:read/write; reveal needs vault:secrets.
	tok := owner.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "vault " + rnd(), "scopes": []string{"vault:read", "vault:write"}}, 201)
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
	if text, isErr := call("vault_recall", map[string]any{"project": proj, "query": "deploy"}); isErr || !strings.Contains(text, "bastion") {
		t.Errorf("vault_recall: %v %q", isErr, text)
	}
	if text, isErr := call("vault_remember", map[string]any{"project": proj, "title": "Staging URL", "body": "https://staging.example.com"}); isErr {
		t.Errorf("vault_remember: %q", text)
	}
	if text, isErr := call("vault_list", map[string]any{"project": proj}); isErr || strings.Contains(text, "s3cr3t") || !strings.Contains(text, "Production DB") {
		t.Errorf("vault_list: %v %q", isErr, text)
	}
	if text, isErr := call("vault_reveal_secret", map[string]any{"id": sid}); !isErr || !strings.Contains(text, "vault:secrets") {
		t.Errorf("reveal without vault:secrets must be refused: %v %q", isErr, text)
	}
}
