package server

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/work"
)

// TestParallelAgentTimers: agent (MCP) timers run in parallel, one per task, beside the person's one
// human timer; neither kind stops the other; an agent start on a running task is idempotent; stop
// targets a task or an entry; reminders do not fire once per agent timer.
func TestParallelAgentTimers(t *testing.T) {
	a, srv := bootStack(t)
	alice, _, _ := signup(t, a, srv.URL, "alice")
	mia, miaID, _ := signup(t, a, srv.URL, "mia")
	aID := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Agents " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, aID, miaID); err != nil {
		t.Fatal(err)
	}
	alice.ws, mia.ws = aID, aID
	prID := alice.must("POST", "/api/w/projects", map[string]any{"name": "Agents " + rnd()}, 201)["id"].(string)
	task := func(title string) string {
		return alice.must("POST", "/api/w/projects/"+prID+"/tasks", map[string]any{"title": title}, 201)["key"].(string)
	}
	k1, k2, k3 := task("One"), task("Two"), task("Three")

	tok := mia.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "agents", "scopes": []string{"members:read", "time:read", "time:write"}}, 201)
	agent := newClient(t, srv.URL)
	agent.bearer = tok["plaintext"].(string)
	call := func(tool string, args map[string]any) (string, bool) {
		_, text, isErr := mcpCall(agent, "/api/mcp", tool, args)
		return text, isErr
	}
	running := func() (map[string]any, []any) {
		r := mia.must("GET", "/api/w/time/running", nil, 200)
		h, _ := r["timer"].(map[string]any)
		ag, _ := r["agents"].([]any)
		return h, ag
	}

	// A human timer, then two agent timers on two tasks: all three run, nothing is stopped.
	human := mia.must("POST", "/api/w/time/start", map[string]any{"project": prID, "description": "human"}, 201)["started"].(map[string]any)
	if text, isErr := call("start_timer", map[string]any{"project": prID}); !isErr || !strings.Contains(text, "needs a task") {
		t.Errorf("an agent start without a task must be refused: %v %q", isErr, text)
	}
	if text, isErr := call("start_timer", map[string]any{"task": k1, "description": "agent one"}); isErr || !strings.HasPrefix(text, "Started: agent one") || strings.Contains(text, "Stopped") {
		t.Fatalf("agent start 1: %v %q", isErr, text)
	}
	if text, isErr := call("start_timer", map[string]any{"task": k2, "description": "agent two"}); isErr || !strings.HasPrefix(text, "Started: agent two") || strings.Contains(text, "Stopped") {
		t.Fatalf("agent start 2: %v %q", isErr, text)
	}
	h, ag := running()
	if h == nil || h["id"] != human["id"] || len(ag) != 2 {
		t.Fatalf("expected the human timer and two agent timers, got human=%v agents=%d", h, len(ag))
	}
	// Same task again: idempotent.
	if text, isErr := call("start_timer", map[string]any{"task": k1}); isErr || !strings.HasPrefix(text, "Already running") {
		t.Errorf("agent start on a running task must return the existing timer: %v %q", isErr, text)
	}
	if _, ag = running(); len(ag) != 2 {
		t.Errorf("an idempotent start must not add a timer: %d", len(ag))
	}
	// A human start replaces only the human timer.
	human2 := mia.must("POST", "/api/w/time/start", map[string]any{"project": prID, "description": "human again"}, 201)
	if st, _ := human2["stopped"].(map[string]any); st == nil || st["id"] != human["id"] {
		t.Errorf("the human start must stop the human timer: %v", human2["stopped"])
	}
	if h, ag = running(); h == nil || h["id"] != human2["started"].(map[string]any)["id"] || len(ag) != 2 {
		t.Errorf("a human start must not stop agent timers: human=%v agents=%d", h, len(ag))
	}
	if text, _ := call("whoami", nil); !strings.Contains(text, "running timer: human again") || !strings.Contains(text, "agent timers running: 2") {
		t.Errorf("whoami: %q", text)
	}
	if text, _ := call("get_running_timer", nil); !strings.Contains(text, "agent one") || !strings.Contains(text, "agent two") || !strings.Contains(text, "human again") {
		t.Errorf("get_running_timer: %q", text)
	}
	// Stop with several running and no target: an error that lists them.
	if text, isErr := call("stop_timer", nil); !isErr || !strings.Contains(text, "several agent timers") || !strings.Contains(text, k1) || !strings.Contains(text, k2) {
		t.Errorf("an ambiguous stop must list the agent timers: %v %q", isErr, text)
	}
	// Stop by task.
	if text, isErr := call("stop_timer", map[string]any{"task": k1}); isErr || !strings.HasPrefix(text, "Stopped: agent one") {
		t.Errorf("stop by task: %v %q", isErr, text)
	}
	if h, ag = running(); h == nil || len(ag) != 1 {
		t.Fatalf("after stopping one: human=%v agents=%d", h, len(ag))
	}
	// Stop by entry id.
	k2id := ag[0].(map[string]any)["id"].(string)
	if text, isErr := call("start_timer", map[string]any{"task": k3, "description": "agent three"}); isErr {
		t.Fatalf("agent start 3: %q", text)
	}
	if text, isErr := call("stop_timer", map[string]any{"entry": k2id}); isErr || !strings.HasPrefix(text, "Stopped: agent two") {
		t.Errorf("stop by entry: %v %q", isErr, text)
	}
	// Exactly one agent timer left: a bare stop stops it, not the human timer.
	if text, isErr := call("stop_timer", nil); isErr || !strings.HasPrefix(text, "Stopped: agent three") {
		t.Errorf("a bare agent stop with one agent timer: %v %q", isErr, text)
	}
	if h, ag = running(); h == nil || len(ag) != 0 {
		t.Errorf("the human timer must survive every agent stop: human=%v agents=%d", h, len(ag))
	}

	// The database enforces both rules even around the domain code.
	if _, err := a.SysDB.Exec(`INSERT INTO time_entries (workspace_id, user_id, started_at, source, created_by) VALUES ($1, $2, now(), 'timer', $2)`, aID, miaID); err == nil ||
		!(strings.Contains(err.Error(), "one_running_timer") || strings.Contains(err.Error(), "no_overlap")) {
		t.Errorf("a second human timer must be refused by the database: %v", err)
	}
	var taskID string
	_ = a.SysDB.QueryRow(`SELECT id FROM tasks WHERE workspace_id = $1 AND key = $2`, aID, k1).Scan(&taskID)
	ins := `INSERT INTO time_entries (workspace_id, user_id, project_id, task_id, started_at, source, created_by) VALUES ($1, $2, $3, $4, now(), 'mcp', $2)`
	if _, err := a.SysDB.Exec(ins, aID, miaID, prID, taskID); err != nil {
		t.Fatalf("one agent timer on a task: %v", err)
	}
	if _, err := a.SysDB.Exec(ins, aID, miaID, prID, taskID); err == nil || !strings.Contains(err.Error(), "one_running_agent_timer_per_task") {
		t.Errorf("a second agent timer on the same task must be refused by the database: %v", err)
	}

	// Reminders: three long-running agent timers raise ONE notification, not three.
	for _, k := range []string{k2, k3} {
		call("start_timer", map[string]any{"task": k})
	}
	if _, err := a.SysDB.Exec(`UPDATE time_entries SET started_at = now() - interval '30 hours' WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NULL AND source = 'mcp'`, aID, miaID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SysDB.Exec(`UPDATE time_entries SET ended_at = now() WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NULL AND source <> 'mcp'`, aID, miaID); err != nil {
		t.Fatal(err)
	}
	if _, err := work.New(a).RemindLongRunning(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	var notes int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND kind = 'timer.long_running'`, aID, miaID).Scan(&notes)
	if notes != 1 {
		t.Errorf("three long-running agent timers must raise one reminder, got %d", notes)
	}
}
