package server

/*
TestMCPSession — the P3 exit criteria over the real HTTP transport (the same JSON-RPC a Claude Code
HTTP MCP client sends): initialize → tools/list → a minted token creates a task, starts and stops a
timer, pulls time_summary / timesheet / budget_status, moves a feedback issue; an out-of-scope call
fails in-band; profitability needs reports:finance AND a manager; rate limits answer 429 with a
JSON-RPC error and Retry-After, per token, and failed authentications are limited per address.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run MCPSession -v
*/

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

func rpc(t *testing.T, c *client, method string, params any) (int, map[string]any, http.Header) {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 7, "method": method, "params": params})
	req, _ := http.NewRequest(http.MethodPost, c.base+"/api/mcp", strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	res, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out, res.Header
}

func TestMCPSession(t *testing.T) {
	t.Setenv("MCP_RATE_PER_MINUTE", "40")
	t.Setenv("MCP_AUTH_FAIL_PER_MINUTE", "3")
	a, srv := bootStack(t)

	owner, _, _ := signup(t, a, srv.URL, "mowner")
	mem, memID, _ := signup(t, a, srv.URL, "mmember")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "MCP " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, memID); err != nil {
		t.Fatal(err)
	}
	owner.ws, mem.ws = ws, ws
	proj := "Agent work " + rnd()
	owner.must("POST", "/api/w/projects", map[string]any{"name": proj, "billing_mode": "hourly", "budget_minutes": 600}, 201)
	owner.must("POST", "/api/reports", map[string]any{"workspace_id": ws, "number": 1, "key": "MG-900", "title": "feedback " + rnd(),
		"issue_type": "bug", "status": "backlog", "state": "open", "priority": "medium", "sort_order": 0, "agent_seconds": 0, "human_only": false}, 201)

	mint := func(c *client, scopes ...string) *client {
		tok := c.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "claude " + rnd(), "scopes": scopes}, 201)
		agent := newClient(t, srv.URL)
		agent.bearer = tok["plaintext"].(string)
		return agent
	}
	agent := mint(owner, "members:read", "projects:read", "tasks:read", "tasks:write", "time:read", "time:write", "reports:read", "feedback:read", "feedback:write")

	// The handshake a client performs.
	code, init, _ := rpc(t, agent, "initialize", map[string]any{"protocolVersion": "2025-06-18", "capabilities": map[string]any{},
		"clientInfo": map[string]any{"name": "claude-code", "version": "test"}})
	if code != 200 || init["result"].(map[string]any)["protocolVersion"] != "2025-06-18" {
		t.Fatalf("initialize: %d %v", code, init)
	}
	if code, _, _ := rpc(t, agent, "notifications/initialized", nil); code != 200 && code != 202 {
		t.Errorf("initialized notification: %d", code)
	}
	_, list, _ := rpc(t, agent, "tools/list", map[string]any{})
	names := map[string]bool{}
	for _, x := range list["result"].(map[string]any)["tools"].([]any) {
		names[x.(map[string]any)["name"].(string)] = true
	}
	for _, want := range []string{"time_summary", "budget_status", "timesheet", "profitability", "update_feedback_status", "create_task", "start_timer", "stop_timer"} {
		if !names[want] {
			t.Errorf("tools/list lacks %s", want)
		}
	}

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

	// A block that ended 25 minutes ago (the workspace is on UTC); the summary covers its day.
	started := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	day := started.Format("2006-01-02")
	text, isErr := call(agent, "create_task", map[string]any{"project": proj, "title": "Wire the reports", "assignees": []string{"me"}})
	key := regexp.MustCompile(`MG-\d+`).FindString(text)
	if isErr || key == "" {
		t.Fatalf("create_task: %v %q", isErr, text)
	}
	if text, isErr = call(agent, "start_timer", map[string]any{"task": key, "description": "agent session"}); isErr {
		t.Fatalf("start_timer: %q", text)
	}
	if text, isErr = call(agent, "stop_timer", nil); isErr || !strings.Contains(text, "agent session") {
		t.Fatalf("stop_timer: %v %q", isErr, text)
	}
	if text, isErr = call(agent, "log_time", map[string]any{"project": proj, "started_at": started.Format(time.RFC3339), "minutes": 95, "description": "pairing"}); isErr {
		t.Fatalf("log_time: %q", text)
	}
	text, isErr = call(agent, "time_summary", map[string]any{"group_by": "project", "from": day, "to": time.Now().UTC().Format("2006-01-02")})
	if isErr || !strings.Contains(text, proj) || !strings.Contains(text, "Total:") || !strings.Contains(text, "1:35") {
		t.Errorf("time_summary: %v %q", isErr, text)
	}
	t.Logf("time_summary:\n%s", text)
	if text, isErr = call(agent, "time_summary", map[string]any{"group_by": "hour"}); !isErr {
		t.Errorf("a bad grouping must fail in-band: %q", text)
	}
	if text, isErr = call(agent, "timesheet", map[string]any{"week": day}); isErr || !strings.Contains(text, proj) {
		t.Errorf("timesheet: %v %q", isErr, text)
	}
	if text, isErr = call(agent, "budget_status", nil); isErr || !strings.Contains(text, proj) || !strings.Contains(text, "/ 10:00") {
		t.Errorf("budget_status: %v %q", isErr, text)
	}
	if text, isErr = call(agent, "update_feedback_status", map[string]any{"key": "MG-900", "status": "done", "resolution": "fixed by the agent"}); isErr || !strings.Contains(text, "backlog → done") {
		t.Errorf("update_feedback_status: %v %q", isErr, text)
	}
	var state string
	_ = a.SysDB.QueryRow(`SELECT state FROM reports WHERE workspace_id = $1 AND key = 'MG-900'`, ws).Scan(&state)
	if state != "closed" {
		t.Errorf("done must close the issue, state=%s", state)
	}

	// Out of scope: in-band, naming the scope.
	if text, isErr = call(agent, "profitability", nil); !isErr || !strings.Contains(text, "reports:finance") {
		t.Errorf("profitability without reports:finance: %v %q", isErr, text)
	}
	finance := mint(owner, "reports:finance")
	if text, isErr = call(finance, "profitability", nil); isErr || !strings.Contains(text, "Total:") {
		t.Errorf("profitability with reports:finance: %v %q", isErr, text)
	}
	// A member cannot hold reports:finance at all (the mint is refused), and a member's summary is their own.
	if code, _ := mem.do("POST", "/api/w/mcp_tokens", map[string]any{"name": "x", "scopes": []string{"reports:finance"}}); code/100 == 2 {
		t.Errorf("a member minted a reports:finance token: %d", code)
	}
	memAgent := mint(mem, "reports:read")
	if text, isErr = call(memAgent, "time_summary", map[string]any{"users": []string{"me"}}); isErr || !strings.Contains(text, "your time") {
		t.Errorf("member time_summary: %v %q", isErr, text)
	}

	// ---- rate limits -------------------------------------------------------------------------------
	limited := 0
	var last map[string]any
	var hdr http.Header
	for i := 0; i < 45 && limited == 0; i++ {
		var code int
		code, last, hdr = rpc(t, memAgent, "ping", nil)
		if code == http.StatusTooManyRequests {
			limited = i + 1
		}
	}
	if limited == 0 {
		t.Fatal("45 calls in a burst were never limited (limit 40/min)")
	}
	errObj, _ := last["error"].(map[string]any)
	if errObj == nil || num(errObj["code"]) != -32029 || !strings.Contains(errObj["message"].(string), "rate limit") || hdr.Get("Retry-After") == "" {
		t.Errorf("429 must carry a JSON-RPC error and Retry-After: %v %v", last, hdr)
	}
	t.Logf("rate limited on call %d: %v (Retry-After %s)", limited, errObj["message"], hdr.Get("Retry-After"))
	if code, _, _ := rpc(t, finance, "ping", nil); code != 200 {
		t.Errorf("another token was limited too: %d", code)
	}
	// Failed authentications: 3 per minute per address, whatever token is tried.
	codes := []int{}
	for i := 0; i < 5; i++ {
		bad := newClient(t, srv.URL)
		bad.bearer = "mgy_made_up_" + rnd()
		c, _, _ := rpc(t, bad, "ping", nil)
		codes = append(codes, c)
	}
	if codes[0] != 401 || codes[2] != 401 || codes[3] != 429 || codes[4] != 429 {
		t.Errorf("failed authentications: %v (want 401 ×3 then 429)", codes)
	}
	if code, _, _ := rpc(t, finance, "ping", nil); code != 200 {
		t.Errorf("a valid token was locked out by failed authentications: %d", code)
	}
}
