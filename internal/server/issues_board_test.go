package server

/*
TestIssuesOnBoard — issues and the board are one system (post/19g_issues_on_board.sql): an issue
filed into a project is a card on that project's board with the same key; moving the card moves
the issue, changing the issue moves the card; a title edit on either side shows on the other; an
issue with no project lands in the workspace's Inbox project; deleting the card deletes the issue.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run IssuesOnBoard -v
*/

import "testing"

func TestIssuesOnBoard(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "iboard")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Board " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	owner.ws = ws
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": "Site " + rnd()}, 201)["id"].(string)

	key := owner.must("POST", "/api/w/issues", map[string]any{"title": "Checkout button broken", "project": pid, "issue_type": "bug", "priority": "highest"}, 201)["key"].(string)

	card := func(k string) map[string]any {
		t.Helper()
		board := owner.must("GET", "/api/w/projects/"+pid+"/board", nil, 200)
		for _, x := range board["tasks"].([]any) {
			if m := x.(map[string]any); m["key"] == k {
				return m
			}
		}
		return nil
	}
	c := card(key)
	if c == nil {
		t.Fatalf("issue %s is not on its project's board", key)
	}
	if c["title"] != "Checkout button broken" || c["priority"] != "urgent" {
		t.Errorf("card = %v", c)
	}
	if iss, _ := c["issue"].(map[string]any); iss == nil || iss["type"] != "bug" {
		t.Errorf("card lacks its issue facts: %v", c["issue"])
	}

	// Card → issue.
	owner.must("POST", "/api/w/tasks/"+key+"/move", map[string]any{"status": "Done"}, 200)
	if got := owner.must("GET", "/api/w/issues/"+key, nil, 200); got["status"] != "done" || got["state"] != "closed" {
		t.Errorf("moving the card to Done left the issue %v / %v", got["status"], got["state"])
	}
	owner.must("PATCH", "/api/w/tasks/"+key, map[string]any{"title": "Checkout button fixed?"}, 200)
	if got := owner.must("GET", "/api/w/issues/"+key, nil, 200); got["title"] != "Checkout button fixed?" {
		t.Errorf("card title did not reach the issue: %v", got["title"])
	}

	// Issue → card.
	owner.must("PATCH", "/api/w/issues/"+key, map[string]any{"status": "in_progress", "title": "Checkout, take two"}, 200)
	c = card(key)
	var cat string
	board := owner.must("GET", "/api/w/projects/"+pid+"/board", nil, 200)
	for _, s := range board["statuses"].([]any) {
		if m := s.(map[string]any); m["id"] == c["status_id"] {
			cat, _ = m["category"].(string)
		}
	}
	if cat != "doing" || c["title"] != "Checkout, take two" || c["completed_at"] != nil {
		t.Errorf("issue change did not move the card: category %q, card %v", cat, c)
	}

	// No project → the Inbox project.
	loose := owner.must("POST", "/api/w/issues", map[string]any{"title": "Somewhere"}, 201)
	if loose["project_id"] == nil {
		t.Errorf("an issue without a project should land in the Inbox: %v", loose)
	}
	var inbox bool
	_ = a.SysDB.QueryRow(`SELECT p.is_inbox FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.workspace_id = $1 AND t.key = $2`,
		ws, loose["key"]).Scan(&inbox)
	if !inbox {
		t.Errorf("%v has no card in the Inbox project", loose["key"])
	}

	// Deleting the card deletes the issue.
	owner.must("DELETE", "/api/w/tasks/"+key, nil, 204)
	if code, _ := owner.do("GET", "/api/w/issues/"+key, nil); code != 404 {
		t.Errorf("issue survived its card: %d", code)
	}
}
