package server

/*
TestIssueLoop drives the /issues agent loop over the user MCP against the real
stack: file an issue into a project, find it in board order, refuse to start
without a plan or on a human_only issue, start with a plan (posted as a comment),
answer a mention, hand to review (time banked), park on a question, reorder, and
fetch the Feedback SDK install guide for the project's key.
*/

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestIssueLoop(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "iowner")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Issues " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	owner.ws = ws
	proj := "Client site " + rnd()
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": proj}, 201)["id"].(string)

	tok := owner.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "loop " + rnd(),
		"scopes": []string{"issues:read", "issues:write", "projects:read", "projects:write"}}, 201)
	agent := newClient(t, srv.URL)
	agent.bearer = tok["plaintext"].(string)

	call := func(tool string, args map[string]any) (string, bool) {
		t.Helper()
		code, out, _ := rpc(t, agent, "tools/call", map[string]any{"name": tool, "arguments": args})
		if code != 200 || out["error"] != nil {
			t.Fatalf("%s: %d %v", tool, code, out)
		}
		res := out["result"].(map[string]any)
		text := res["content"].([]any)[0].(map[string]any)["text"].(string)
		isErr, _ := res["isError"].(bool)
		return text, isErr
	}
	keyOf := func(text string) string { return regexp.MustCompile(`M[HG]-\d+`).FindString(text) }

	text, isErr := call("create_issue", map[string]any{"title": "Checkout button does nothing", "project": proj, "issue_type": "bug", "priority": "high", "status": "todo"})
	first := keyOf(text)
	if isErr || first == "" {
		t.Fatalf("create_issue: %v %q", isErr, text)
	}
	text, _ = call("create_issue", map[string]any{"title": "Second card", "project": proj, "status": "todo"})
	second := keyOf(text)

	// A human-only card is hidden from the queue and refused by start_issue.
	text, _ = call("create_issue", map[string]any{"title": "Pricing decision", "project": proj, "status": "todo"})
	human := keyOf(text)
	if text, isErr = call("update_issue", map[string]any{"key": human, "human_only": true}); isErr {
		t.Fatalf("human_only: %q", text)
	}
	if text, _ = call("list_issues", map[string]any{"project": proj, "state": "open"}); strings.Contains(text, human) || !strings.Contains(text, first) {
		t.Errorf("queue must list %s and hide human_only %s: %q", first, human, text)
	}
	if text, isErr = call("start_issue", map[string]any{"key": human, "plan": "x"}); !isErr || !strings.Contains(text, "human_only") {
		t.Errorf("start on human_only: %v %q", isErr, text)
	}

	// Plan first: refused without one.
	if text, isErr = call("start_issue", map[string]any{"key": first, "plan": "  "}); !isErr || !strings.Contains(text, "plan") {
		t.Errorf("start without a plan: %v %q", isErr, text)
	}
	if text, isErr = call("start_issue", map[string]any{"key": first, "plan": "Bind the click handler in checkout.tsx; verify in the browser."}); isErr {
		t.Fatalf("start_issue: %q", text)
	}
	var status string
	var started *time.Time
	_ = a.SysDB.QueryRow(`SELECT status, started_at FROM reports WHERE workspace_id = $1 AND key = $2`, ws, first).Scan(&status, &started)
	if status != "in_progress" || started == nil {
		t.Errorf("after start: status=%s started=%v", status, started)
	}

	// A human mentions the agent; the mention is listed until an agent comment answers it.
	if code, b := owner.do("POST", "/api/w/issues/"+first+"/comments", map[string]any{"body": "@claude also check the mobile layout"}); code/100 != 2 {
		t.Fatalf("comment: %d %s", code, b)
	}
	if text, _ = call("list_mentions", map[string]any{"project": proj}); !strings.Contains(text, first) {
		t.Errorf("list_mentions must show %s: %q", first, text)
	}
	call("comment_issue", map[string]any{"key": first, "body": "Checked, mobile is fine.", "as_agent": true})
	if text, _ = call("list_mentions", map[string]any{"project": proj}); strings.Contains(text, first) {
		t.Errorf("an answered mention must drop out: %q", text)
	}

	// Review banks the clock.
	_, _ = a.SysDB.Exec(`UPDATE reports SET started_at = now() - interval '90 seconds' WHERE workspace_id = $1 AND key = $2`, ws, first)
	if text, isErr = call("review_issue", map[string]any{"key": first, "note": "Handler bound; verified by clicking in Chrome."}); isErr {
		t.Fatalf("review_issue: %q", text)
	}
	var secs int64
	_ = a.SysDB.QueryRow(`SELECT status, agent_seconds, started_at FROM reports WHERE workspace_id = $1 AND key = $2`, ws, first).Scan(&status, &secs, &started)
	if status != "in_review" || secs < 85 || started != nil {
		t.Errorf("after review: status=%s seconds=%d started=%v", status, secs, started)
	}
	text, _ = call("get_issue", map[string]any{"key": first})
	for _, want := range []string{"**Plan**", "**Ready for review.**"} {
		if !strings.Contains(text, want) {
			t.Errorf("get_issue thread lacks %q: %q", want, text)
		}
	}

	// Park the second on a question, then reorder it before the first (it takes in_review).
	if text, isErr = call("request_approval", map[string]any{"key": second, "question": "Stripe or Paddle? I'd pick Stripe."}); isErr {
		t.Fatalf("request_approval: %q", text)
	}
	if text, isErr = call("reorder_issue", map[string]any{"key": second, "before": first}); isErr || !strings.Contains(text, "in_review") {
		t.Errorf("reorder_issue: %v %q", isErr, text)
	}
	var o1, o2 int64
	_ = a.SysDB.QueryRow(`SELECT sort_order FROM reports WHERE workspace_id = $1 AND key = $2`, ws, first).Scan(&o1)
	_ = a.SysDB.QueryRow(`SELECT sort_order, status FROM reports WHERE workspace_id = $1 AND key = $2`, ws, second).Scan(&o2, &status)
	if !(o2 < o1) || status != "in_review" {
		t.Errorf("reorder: %s=%d %s=%d status=%s", second, o2, first, o1, status)
	}

	// The install guide for the project's key, as an agent would fetch it.
	fk := owner.must("POST", "/api/w/projects/"+pid+"/feedback-keys", map[string]any{"name": "site", "allowed_origins": []string{"https://client.example.com"}}, 201)

	// The launcher's look: validated on write, served publicly by key.
	if code, _ := owner.do("PATCH", "/api/w/feedback-keys/"+fk["id"].(string), map[string]any{"widget": map[string]any{"color": "red"}}); code != 422 {
		t.Errorf("a bad colour must be refused: %d", code)
	}
	owner.must("PATCH", "/api/w/feedback-keys/"+fk["id"].(string), map[string]any{"widget": map[string]any{"color": "#0F766E", "text": "Feedback", "shape": "tab", "icon": "message"}}, 200)
	anon := newClient(t, srv.URL)
	_, b := anon.do("GET", "/api/feedback/embed/config?key="+fk["public_key"].(string), nil)
	if !strings.Contains(string(b), "#0f766e") || !strings.Contains(string(b), "\"tab\"") {
		t.Errorf("public widget config: %s", b)
	}
	if _, b = anon.do("GET", "/api/feedback/embed/config?key=pfk_unknown", nil); strings.Contains(string(b), "0f766e") {
		t.Errorf("an unknown key must get the default look: %s", b)
	}
	if text, isErr := call("set_feedback_widget", map[string]any{"key": fk["id"], "color": "#112233", "shape": "circle"}); isErr || !strings.Contains(text, "#112233") {
		t.Errorf("set_feedback_widget: %v %q", isErr, text)
	}
	// Feedback is a frontend-only product now — the server-side packages were retired with sdk/,
	// which is why this used to ask for "laravel" and fail. The key travels in the page, not in a
	// server .env.
	text, isErr = call("get_feedback_install", map[string]any{"project": proj, "stack": "react"})
	if isErr || !strings.Contains(text, "npx shadcn@latest add") || !strings.Contains(text, "pfk_") {
		t.Errorf("get_feedback_install react: %v %q", isErr, text)
	}
	// An unknown stack names the ones that exist rather than silently answering the agent guide.
	if text, isErr = call("get_feedback_install", map[string]any{"project": proj, "stack": "laravel"}); !isErr || !strings.Contains(text, "unknown stack") {
		t.Errorf("get_feedback_install with a retired stack: %v %q", isErr, text)
	}
	if text, isErr = call("get_feedback_install", map[string]any{"project": proj}); isErr || !strings.Contains(text, "Detect the stack") {
		t.Errorf("get_feedback_install agent: %v %q", isErr, text)
	}
}
