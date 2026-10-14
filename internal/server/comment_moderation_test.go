package server

/*
TestCommentModeration checks the shared-thread moderation the app stores ask for (App Store 1.2,
Play UGC): a member deletes only their own issue reply (managers: anyone's), a customer only their
own portal reply; anyone who can see a comment can report it once (a second report is a no-op),
never their own; a customer cannot report a task comment or a comment on another project's issue;
and another workspace sees none of it.
*/

import (
	"testing"
)

func TestCommentModeration(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "cm-owner")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Moderation " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	owner.ws = ws
	clID := owner.must("POST", "/api/w/clients", map[string]any{"name": "Acme " + rnd()}, 201)["id"].(string)
	prID := owner.must("POST", "/api/w/projects", map[string]any{"name": "Site " + rnd(), "client_id": clID, "visibility": "workspace"}, 201)["id"].(string)
	otherPr := owner.must("POST", "/api/w/projects", map[string]any{"name": "Internal " + rnd(), "visibility": "workspace"}, 201)["id"].(string)

	member, memberID, _ := signup(t, a, srv.URL, "cm-member")
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, memberID); err != nil {
		t.Fatal(err)
	}
	member.ws = ws
	cust, custID, _ := signup(t, a, srv.URL, "cm-client")
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'client', 'active')`, ws, custID); err != nil {
		t.Fatal(err)
	}
	owner.must("PUT", "/api/w/clients/"+clID+"/contacts/"+custID, nil, 200)
	cust.ws = ws

	reports := func(id string) int {
		var n int
		if err := a.SysDB.QueryRow(`SELECT count(*) FROM activity_logs WHERE workspace_id = $1 AND action = 'comment.reported' AND subject_id = $2`, ws, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// ---- task comments: report (staff only) ----------------------------------------------------
	task := owner.must("POST", "/api/w/projects/"+prID+"/tasks", map[string]any{"title": "Copy"}, 201)["key"].(string)
	tc := member.must("POST", "/api/w/tasks/"+task+"/comments", map[string]any{"body": "a task comment"}, 201)["id"].(string)
	if got := owner.must("POST", "/api/w/comments/"+tc+"/report", map[string]any{"reason": "spam"}, 200); got["reported"] != true {
		t.Errorf("report: %v", got)
	}
	owner.must("POST", "/api/w/comments/"+tc+"/report", nil, 200) // again: a no-op
	if n := reports(tc); n != 1 {
		t.Errorf("a repeated report should be stored once, got %d", n)
	}
	if code, b := member.do("POST", "/api/w/comments/"+tc+"/report", nil); code != 422 {
		t.Errorf("reporting your own comment: %d %s", code, b)
	}
	if code, _ := cust.do("POST", "/api/w/comments/"+tc+"/report", nil); code != 404 {
		t.Errorf("a customer reported a task comment it cannot see: %d", code)
	}

	// ---- issue comments: delete own / moderate, report ------------------------------------------
	issue := owner.must("POST", "/api/w/issues", map[string]any{"title": "Header broken", "project": prID}, 201)["key"].(string)
	foreign := owner.must("POST", "/api/w/issues", map[string]any{"title": "Internal", "project": otherPr}, 201)["key"].(string)
	mc := member.must("POST", "/api/w/issues/"+issue+"/comments", map[string]any{"body": "member reply"}, 201)["id"].(string)
	mc2 := member.must("POST", "/api/w/issues/"+issue+"/comments", map[string]any{"body": "member reply 2"}, 201)["id"].(string)
	cc := cust.must("POST", "/api/w/portal/issues/"+issue+"/comments", map[string]any{"body": "customer reply"}, 201)["id"].(string)
	cc2 := cust.must("POST", "/api/w/portal/issues/"+issue+"/comments", map[string]any{"body": "customer reply 2"}, 201)["id"].(string)
	fc := owner.must("POST", "/api/w/issues/"+foreign+"/comments", map[string]any{"body": "internal reply"}, 201)["id"].(string)

	cust.must("POST", "/api/w/comments/"+mc+"/report", map[string]any{"reason": "rude"}, 200)
	if n := reports(mc); n != 1 {
		t.Errorf("customer report not stored: %d", n)
	}
	if code, _ := cust.do("POST", "/api/w/comments/"+fc+"/report", nil); code != 404 {
		t.Errorf("a customer reported a comment on another project's issue: %d", code)
	}
	member.must("POST", "/api/w/comments/"+cc+"/report", nil, 200)

	if code, _ := cust.do("DELETE", "/api/w/portal/issues/"+issue+"/comments/"+mc, nil); code != 403 {
		t.Errorf("a customer deleted a staff reply: %d", code)
	}
	if code, _ := member.do("DELETE", "/api/w/issues/"+issue+"/comments/"+cc, nil); code != 403 {
		t.Errorf("a member deleted someone else's reply: %d", code)
	}
	if code, _ := member.do("DELETE", "/api/w/issues/"+foreign+"/comments/"+mc2, nil); code != 404 {
		t.Errorf("a reply deleted through another issue: %d", code)
	}
	for _, step := range []struct {
		who  *client
		path string
	}{
		{owner, "/api/w/issues/" + issue + "/comments/" + cc},         // managers moderate
		{member, "/api/w/issues/" + issue + "/comments/" + mc2},       // own
		{cust, "/api/w/portal/issues/" + issue + "/comments/" + cc2}, // own, from the portal
	} {
		if code, b := step.who.do("DELETE", step.path, nil); code != 204 {
			t.Errorf("DELETE %s: %d %s", step.path, code, b)
		}
	}
	left := owner.must("GET", "/api/w/issues/"+issue, nil, 200)["comments"].([]any)
	if len(left) != 1 || left[0].(map[string]any)["id"] != mc {
		t.Errorf("after deletes only %s should remain, got %v", mc, left)
	}

	// ---- another workspace sees none of it ---------------------------------------------------
	stranger, _, _ := signup(t, a, srv.URL, "cm-stranger")
	stranger.ws = stranger.must("POST", "/api/me/workspaces", map[string]string{"name": "Elsewhere " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if code, _ := stranger.do("POST", "/api/w/comments/"+mc+"/report", nil); code != 404 {
		t.Errorf("another workspace reported a comment: %d", code)
	}
	if code, _ := stranger.do("DELETE", "/api/w/issues/"+issue+"/comments/"+mc, nil); code != 404 {
		t.Errorf("another workspace deleted a comment: %d", code)
	}
}
