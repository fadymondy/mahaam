package server

/*
TestCustomerPortal checks roadmap 5 end to end on the real stack: the customer panel shows a
client only their projects' aggregates (never task rows, rates or the money budget); the client
still cannot read tasks; they can accept / reopen / re-prioritise and comment on the issues of
their own project but not another project's; the request lifecycle (pending hidden from the board
→ accepted shows on it → declined carries a reason the customer reads → converted makes a task);
notifications reach managers and the requester; the MCP tools follow the same rules; and another
workspace sees none of it.
*/

import (
	"strings"
	"testing"
	"time"
)

func TestCustomerPortal(t *testing.T) {
	a, srv := bootStack(t)
	owner, ownerID, _ := signup(t, a, srv.URL, "cp-owner")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Portal " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	owner.ws = ws
	clID := owner.must("POST", "/api/w/clients", map[string]any{"name": "Acme " + rnd()}, 201)["id"].(string)
	prID := owner.must("POST", "/api/w/projects", map[string]any{"name": "Site " + rnd(), "client_id": clID, "visibility": "members",
		"budget_minutes": 600, "budget_minor": 999900}, 201)["id"].(string)
	otherPr := owner.must("POST", "/api/w/projects", map[string]any{"name": "Internal " + rnd(), "visibility": "workspace"}, 201)["id"].(string)
	secretTask := "SECRET-TASK-" + rnd()
	owner.must("POST", "/api/w/projects/"+prID+"/tasks", map[string]any{"title": secretTask}, 201)
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	owner.must("POST", "/api/w/time/entries", map[string]any{"project": prID, "description": "work", "date": yesterday, "minutes": 90}, 201)

	cust, custID, _ := signup(t, a, srv.URL, "cp-client")
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'client', 'active')`, ws, custID); err != nil {
		t.Fatal(err)
	}
	owner.must("PUT", "/api/w/clients/"+clID+"/contacts/"+custID, nil, 200)
	cust.ws = ws

	// ---- customer panel: only their project, aggregates only -------------------------------
	list := cust.must("GET", "/api/w/portal/projects", nil, 200)["projects"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["id"] != prID {
		t.Fatalf("client should see exactly their project, got %v", list)
	}
	if code, _ := cust.do("GET", "/api/w/portal/projects/"+otherPr, nil); code != 404 {
		t.Errorf("client read another project's panel: %d", code)
	}
	code, raw := cust.do("GET", "/api/w/portal/projects/"+prID, nil)
	if code != 200 {
		t.Fatalf("panel: %d %s", code, raw)
	}
	for _, leak := range []string{secretTask, "999900", "budget_minor", "bill_rate", "cost_rate"} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("customer panel leaks %q: %s", leak, raw)
		}
	}
	panel := cust.must("GET", "/api/w/portal/projects/"+prID, nil, 200)
	if num(panel["used_minutes"]) != 90 || num(panel["budget_minutes"]) != 600 {
		t.Errorf("hours: used %v budget %v, want 90/600", panel["used_minutes"], panel["budget_minutes"])
	}
	if tk := panel["tasks"].(map[string]any); num(tk["todo"])+num(tk["doing"])+num(tk["done"]) != 1 {
		t.Errorf("task counts: %v", tk)
	}
	weeks, sum := panel["weeks"].([]any), 0.0
	for _, w := range weeks {
		sum += num(w.(map[string]any)["minutes"])
	}
	if len(weeks) != 12 || sum != 90 {
		t.Errorf("weeks: %d weeks, %v minutes; want 12 and 90", len(weeks), sum)
	}
	if panel["invoices_visible"] != true {
		t.Errorf("the client's own contact should see the client's invoices section")
	}
	// Still no tasks for a client.
	for _, p := range []string{"/api/w/tasks", "/api/w/projects/" + prID + "/board", "/api/w/projects/" + prID + "/tasks"} {
		if code, _ := cust.do("GET", p, nil); code == 200 {
			t.Errorf("client read tasks at %s", p)
		}
	}

	// ---- issue control ---------------------------------------------------------------------
	issue := owner.must("POST", "/api/w/issues", map[string]any{"title": "Header broken", "project": prID, "status": "in_review"}, 201)["key"].(string)
	foreign := owner.must("POST", "/api/w/issues", map[string]any{"title": "Internal thing", "project": otherPr, "status": "in_review"}, 201)["key"].(string)
	// The customer sees all their project's issues (not only their own).
	if !strings.Contains(mustString(t, cust, "GET", "/api/w/portal/projects/"+prID), issue) {
		t.Errorf("panel should list the project's issue %s", issue)
	}
	if code, _ := cust.do("PATCH", "/api/w/portal/issues/"+foreign, map[string]any{"status": "done"}); code != 404 {
		t.Errorf("client accepted another project's issue: %d", code)
	}
	if code, _ := cust.do("GET", "/api/w/portal/issues/"+foreign, nil); code != 404 {
		t.Errorf("client read another project's issue: %d", code)
	}
	if code, _ := cust.do("PATCH", "/api/w/issues/"+issue, map[string]any{"status": "done"}); code/100 == 2 {
		t.Errorf("the general issue PATCH must stay closed to clients: %d", code)
	}
	if code, _ := cust.do("PATCH", "/api/w/portal/issues/"+issue, map[string]any{"status": "in_progress"}); code != 422 {
		t.Errorf("client moved an issue to in_progress: %d", code)
	}
	got := cust.must("PATCH", "/api/w/portal/issues/"+issue, map[string]any{"status": "done", "priority": "high"}, 200)
	if got["status"] != "done" || got["state"] != "closed" || got["priority"] != "high" {
		t.Errorf("accept: %v", got)
	}
	got = cust.must("PATCH", "/api/w/portal/issues/"+issue, map[string]any{"status": "todo"}, 200)
	if got["status"] != "todo" || got["state"] != "open" {
		t.Errorf("reopen: %v", got)
	}
	if code, _ := cust.do("PATCH", "/api/w/portal/issues/"+issue, map[string]any{"status": "done"}); code != 422 {
		t.Errorf("accepting from todo must be refused: %d", code)
	}
	cust.must("POST", "/api/w/portal/issues/"+issue+"/comments", map[string]any{"body": "Thanks!"}, 201)
	if code, _ := cust.do("POST", "/api/w/portal/issues/"+foreign+"/comments", map[string]any{"body": "x"}); code != 404 {
		t.Errorf("client commented on another project's issue: %d", code)
	}

	// ---- requests --------------------------------------------------------------------------
	req := cust.must("POST", "/api/w/portal/requests", map[string]any{"project_id": prID, "title": "Dark mode please", "kind": "feature",
		"body": "Our users want it", "desired_on": "2030-01-31"}, 201)
	rk := req["key"].(string)
	if req["state"] != "pending" || req["desired_on"] != "2030-01-31" {
		t.Errorf("new request: %v", req)
	}
	if code, _ := cust.do("POST", "/api/w/portal/requests", map[string]any{"project_id": otherPr, "title": "x"}); code != 404 {
		t.Errorf("client filed a request into another project: %d", code)
	}
	onBoard := func(key string) bool {
		return strings.Contains(mustString(t, owner, "GET", "/api/w/issues"), `"key":"`+key+`"`)
	}
	if onBoard(rk) {
		t.Errorf("a pending request must not be on the board")
	}
	if !strings.Contains(mustString(t, owner, "GET", "/api/w/requests"), rk) {
		t.Errorf("the pending request should be in the inbox")
	}
	if code, _ := cust.do("GET", "/api/w/requests", nil); code != 403 {
		t.Errorf("client read the staff inbox: %d", code)
	}
	if code, _ := cust.do("POST", "/api/w/requests/"+rk+"/accept", map[string]any{}); code != 403 {
		t.Errorf("client accepted their own request: %d", code)
	}
	var notes int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND kind = 'request.created'`, ws, ownerID).Scan(&notes)
	if notes != 1 {
		t.Errorf("managers should be told about a new request: %d notifications", notes)
	}
	acc := owner.must("POST", "/api/w/requests/"+rk+"/accept", map[string]any{"priority": "high"}, 200)
	if acc["state"] != "accepted" || acc["status"] != "todo" {
		t.Errorf("accept: %v", acc)
	}
	if !onBoard(rk) {
		t.Errorf("an accepted request must be on the board")
	}
	if code, _ := owner.do("POST", "/api/w/requests/"+rk+"/decline", map[string]any{"reason": "x"}); code != 409 {
		t.Errorf("triaging twice: %d", code)
	}

	rk2 := cust.must("POST", "/api/w/portal/requests", map[string]any{"project_id": prID, "title": "Rewrite in COBOL", "kind": "change"}, 201)["key"].(string)
	if code, _ := owner.do("POST", "/api/w/requests/"+rk2+"/decline", map[string]any{"reason": ""}); code != 422 {
		t.Errorf("decline without a reason: %d", code)
	}
	owner.must("POST", "/api/w/requests/"+rk2+"/decline", map[string]any{"reason": "Out of scope for this contract"}, 200)
	if onBoard(rk2) {
		t.Errorf("a declined request must not be on the board")
	}
	mine := cust.must("GET", "/api/w/portal/requests?project="+prID, nil, 200)["requests"].([]any)
	states := map[string]map[string]any{}
	for _, r := range mine {
		states[r.(map[string]any)["key"].(string)] = r.(map[string]any)
	}
	if states[rk]["state"] != "accepted" || states[rk2]["state"] != "declined" || states[rk2]["reply"] != "Out of scope for this contract" {
		t.Errorf("customer's requests: %v", mine)
	}
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND kind IN ('request.accepted', 'request.declined')`, ws, custID).Scan(&notes)
	if notes != 2 {
		t.Errorf("the requester should be told of accept + decline: %d", notes)
	}

	rk3 := cust.must("POST", "/api/w/portal/requests", map[string]any{"project_id": prID, "title": "Export to PDF", "kind": "feature"}, 201)["key"].(string)
	conv := owner.must("POST", "/api/w/requests/"+rk3+"/convert-to-task", map[string]any{}, 200)
	taskKey, _ := conv["task_key"].(string)
	if taskKey == "" || conv["request"].(map[string]any)["state"] != "converted" {
		t.Fatalf("convert: %v", conv)
	}
	owner.must("GET", "/api/w/tasks/"+taskKey, nil, 200)
	if onBoard(rk3) {
		t.Errorf("a converted request must not be on the board")
	}

	// ---- regression: every request opens after an action (owner feedback) -------------------
	// The inbox listed pending only and had no detail: once triaged, a request could not be
	// opened again. GET /api/w/requests/{key} answers in every state, with history and links.
	for key, want := range map[string]string{rk: "accepted", rk2: "declined", rk3: "converted"} {
		d := owner.must("GET", "/api/w/requests/"+key, nil, 200)
		if d["state"] != want || len(d["history"].([]any)) != 2 {
			t.Errorf("request %s detail after %s: %v", key, want, d)
		}
		iss := owner.must("GET", "/api/w/issues/"+key, nil, 200)
		if iss["request_state"] != want {
			t.Errorf("issue page of request %s: request_state %v, want %s", key, iss["request_state"], want)
		}
	}
	if d := owner.must("GET", "/api/w/requests/"+rk3, nil, 200); d["task_key"] != taskKey || d["task_project_id"] != prID {
		t.Errorf("converted request should link its task %s: %v", taskKey, d)
	}
	inbox := owner.must("GET", "/api/w/requests?state=all", nil, 200)
	if c := inbox["counts"].(map[string]any); num(c["accepted"]) != 1 || num(c["declined"]) != 1 || num(c["converted"]) != 1 {
		t.Errorf("inbox counts: %v", c)
	}
	if code, _ := cust.do("GET", "/api/w/requests/"+rk, nil); code != 403 {
		t.Errorf("client read the staff request detail: %d", code)
	}
	// Undo: a declined request is reopened, then converted to an issue after all.
	if code, _ := owner.do("POST", "/api/w/requests/"+rk2+"/reopen", map[string]any{"note": "we can do it"}); code != 200 {
		t.Fatalf("reopen: %d", code)
	}
	if code, _ := owner.do("POST", "/api/w/requests/"+rk2+"/reopen", map[string]any{}); code != 409 {
		t.Errorf("reopening a pending request: %d, want 409", code)
	}
	if code, _ := cust.do("POST", "/api/w/requests/"+rk2+"/reopen", map[string]any{}); code != 403 {
		t.Errorf("client reopened a request: %d", code)
	}
	owner.must("POST", "/api/w/requests/"+rk2+"/accept", map[string]any{"status": "backlog", "priority": "low", "issue_type": "bug"}, 200)
	d2 := owner.must("GET", "/api/w/requests/"+rk2, nil, 200)
	if d2["state"] != "accepted" || d2["issue_state"] != "open" || d2["issue_type"] != "bug" || len(d2["history"].([]any)) != 4 {
		t.Errorf("reopen → accept: %v", d2)
	}
	if !onBoard(rk2) {
		t.Errorf("a request accepted after a reopen must be on the board")
	}
	if !strings.Contains(mustString(t, cust, "GET", "/api/w/portal/projects/"+prID), rk2) {
		t.Errorf("the customer should see the accepted request %s among the project's issues", rk2)
	}

	// ---- full project view: board, task, time, activity, share settings --------------------
	secretComment := "INTERNAL-NOTE-" + rnd()
	tk := owner.must("POST", "/api/w/projects/"+prID+"/tasks", map[string]any{"title": "Public task", "description": "What we build"}, 201)
	tkKey := tk["key"].(string)
	owner.must("POST", "/api/w/tasks/"+tkKey+"/checklist", map[string]any{"title": "Step one"}, 201)
	owner.must("POST", "/api/w/tasks/"+tkKey+"/comments", map[string]any{"body": secretComment}, 201)
	page := cust.must("GET", "/api/w/portal/projects/"+prID, nil, 200)
	if sh := page["share"].(map[string]any); sh["board"] != true || sh["team"] != true || sh["money"] != false {
		t.Errorf("default share settings: %v", sh)
	}
	if len(page["team"].([]any)) == 0 || len(page["columns"].([]any)) == 0 {
		t.Errorf("team and columns should be shared by default: %v / %v", page["team"], page["columns"])
	}
	code, raw = cust.do("GET", "/api/w/portal/projects/"+prID+"/tasks", nil)
	if code != 200 || !strings.Contains(string(raw), tkKey) {
		t.Fatalf("customer board: %d %s", code, raw)
	}
	for _, leak := range []string{secretComment, "cost_rate", "bill_rate", "estimate_minutes", "assignee_ids", "comment_count", ownerID} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("customer board leaks %q", leak)
		}
	}
	code, raw = cust.do("GET", "/api/w/portal/projects/"+prID+"/tasks/"+tkKey, nil)
	if code != 200 || !strings.Contains(string(raw), "What we build") || !strings.Contains(string(raw), "Step one") || strings.Contains(string(raw), secretComment) {
		t.Errorf("customer task detail (description + checklist, never comments): %d %s", code, raw)
	}
	if code, _ := cust.do("GET", "/api/w/portal/projects/"+otherPr+"/tasks", nil); code != 404 {
		t.Errorf("customer read another project's board: %d", code)
	}
	for _, w := range []struct{ m, p string }{
		{"PATCH", "/api/w/tasks/" + tkKey}, {"POST", "/api/w/projects/" + prID + "/tasks"},
		{"POST", "/api/w/tasks/" + tkKey + "/comments"}, {"GET", "/api/w/tasks/" + tkKey},
	} {
		if code, _ := cust.do(w.m, w.p, map[string]any{"title": "x", "body": "x"}); code/100 == 2 {
			t.Errorf("client reached staff task route %s %s: %d", w.m, w.p, code)
		}
	}
	if tm := cust.must("GET", "/api/w/portal/projects/"+prID+"/time", nil, 200); num(tm["used_minutes"]) != 90 {
		t.Errorf("portal time: %v", tm)
	}
	if !strings.Contains(mustString(t, cust, "GET", "/api/w/portal/projects/"+prID+"/activity"), tkKey) {
		t.Errorf("activity should show the new task")
	}
	// Board off → 404 and no columns; money on → the budget appears.
	if code, _ := cust.do("PATCH", "/api/w/projects/"+prID, map[string]any{"share_board": false}); code/100 == 2 {
		t.Errorf("a client changed the share settings: %d", code)
	}
	owner.must("PATCH", "/api/w/projects/"+prID, map[string]any{"share_board": false, "share_team": false, "share_money": true}, 200)
	for _, p := range []string{"/tasks", "/tasks/" + tkKey} {
		if code, _ := cust.do("GET", "/api/w/portal/projects/"+prID+p, nil); code != 404 {
			t.Errorf("board off: %s answered %d, want 404", p, code)
		}
	}
	page = cust.must("GET", "/api/w/portal/projects/"+prID, nil, 200)
	if len(page["team"].([]any)) != 0 || len(page["columns"].([]any)) != 0 || num(page["budget_amount_minor"]) != 999900 {
		t.Errorf("share off/money on: team %v columns %v money %v", page["team"], page["columns"], page["budget_amount_minor"])
	}
	if strings.Contains(mustString(t, cust, "GET", "/api/w/portal/projects/"+prID+"/activity"), tkKey) {
		t.Errorf("board off: the activity must not name tasks")
	}
	owner.must("PATCH", "/api/w/projects/"+prID, map[string]any{"share_board": true, "share_team": true, "share_money": false}, 200)

	// ---- MCP -------------------------------------------------------------------------------
	tok := cust.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "cp " + rnd(), "scopes": []string{"portal:read", "portal:write"}}, 201)
	agent := newClient(t, srv.URL)
	agent.bearer = tok["plaintext"].(string)
	call := func(c *client, tool string, args map[string]any) (string, bool) {
		t.Helper()
		code, out, _ := rpc(t, c, "tools/call", map[string]any{"name": tool, "arguments": args})
		if code != 200 || out["error"] != nil {
			t.Fatalf("%s: %d %v", tool, code, out)
		}
		res := out["result"].(map[string]any)
		isErr, _ := res["isError"].(bool)
		return res["content"].([]any)[0].(map[string]any)["text"].(string), isErr
	}
	if text, isErr := call(agent, "portal_projects", nil); isErr || !strings.Contains(text, prID) || strings.Contains(text, otherPr) {
		t.Errorf("portal_projects: %v %q", isErr, text)
	}
	if text, isErr := call(agent, "portal_project", map[string]any{"project": prID}); isErr || strings.Contains(text, secretTask) || !strings.Contains(text, rk2) {
		t.Errorf("portal_project: %v %q", isErr, text)
	}
	if _, isErr := call(agent, "portal_project", map[string]any{"project": otherPr}); !isErr {
		t.Errorf("portal_project on another project must fail")
	}
	text, isErr := call(agent, "request_feature", map[string]any{"project": prID, "title": "SSO login", "kind": "feature"})
	if isErr || !strings.Contains(text, "pending") {
		t.Errorf("request_feature: %v %q", isErr, text)
	}
	if text, isErr := call(agent, "list_requests", nil); !isErr || !strings.Contains(text, "requests:manage") {
		t.Errorf("a client token cannot hold requests:manage: %v %q", isErr, text)
	}
	// The customer's own MCP: only client-holdable tools are listed; the board, task, issues and
	// time mirror the portal endpoints (same share settings, same 404s); staff tools are shut.
	_, tl, _ := rpc(t, agent, "tools/list", map[string]any{})
	listed := map[string]bool{}
	for _, x := range tl["result"].(map[string]any)["tools"].([]any) {
		listed[x.(map[string]any)["name"].(string)] = true
	}
	for _, want := range []string{"portal_projects", "portal_project", "portal_board", "portal_task", "portal_issues", "portal_issue",
		"portal_update_issue", "portal_comment_issue", "request_feature", "portal_requests", "portal_invoices", "portal_time"} {
		if !listed[want] {
			t.Errorf("client tools/list lacks %s", want)
		}
	}
	for _, staff := range []string{"list_tasks", "get_task", "list_requests", "profitability"} {
		if listed[staff] {
			t.Errorf("client tools/list shows staff tool %s", staff)
		}
	}
	if code, _ := cust.do("POST", "/api/w/mcp_tokens", map[string]any{"name": "x", "scopes": []string{"tasks:read"}}); code != 422 {
		t.Errorf("a client minted tasks:read: %d", code)
	}
	if text, isErr := call(agent, "portal_board", map[string]any{"project": prID}); isErr || !strings.Contains(text, tkKey) {
		t.Errorf("portal_board: %v %q", isErr, text)
	}
	if text, isErr := call(agent, "portal_task", map[string]any{"project": prID, "task": tkKey}); isErr || !strings.Contains(text, "Step one") || strings.Contains(text, secretComment) {
		t.Errorf("portal_task: %v %q", isErr, text)
	}
	if text, isErr := call(agent, "portal_issue", map[string]any{"key": issue}); isErr || !strings.Contains(text, "Thanks!") {
		t.Errorf("portal_issue: %v %q", isErr, text)
	}
	if _, isErr := call(agent, "portal_comment_issue", map[string]any{"key": issue, "body": "via MCP"}); isErr {
		t.Errorf("portal_comment_issue failed")
	}
	if text, isErr := call(agent, "portal_time", map[string]any{"project": prID}); isErr || !strings.Contains(text, "1.5h") {
		t.Errorf("portal_time: %v %q", isErr, text)
	}
	for _, c := range []struct {
		tool string
		args map[string]any
	}{
		{"portal_board", map[string]any{"project": otherPr}},
		{"portal_issue", map[string]any{"key": foreign}},
		{"list_tasks", map[string]any{"project": prID}},
		{"get_task", map[string]any{"task": tkKey}},
	} {
		if text, isErr := call(agent, c.tool, c.args); !isErr {
			t.Errorf("client token reached %s: %q", c.tool, text)
		}
	}
	mt := owner.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "mgr " + rnd(), "scopes": []string{"requests:manage", "issues:read"}}, 201)
	mgr := newClient(t, srv.URL)
	mgr.bearer = mt["plaintext"].(string)
	if text, isErr := call(mgr, "list_requests", nil); isErr || !strings.Contains(text, "SSO login") {
		t.Errorf("list_requests: %v %q", isErr, text)
	}
	if text, isErr := call(mgr, "list_issues", nil); isErr || strings.Contains(text, "SSO login") || strings.Contains(text, "Export to PDF") {
		t.Errorf("list_issues must hide pending/converted requests: %v %q", isErr, text)
	}

	// ---- another workspace -----------------------------------------------------------------
	eve, _, _ := signup(t, a, srv.URL, "cp-eve")
	eveWS := eve.must("POST", "/api/me/workspaces", map[string]string{"name": "Eve " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	eve.ws = eveWS
	for _, p := range []string{"/api/w/portal/projects/" + prID, "/api/w/portal/issues/" + issue, "/api/w/requests/" + rk2 + "/accept"} {
		method := "GET"
		if strings.HasSuffix(p, "/accept") {
			method = "POST"
		}
		if code, b := eve.do(method, p, map[string]any{}); code/100 == 2 || strings.Contains(string(b), prID) {
			t.Errorf("another workspace reached %s: %d %s", p, code, b)
		}
	}
	if strings.Contains(mustString(t, eve, "GET", "/api/w/requests?state=all"), "Dark mode") {
		t.Errorf("another workspace's inbox shows our requests")
	}
	eve.ws = ws
	if code, _ := eve.do("GET", "/api/w/portal/projects", nil); code != 404 {
		t.Errorf("a non-member naming our workspace: %d, want 404", code)
	}
}
