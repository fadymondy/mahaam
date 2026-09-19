package server

/*
TestAccess drives label → project → task access for an employee (member) on a
members-only project: nothing without a grant; a LABEL grant to a TEAM shows the whole
project to everyone in the team (and to someone added to the team later); revoking it
hides it again; a TASK grant shows the project but only that task (and the ones assigned),
and does not allow adding tasks; managers see everything regardless.
*/

import (
	"testing"
)

func TestAccess(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "aowner")
	emp, empID, _ := signup(t, a, srv.URL, "aemp")
	late, lateID, _ := signup(t, a, srv.URL, "alate")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Access " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	for _, id := range []string{empID, lateID} {
		if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, id); err != nil {
			t.Fatal(err)
		}
	}
	owner.ws, emp.ws, late.ws = ws, ws, ws

	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": "Secret client " + rnd(), "visibility": "members"}, 201)["id"].(string)
	t1 := owner.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "Task one"}, 201)
	owner.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "Task two"}, 201)
	lbl := owner.must("POST", "/api/w/labels", map[string]any{"name": "Client X " + rnd()}, 201)
	team := owner.must("POST", "/api/w/teams", map[string]any{"name": "Squad " + rnd()}, 201)
	teamID := team["id"].(string)
	owner.must("PATCH", "/api/w/teams/"+teamID, map[string]any{"member_ids": []string{empID}}, 200)

	sees := func(c *client) int { code, _ := c.do("GET", "/api/w/projects/"+pid, nil); return code }
	boardTasks := func(c *client) int {
		code, b := c.do("GET", "/api/w/projects/"+pid+"/board", nil)
		if code != 200 {
			return -1
		}
		return countOf(b, `"key":"`)
	}

	if code := sees(emp); code != 404 {
		t.Fatalf("no grant: employee must not see a members-only project, got %d", code)
	}

	// Label grant to the team + the project carries the label.
	owner.must("PUT", "/api/w/projects/"+pid+"/project-labels", map[string]any{"labels": []string{lbl["name"].(string)}}, 200)
	g := owner.must("POST", "/api/w/access-grants", map[string]any{"subject_type": "team", "subject": teamID, "scope_type": "label", "scope": lbl["id"]}, 201)
	if code := sees(emp); code != 200 {
		t.Errorf("label grant via team: got %d", code)
	}
	if n := boardTasks(emp); n != 2 {
		t.Errorf("label grant shows the whole board: %d tasks", n)
	}
	if code := sees(late); code != 404 {
		t.Errorf("not in the team yet: %d", code)
	}
	owner.must("PATCH", "/api/w/teams/"+teamID, map[string]any{"member_ids": []string{empID, lateID}}, 200)
	if code := sees(late); code != 200 {
		t.Errorf("added to the team later must follow the grant: %d", code)
	}
	// Only managers manage grants.
	if code, _ := emp.do("POST", "/api/w/access-grants", map[string]any{"subject_type": "user", "subject": empID, "scope_type": "label", "scope": lbl["id"]}); code != 403 {
		t.Errorf("employee created a grant: %d", code)
	}
	owner.must("DELETE", "/api/w/access-grants/"+g["id"].(string), nil, 204)
	if code := sees(emp); code != 404 {
		t.Errorf("revoked: got %d", code)
	}

	// Task grant: the project shows, with only that task, and no new tasks.
	owner.must("POST", "/api/w/access-grants", map[string]any{"subject_type": "user", "subject": empID, "scope_type": "task", "scope": t1["key"]}, 201)
	if code := sees(emp); code != 200 {
		t.Errorf("task grant shows the project: %d", code)
	}
	if n := boardTasks(emp); n != 1 {
		t.Errorf("task grant shows only the granted task: %d", n)
	}
	if code, _ := emp.do("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "sneaky"}); code != 403 {
		t.Errorf("task-only access must not add tasks: %d", code)
	}
	if code, _ := emp.do("GET", "/api/w/tasks/"+t1["key"].(string), nil); code != 200 {
		t.Errorf("the granted task opens: %d", code)
	}
	// The manager sees both tasks throughout.
	if n := boardTasks(owner); n != 2 {
		t.Errorf("owner board: %d", n)
	}
	// A customer added to a client's project sees it (and becomes that client's portal
	// contact), but never its tasks.
	cust, custID, _ := signup(t, a, srv.URL, "acust")
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'client', 'active')`, ws, custID); err != nil {
		t.Fatal(err)
	}
	cust.ws = ws
	clID := owner.must("POST", "/api/w/clients", map[string]any{"name": "Cust " + rnd()}, 201)["id"].(string)
	owner.must("PATCH", "/api/w/projects/"+pid, map[string]any{"client_id": clID}, 200)
	if code := sees(cust); code != 404 {
		t.Errorf("customer before access: %d", code)
	}
	owner.must("PUT", "/api/w/projects/"+pid+"/members/"+custID, map[string]any{"role": "member"}, 200)
	if code := sees(cust); code != 200 {
		t.Errorf("customer added to the project must see it: %d", code)
	}
	if code, _ := cust.do("GET", "/api/w/projects/"+pid+"/board", nil); code != 403 && code != 404 {
		t.Errorf("a customer must not read the board: %d", code)
	}
	var linked int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM client_contacts WHERE workspace_id = $1 AND user_id = $2 AND client_id = $3`, ws, custID, clID).Scan(&linked)
	if linked != 1 {
		t.Errorf("adding a customer to the client's project must link them as its portal contact")
	}

	// Deleting the task removes its grants (trigger).
	owner.must("DELETE", "/api/w/tasks/"+t1["key"].(string), nil, 204)
	var left int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM access_grants WHERE workspace_id = $1 AND scope_type = 'task'`, ws).Scan(&left)
	if left != 0 {
		t.Errorf("task grants must go with the task: %d left", left)
	}
}

func countOf(b []byte, sub string) int {
	n := 0
	for i := 0; i+len(sub) <= len(b); i++ {
		if string(b[i:i+len(sub)]) == sub {
			n++
		}
	}
	return n
}
