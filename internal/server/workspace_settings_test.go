package server

/*
TestWorkspaceSettings: owners and admins rename a workspace and change its slug; a member cannot;
a taken, reserved or malformed slug is refused (409/422); a successful change is in the activity
feed and shows up in /api/me/workspaces.
*/

import "testing"

func TestWorkspaceSettings(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "setowner")
	mem, memID, _ := signup(t, a, srv.URL, "setmember")
	other, _, _ := signup(t, a, srv.URL, "setother")
	w := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Settings " + rnd()}, 201)["workspace"].(map[string]any)
	ws := w["id"].(string)
	taken := other.must("POST", "/api/me/workspaces", map[string]string{"name": "Taken " + rnd()}, 201)["workspace"].(map[string]any)["slug"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, memID); err != nil {
		t.Fatal(err)
	}
	owner.ws, mem.ws = ws, ws

	if code, _ := mem.do("PATCH", "/api/w/workspace", map[string]any{"name": "Hacked"}); code != 403 {
		t.Errorf("a member renamed the workspace: %d", code)
	}
	if code, _ := mem.do("DELETE", "/api/w/workspace/logo", nil); code != 403 {
		t.Errorf("a member removed the logo: %d", code)
	}
	if code, _ := owner.do("PATCH", "/api/w/workspace", map[string]any{"slug": taken}); code != 409 {
		t.Errorf("a taken slug must be 409: %d", code)
	}
	for _, bad := range []string{"Ab", "api", "-nope-", "has space"} {
		if code, _ := owner.do("PATCH", "/api/w/workspace", map[string]any{"slug": bad}); code != 422 {
			t.Errorf("slug %q must be 422: %d", bad, code)
		}
	}
	if code, _ := owner.do("PATCH", "/api/w/workspace", map[string]any{"name": "   "}); code != 422 {
		t.Errorf("a blank name must be 422: %d", code)
	}
	newSlug := "renamed-" + rnd()
	got := owner.must("PATCH", "/api/w/workspace", map[string]any{"name": "  New name  ", "slug": newSlug}, 200)
	if got["name"] != "New name" || got["slug"] != newSlug {
		t.Errorf("unexpected result: %v", got)
	}
	var n int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM activity_logs WHERE workspace_id = $1 AND action = 'workspace.updated'`, ws).Scan(&n)
	if n != 1 {
		t.Errorf("activity rows: %d", n)
	}
	list := owner.must("GET", "/api/me/workspaces", nil, 200)["workspaces"].([]any)
	found := false
	for _, x := range list {
		if m := x.(map[string]any); m["id"] == ws && m["slug"] == newSlug && m["name"] == "New name" {
			found = true
		}
	}
	if !found {
		t.Errorf("/api/me/workspaces does not show the change: %v", list)
	}
	if code, _ := owner.do("DELETE", "/api/w/workspace/logo", nil); code != 200 {
		t.Errorf("owner logo delete: %d", code)
	}
}
