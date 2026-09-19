package server

/*
TestBilling: AI usage and subscriptions end up on invoices exactly once.

An agent (member token, ai:record) pushes two days of usage; a re-push replaces a day. The
manager sets a 20% AI markup and adds a monthly subscription that started two months ago.
Drafting an invoice for the client bills AI at cost + 20% and every due subscription period;
the usage is then locked (a re-push is refused), a second draft finds nothing, voiding the
invoice releases both, and a new draft bills them again. A member cannot read AI costs.
*/

import (
	"strings"
	"testing"
	"time"
)

func TestBilling(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "bowner")
	mem, memID, _ := signup(t, a, srv.URL, "bmember")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Billing " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, memID); err != nil {
		t.Fatal(err)
	}
	owner.ws, mem.ws = ws, ws
	cl := owner.must("POST", "/api/w/clients", map[string]any{"name": "Acme " + rnd(), "currency": "USD"}, 201)["id"].(string)
	proj := "Acme app " + rnd()
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": proj, "client_id": cl, "visibility": "workspace"}, 201)["id"].(string)

	tok := mem.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "usage " + rnd(), "scopes": []string{"ai:record"}}, 201)
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
	today := time.Now().UTC()
	d1, d2 := today.AddDate(0, 0, -2).Format("2006-01-02"), today.AddDate(0, 0, -1).Format("2006-01-02")
	usage := func(cost string) map[string]any {
		return map[string]any{"project": proj, "rows": []map[string]any{
			{"day": d1, "model": "claude-opus-5", "input_tokens": 1000000, "output_tokens": 200000, "cost": "10.00"},
			{"day": d2, "model": "claude-opus-5", "input_tokens": 500000, "output_tokens": 100000, "cost": cost},
		}}
	}
	if text, isErr := call(agent, "record_ai_usage", usage("4.00")); isErr {
		t.Fatalf("record_ai_usage: %q", text)
	}
	if text, isErr := call(agent, "record_ai_usage", usage("5.00")); isErr || !strings.Contains(text, "15.00 USD") {
		t.Fatalf("a re-push replaces the day (10 + 5): %v %q", isErr, text)
	}
	if code, _ := mem.do("GET", "/api/w/ai-usage", nil); code != 403 {
		t.Errorf("a member read AI costs: %d", code)
	}
	owner.must("PUT", "/api/w/projects/"+pid+"/ai-markup", map[string]any{"percent": "20"}, 200)
	sum := owner.must("GET", "/api/w/ai-usage?group_by=project", nil, 200)["rows"].([]any)
	if len(sum) != 1 || num(sum[0].(map[string]any)["billed_minor"]) != 1800 {
		t.Fatalf("summary billed = 15.00 + 20%%: %v", sum)
	}

	start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -2, 0).Format("2006-01-02")
	owner.must("POST", "/api/w/projects/"+pid+"/subscriptions", map[string]any{
		"name": "Hetzner server", "category": "infrastructure", "price": "49.00", "cost": "30.00", "currency": "USD", "interval": "month", "starts_on": start,
	}, 201)

	inv := owner.must("POST", "/api/w/invoices/from-time", map[string]any{"client_id": cl}, 201)
	lines := inv["lines"].([]any)
	var ai, subs int
	var total float64
	for _, l := range lines {
		m := l.(map[string]any)
		d := m["description"].(string)
		total += num(m["amount_minor"])
		switch {
		case strings.HasPrefix(d, "AI usage"):
			ai++
			if num(m["amount_minor"]) != 1800 {
				t.Errorf("AI line at cost + 20%%: %v", m)
			}
		case strings.Contains(d, "Hetzner server"):
			subs++
			if num(m["amount_minor"]) != 4900 {
				t.Errorf("subscription line: %v", m)
			}
		}
	}
	if ai != 1 || subs != 3 {
		t.Fatalf("want 1 AI line and 3 monthly periods (two past months + this one), got %d and %d: %v", ai, subs, lines)
	}
	if num(inv["subtotal_minor"]) != total {
		t.Errorf("subtotal %v != lines %v", inv["subtotal_minor"], total)
	}
	invID := inv["id"].(string)

	// Locked: a re-push of an invoiced day is refused, and nothing is left to bill.
	if text, isErr := call(agent, "record_ai_usage", usage("6.00")); !isErr || !strings.Contains(text, "invoiced") {
		t.Errorf("re-push of an invoiced day: %v %q", isErr, text)
	}
	if code, _ := owner.do("POST", "/api/w/invoices/from-time", map[string]any{"client_id": cl}); code != 422 {
		t.Errorf("a second draft must find nothing: %d", code)
	}

	// Void releases both; a new draft bills them again.
	owner.must("PATCH", "/api/w/invoices/"+invID, map[string]any{"status": "void"}, 200)
	inv2 := owner.must("POST", "/api/w/invoices/from-time", map[string]any{"client_id": cl}, 201)
	if len(inv2["lines"].([]any)) != 4 {
		t.Errorf("after void the same 4 lines are billable again: %v", inv2["lines"])
	}
	// Deleting that draft releases them too.
	owner.must("DELETE", "/api/w/invoices/"+inv2["id"].(string), nil, 204)
	var locked int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM ai_usage WHERE workspace_id = $1 AND (invoice_id IS NOT NULL OR locked_at IS NOT NULL)`, ws).Scan(&locked)
	var charges int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM subscription_charges WHERE workspace_id = $1`, ws).Scan(&charges)
	if locked != 0 || charges != 0 {
		t.Errorf("a deleted draft must release usage (%d locked) and charges (%d)", locked, charges)
	}
}
