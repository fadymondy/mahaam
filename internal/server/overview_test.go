package server

import "testing"

// TestHomeOverview: GET /api/w/overview counts completed and overdue tasks, lists what needs
// attention (overdue first, then urgent/high), and never leaks a project the caller cannot see.
func TestHomeOverview(t *testing.T) {
	a, srv := bootStack(t)
	alice, _, _ := signup(t, a, srv.URL, "alice")
	mia, miaID, _ := signup(t, a, srv.URL, "mia")
	wsID := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Home " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, wsID, miaID); err != nil {
		t.Fatal(err)
	}
	alice.ws, mia.ws = wsID, wsID

	open := alice.must("POST", "/api/w/projects", map[string]any{"name": "Open " + rnd()}, 201)["id"].(string)
	secret := alice.must("POST", "/api/w/projects", map[string]any{"name": "Secret " + rnd(), "visibility": "members"}, 201)["id"].(string)
	mk := func(project string, body map[string]any) string {
		return alice.must("POST", "/api/w/projects/"+project+"/tasks", body, 201)["key"].(string)
	}
	overdue := mk(open, map[string]any{"title": "Late", "due_at": "2020-01-01"})
	urgent := mk(open, map[string]any{"title": "Fire", "priority": "urgent"})
	mk(open, map[string]any{"title": "Calm"})
	done := mk(open, map[string]any{"title": "Finished"})
	alice.must("PATCH", "/api/w/tasks/"+done, map[string]any{"status": "Done"}, 200)
	mk(secret, map[string]any{"title": "Hidden late", "due_at": "2020-01-01"})

	ov := alice.must("GET", "/api/w/overview", nil, 200)
	if ov["completed_total"].(float64) != 1 || ov["completed_week"].(float64) != 1 {
		t.Errorf("completed: %v", ov)
	}
	if ov["overdue"].(float64) != 2 {
		t.Errorf("the owner sees both overdue tasks, got %v", ov["overdue"])
	}
	att := ov["attention"].([]any)
	if len(att) != 3 || att[2].(map[string]any)["key"] != urgent {
		t.Errorf("attention must be 2 overdue then the urgent task: %v", att)
	}
	if first := att[0].(map[string]any); first["overdue"] != true || first["project_name"] == "" {
		t.Errorf("first attention item: %v", first)
	}

	// Mia is a plain member of neither project: the members-only project stays hidden; the
	// workspace-visible one is shown.
	mv := mia.must("GET", "/api/w/overview", nil, 200)
	if mv["overdue"].(float64) != 1 {
		t.Errorf("a member must not count tasks in a project they cannot see: %v", mv["overdue"])
	}
	for _, x := range mv["attention"].([]any) {
		if x.(map[string]any)["project_id"] == secret {
			t.Errorf("leaked a hidden project's task: %v", x)
		}
	}
	_ = overdue
}
