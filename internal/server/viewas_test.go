package server

/*
TestViewAs — MH-1159, owners/admins viewing the workspace as a member, against the real stack:

 1. the owner starts it (POST …/view-as) and it is recorded as member.viewed_as
 2. with X-View-As, /api/w/current answers the member's role and permissions, plus viewing_as
 3. a client target sees the portal, not the member list (their 403, not the owner's 200)
 4. every write is refused (403 view_as_read_only), so nothing is attributed to the member
 5. a member, a manager and an admin looking up at the owner are refused (403 view_as_denied);
    so is yourself and someone from another workspace

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run ViewAs -v
*/

import (
	"strings"
	"testing"
)

func TestViewAs(t *testing.T) {
	a, srv := bootStack(t)
	owner, ownerID, _ := signup(t, a, srv.URL, "vowner")
	adm, admID, _ := signup(t, a, srv.URL, "vadmin")
	mem, memID, memEmail := signup(t, a, srv.URL, "vmember")
	_, cliID, _ := signup(t, a, srv.URL, "vclient")
	stranger, strangerID, _ := signup(t, a, srv.URL, "vstranger")

	wsID := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "View As " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	stranger.must("POST", "/api/me/workspaces", map[string]string{"name": "Other " + rnd()}, 201)
	for id, role := range map[string]string{admID: "admin", memID: "member", cliID: "client"} {
		if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, wsID, id, role); err != nil {
			t.Fatal(err)
		}
	}
	owner.ws, adm.ws, mem.ws = wsID, wsID, wsID

	// 1. Start, recorded.
	got := owner.must("POST", "/api/w/members/"+memID+"/view-as", nil, 200)
	if got["email"] != memEmail || got["role"] != "member" {
		t.Fatalf("view-as answer: %v", got)
	}
	var n int
	if err := a.SysDB.QueryRow(`SELECT count(*) FROM activity_logs WHERE workspace_id = $1 AND action = 'member.viewed_as'
		AND actor_id = $2 AND subject_id = $3`, wsID, ownerID, memID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("member.viewed_as entries = %d (%v)", n, err)
	}

	// 2. The member's view.
	owner.extra = map[string]string{"X-View-As": memID}
	cur := owner.must("GET", "/api/w/current", nil, 200)
	va, _ := cur["viewing_as"].(map[string]any)
	if cur["role"] != "member" || va == nil || va["user_id"] != memID {
		t.Fatalf("current while viewing as the member: %v", cur)
	}
	for _, p := range cur["can"].([]any) {
		if p == "members:invite" {
			t.Fatal("viewing as a member must not carry the owner's permissions")
		}
	}

	// 3. A client sees what a client sees.
	owner.extra = map[string]string{"X-View-As": cliID}
	if code, _ := owner.do("GET", "/api/w/members", nil); code != 403 {
		t.Fatalf("viewing as a client, the member list must be refused, got %d", code)
	}
	if cur := owner.must("GET", "/api/w/current", nil, 200); cur["role"] != "client" {
		t.Fatalf("role while viewing as the client: %v", cur["role"])
	}

	// 4. Read-only.
	if code, b := owner.do("POST", "/api/w/projects", map[string]any{"name": "Nope " + rnd()}); code != 403 || !strings.Contains(string(b), "view_as_read_only") {
		t.Fatalf("a write while viewing as must be 403 view_as_read_only, got %d %s", code, b)
	}
	if code, _ := owner.do("POST", "/api/w/members/"+memID+"/view-as", nil); code != 403 {
		t.Fatalf("starting a nested view-as must be refused, got %d", code)
	}
	owner.extra = nil

	// 5. Who may not.
	mem.extra = map[string]string{"X-View-As": cliID}
	if code, b := mem.do("GET", "/api/w/current", nil); code != 403 || !strings.Contains(string(b), "view_as_denied") {
		t.Fatalf("a member viewing as someone: %d %s", code, b)
	}
	if code, _ := mem.do("POST", "/api/w/members/"+cliID+"/view-as", nil); code != 403 {
		t.Fatalf("a member starting view-as: %d", code)
	}
	adm.extra = map[string]string{"X-View-As": ownerID}
	if code, _ := adm.do("GET", "/api/w/current", nil); code != 403 {
		t.Fatalf("an admin viewing as the owner: %d", code)
	}
	adm.extra = map[string]string{"X-View-As": memID}
	if cur := adm.must("GET", "/api/w/current", nil, 200); cur["role"] != "member" {
		t.Fatalf("an admin viewing as a member: %v", cur["role"])
	}
	for _, target := range []string{ownerID, strangerID} {
		owner.extra = map[string]string{"X-View-As": target}
		if code, _ := owner.do("GET", "/api/w/current", nil); code != 403 {
			t.Fatalf("owner viewing as %s (self or outsider): %d", target, code)
		}
	}
}
