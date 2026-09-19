package server

/*
TestPlatformAdmin — the admin panel and plan limits against the real stack:

 1. /api/admin/* is 404 for a signed-in non-admin (and anonymous); 200 for a platform admin
 2. the admin moves a workspace to Free (2 projects, block): the 3rd project is refused over REST
    (402, message names the plan) and over MCP (in-band error)
 3. a per-workspace override raises the limit; an overage-policy override lets the call through
    and prices the overage in the usage report
 4. a block-policy monthly quota (issues_per_month) refuses REST, MCP and the public embed intake
    (402 quota_exceeded); last month's counter does not count against this month
 5. a suspended workspace answers 403 (workspace_suspended) to its members, over REST and MCP;
    the admin still reads it through /api/admin/*
 6. a suspended account gets 403 (account_suspended) on every call, cannot sign in, and its MCP
    token is refused; reactivation restores it. Force sign-out ends existing sessions.
 7. every admin action is in the audit log (REST and admin MCP)
 8. delete needs the slug; existing workspaces are moved to `unlimited` by the migration

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run PlatformAdmin -v
*/

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/db/migrate"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/mcp"
	"github.com/fadymondy/mahaam/internal/platform"
)

func TestPlatformAdmin(t *testing.T) {
	a, srv := bootStack(t)
	adm, admID, admEmail := signup(t, a, srv.URL, "padmin")
	owner, ownerID, _ := signup(t, a, srv.URL, "powner")
	mate, mateID, mateEmail := signup(t, a, srv.URL, "pmate")

	// 1. Not discoverable before the promotion; the panel opens after it.
	if code, _ := adm.do("GET", "/api/admin/stats", nil); code != 404 {
		t.Fatalf("a non-admin must get 404 on /api/admin/stats, got %d", code)
	}
	if code, _ := newClient(t, srv.URL).do("GET", "/api/admin/users", nil); code != 404 {
		t.Fatalf("anonymous must get 404 on /api/admin/users, got %d", code)
	}
	if _, err := a.SysDB.Exec(`UPDATE users SET roles = 'admin' WHERE id = $1`, admID); err != nil {
		t.Fatal(err)
	}
	platform.Invalidate(admID) // the CLI promotes from another process; the cache there lives 10 s
	if got := adm.must("GET", "/api/me/platform", nil, 200)["is_admin"]; got != true {
		t.Fatalf("/api/me/platform: %v", got)
	}
	if got := owner.must("GET", "/api/me/platform", nil, 200)["is_admin"]; got != false {
		t.Fatalf("/api/me/platform for a normal user: %v", got)
	}
	stats := adm.must("GET", "/api/admin/stats", nil, 200)
	if num(stats["users"]) < 3 || stats["signups"] == nil {
		t.Errorf("stats: %v", stats)
	}

	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Plans " + rnd()}, 201)["workspace"].(map[string]any)
	wsID, slug := ws["id"].(string), ws["slug"].(string)
	owner.ws = wsID
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, wsID, mateID); err != nil {
		t.Fatal(err)
	}
	mate.ws = wsID

	// The owner sees the plan (unlimited in tests via PLAN_DEFAULT); a member does not.
	if p := owner.must("GET", "/api/w/plan", nil, 200)["plan"].(map[string]any); p["key"] != "unlimited" {
		t.Errorf("PLAN_DEFAULT=unlimited: new workspace plan is %v", p["key"])
	}
	if code, _ := mate.do("GET", "/api/w/plan", nil); code != 403 {
		t.Errorf("a member must not read the plan: %d", code)
	}

	// 2. Free = 2 projects, block.
	adm.must("PUT", "/api/admin/workspaces/"+slug+"/plan", map[string]string{"plan": "free"}, 200)
	owner.must("POST", "/api/w/projects", map[string]any{"name": "P1 " + rnd()}, 201)
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": "P2 " + rnd()}, 201)["id"].(string)
	code, b := owner.do("POST", "/api/w/projects", map[string]any{"name": "P3 " + rnd()})
	if code != 402 || !strings.Contains(string(b), "Your plan (Free) allows 2 projects") {
		t.Fatalf("3rd project on Free: %d %s", code, b)
	}
	tok := owner.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "agent",
		"scopes": []string{"projects:write", "projects:read", "issues:write", "issues:read"}}, 201)["plaintext"].(string)
	agent := newClient(t, srv.URL)
	agent.bearer = tok
	if _, text, isErr := mcpCall(agent, "/api/mcp", "create_project", map[string]any{"name": "P3 via MCP"}); !isErr || !strings.Contains(text, "allows 2 projects") {
		t.Fatalf("MCP create_project past the limit must fail in-band: %v %q", isErr, text)
	}

	// 3. An override raises it; an overage override allows and prices it.
	adm.must("PUT", "/api/admin/workspaces/"+wsID+"/overrides", map[string]any{
		"limits": map[string]any{"projects": map[string]any{"limit": 3, "policy": "block"}}}, 200)
	owner.must("POST", "/api/w/projects", map[string]any{"name": "P3 " + rnd()}, 201)
	if code, _ := owner.do("POST", "/api/w/projects", map[string]any{"name": "P4 " + rnd()}); code != 402 {
		t.Fatalf("override limit 3: 4th project got %d", code)
	}
	adm.must("PUT", "/api/admin/workspaces/"+wsID+"/overrides", map[string]any{
		"limits": map[string]any{
			"projects":         map[string]any{"limit": 3, "policy": "overage", "unit_price_minor": 250, "unit_size": 1},
			"issues_per_month": map[string]any{"limit": 1, "policy": "block"},
		}}, 200)
	if _, text, isErr := mcpCall(agent, "/api/mcp", "create_project", map[string]any{"name": "P4 via MCP " + rnd()}); isErr {
		t.Fatalf("overage policy must allow the 4th project over MCP: %q", text)
	}
	usage := owner.must("GET", "/api/w/plan", nil, 200)
	item := func(r map[string]any, key string) map[string]any {
		for _, it := range r["items"].([]any) {
			if m := it.(map[string]any); m["key"] == key {
				return m
			}
		}
		t.Fatalf("no %s in %v", key, r["items"])
		return nil
	}
	if p := item(usage, "projects"); num(p["usage"]) != 4 || num(p["over"]) != 1 || num(p["overage_minor"]) != 250 || p["overridden"] != true {
		t.Errorf("overage projects item: %v", p)
	}
	if num(usage["estimate_minor"]) != num(usage["base_fee_minor"])+num(usage["overage_minor"]) || num(usage["overage_minor"]) < 250 {
		t.Errorf("estimate = base + overage: %v", usage)
	}

	// 4. issues_per_month = 1 (block). Last month's big counter must not count.
	last := limits.PeriodOf(time.Now()).AddDate(0, -1, 0)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_usage (workspace_id, period, issues_created) VALUES ($1, $2, 1000)`, wsID, last); err != nil {
		t.Fatal(err)
	}
	owner.must("POST", "/api/w/issues", map[string]any{"title": "First issue"}, 201)
	if code, b := owner.do("POST", "/api/w/issues", map[string]any{"title": "Second issue"}); code != 402 || !strings.Contains(string(b), "per month") {
		t.Fatalf("2nd issue this month: %d %s", code, b)
	}
	if _, text, isErr := mcpCall(agent, "/api/mcp", "create_issue", map[string]any{"title": "via MCP"}); !isErr || !strings.Contains(text, "per month") {
		t.Fatalf("MCP create_issue past the monthly quota: %v %q", isErr, text)
	}
	pk := owner.must("POST", "/api/w/projects/"+pid+"/feedback-keys",
		map[string]any{"name": "Site", "allowed_origins": []string{"https://client.test"}}, 201)["public_key"].(string)
	code, out := postForm(t, srv.URL+"/api/feedback/embed", "https://client.test", map[string]string{"public_key": pk, "title": "From the widget"})
	if code != 402 || out["code"] != "quota_exceeded" {
		t.Fatalf("embed past the monthly quota: %d %v", code, out)
	}
	hist := adm.must("GET", "/api/admin/workspaces/"+wsID+"/usage?month="+last.Format("2006-01"), nil, 200)
	if it := item(hist, "issues_per_month"); num(it["usage"]) != 1000 {
		t.Errorf("last month's counter: %v", it)
	}
	if it := item(owner.must("GET", "/api/w/plan", nil, 200), "issues_per_month"); num(it["usage"]) != 1 {
		t.Errorf("this month's counter (the trigger): %v", it)
	}
	// Overage instead of block lets the embed through.
	adm.must("PUT", "/api/admin/workspaces/"+wsID+"/overrides", map[string]any{
		"limits": map[string]any{"issues_per_month": map[string]any{"limit": 1, "policy": "overage", "unit_price_minor": 500, "unit_size": 100}}}, 200)
	if code, out := postForm(t, srv.URL+"/api/feedback/embed", "https://client.test", map[string]string{"public_key": pk, "title": "From the widget"}); code != 201 {
		t.Fatalf("embed with overage policy: %d %v", code, out)
	}
	if it := item(owner.must("GET", "/api/w/plan", nil, 200), "issues_per_month"); num(it["over"]) != 1 || num(it["overage_minor"]) != 500 {
		t.Errorf("issues overage: %v", it)
	}

	// 5. Suspended workspace.
	adm.must("POST", "/api/admin/workspaces/"+wsID+"/suspend", map[string]string{"reason": "unpaid invoice"}, 200)
	code, b = owner.do("GET", "/api/w/current", nil)
	if code != 403 || !strings.Contains(string(b), "workspace_suspended") || !strings.Contains(string(b), "unpaid invoice") {
		t.Fatalf("suspended workspace for its owner: %d %s", code, b)
	}
	if code, _, _ := mcpCall(agent, "/api/mcp", "list_projects", map[string]any{}); code != 403 {
		t.Errorf("suspended workspace over MCP: %d", code)
	}
	if d := adm.must("GET", "/api/admin/workspaces/"+wsID, nil, 200)["workspace"].(map[string]any); d["status"] != "suspended" {
		t.Errorf("admin sees the suspended workspace: %v", d["status"])
	}
	adm.must("POST", "/api/admin/workspaces/"+wsID+"/reactivate", nil, 200)
	owner.must("GET", "/api/w/current", nil, 200)

	// 6. Suspended account.
	mateTok := mate.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "m", "scopes": []string{"projects:read"}}, 201)["plaintext"].(string)
	adm.must("POST", "/api/admin/users/"+mateID+"/suspend", map[string]string{"reason": "abuse"}, 200)
	if code, b := mate.do("GET", "/api/me/workspaces", nil); code != 403 || !strings.Contains(string(b), "account_suspended") {
		t.Errorf("suspended account: %d %s", code, b)
	}
	if code, _ := mate.do("GET", "/api/w/current", nil); code != 403 {
		t.Errorf("suspended account in a workspace: %d", code)
	}
	fresh := newClient(t, srv.URL)
	if code, b := fresh.do("POST", "/api/auth/login", map[string]string{"email": mateEmail, "password": "correct-horse-9"}); code != 403 {
		t.Errorf("suspended account signs in: %d %s", code, b)
	}
	mc := newClient(t, srv.URL)
	mc.bearer = mateTok
	if code, _, _ := mcpCall(mc, "/api/mcp", "list_projects", map[string]any{}); code != 403 {
		t.Errorf("suspended account's MCP token: %d", code)
	}
	if code, _ := adm.do("POST", "/api/admin/users/"+admID+"/suspend", map[string]string{}); code != 409 {
		t.Errorf("an admin must not suspend themself: %d", code)
	}
	adm.must("POST", "/api/admin/users/"+mateID+"/reactivate", nil, 200)
	fresh.must("POST", "/api/auth/login", map[string]string{"email": mateEmail, "password": "correct-horse-9"}, 200)
	mate.must("GET", "/api/me/workspaces", nil, 200)

	// Force sign-out: sessions issued before it stop working; a new sign-in works.
	time.Sleep(1100 * time.Millisecond) // JWT iat has whole-second precision
	adm.must("POST", "/api/admin/users/"+mateID+"/sign-out", nil, 200)
	if code, _ := mate.do("GET", "/api/me/workspaces", nil); code != 401 {
		t.Errorf("signed out by an admin: %d", code)
	}
	time.Sleep(1100 * time.Millisecond)
	again := newClient(t, srv.URL)
	again.must("POST", "/api/auth/login", map[string]string{"email": mateEmail, "password": "correct-horse-9"}, 200)
	again.must("GET", "/api/me/workspaces", nil, 200)

	// 7. Admin MCP mirrors, audited as "mcp".
	plain, visible := mcp.NewToken(mcp.AdminPrefix)
	scopes, _ := json.Marshal([]string{"admin:workspaces:read", "admin:workspaces:write", "admin:plans:read", "admin:plans:write", "admin:stats:read", "admin:users:write"})
	if _, err := a.SysDB.Exec(`INSERT INTO admin_mcp_tokens (user_id, name, token_hash, prefix, scopes) VALUES ($1, 'test', $2, $3, $4)`,
		admID, mcp.HashToken(plain), visible, string(scopes)); err != nil {
		t.Fatal(err)
	}
	am := newClient(t, srv.URL)
	am.bearer = plain
	if _, text, isErr := mcpCall(am, "/api/admin/mcp", "set_workspace_plan", map[string]any{"workspace": slug, "plan": "pro"}); isErr || !strings.Contains(text, "Pro") {
		t.Errorf("admin MCP set_workspace_plan: %v %q", isErr, text)
	}
	for _, tool := range []string{"platform_stats", "list_plans"} {
		if _, text, isErr := mcpCall(am, "/api/admin/mcp", tool, map[string]any{}); isErr || text == "" {
			t.Errorf("admin MCP %s: %v %q", tool, isErr, text)
		}
	}
	if _, text, isErr := mcpCall(am, "/api/admin/mcp", "estimate_bill", map[string]any{"workspace": slug}); isErr || !strings.Contains(text, "total") {
		t.Errorf("admin MCP estimate_bill: %v %q", isErr, text)
	}
	if _, text, isErr := mcpCall(am, "/api/admin/mcp", "update_plan", map[string]any{"plan": "pro",
		"limits": map[string]any{"teams": map[string]any{"limit": 6, "policy": "block"}}}); isErr {
		t.Errorf("admin MCP update_plan: %q", text)
	}
	plans := adm.must("GET", "/api/admin/plans", nil, 200)["plans"].([]any)
	for _, p := range plans {
		if m := p.(map[string]any); m["key"] == "pro" {
			if lim := m["limits"].(map[string]any)["teams"].(map[string]any)["limit"]; num(lim) != 6 {
				t.Errorf("update_plan did not stick: %v", lim)
			}
		}
	}

	audit := adm.must("GET", "/api/admin/audit?per_page=200&q="+admEmail, nil, 200)["entries"].([]any)
	seen := map[string]bool{}
	for _, e := range audit {
		m := e.(map[string]any)
		if m["actor_email"] == admEmail { // the test database keeps earlier runs' entries
			seen[m["action"].(string)+"/"+m["via"].(string)] = true
		}
	}
	for _, want := range []string{"workspace.plan_changed/rest", "workspace.overrides_changed/rest", "workspace.suspended/rest",
		"workspace.reactivated/rest", "user.suspended/rest", "user.reactivated/rest", "user.signed_out/rest",
		"workspace.plan_changed/mcp", "plan.updated/mcp"} {
		if !seen[want] {
			t.Errorf("audit log misses %s (have %v)", want, seen)
		}
	}

	// 8. Delete needs the slug.
	gone := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Doomed " + rnd()}, 201)["workspace"].(map[string]any)
	owner.ws = gone["id"].(string)
	owner.must("POST", "/api/w/projects", map[string]any{"name": "Doomed project"}, 201)
	if code, _ := adm.do("POST", "/api/admin/workspaces/"+gone["id"].(string)+"/delete", map[string]string{"confirm": "nope"}); code != 422 {
		t.Errorf("delete without the slug: %d", code)
	}
	adm.must("POST", "/api/admin/workspaces/"+gone["id"].(string)+"/delete", map[string]string{"confirm": gone["slug"].(string)}, 204)
	if code, _ := adm.do("GET", "/api/admin/workspaces/"+gone["id"].(string), nil); code != 404 {
		t.Errorf("deleted workspace still there: %d", code)
	}
	if code, _ := adm.do("POST", "/api/admin/workspaces/platform/suspend", map[string]string{}); code != 409 {
		t.Errorf("the platform workspace must not be suspended: %d", code)
	}

	// Platform admins act in the platform workspace (the issues board) without a membership.
	adm.ws = "platform"
	adm.must("GET", "/api/w/issues", nil, 200)
	owner.ws = "platform"
	if code, _ := owner.do("GET", "/api/w/issues", nil); code != 404 {
		t.Errorf("a normal user must not reach the platform workspace: %d", code)
	}

	// Existing workspaces are grandfathered to unlimited by the migration (once).
	var legacy string
	if err := a.SysDB.QueryRow(`INSERT INTO workspaces (slug, name, created_by, plan) VALUES ($1, 'Legacy', $2, 'free') RETURNING id`,
		"legacy-"+rnd(), ownerID).Scan(&legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SysDB.Exec(`DELETE FROM platform_meta WHERE key = 'plans_grandfathered'`); err != nil {
		t.Fatal(err)
	}
	if err := migrate.Run(context.Background(), a.SysDB, testAppURL(), "../..", func(string, ...any) {}); err != nil {
		t.Fatal(err)
	}
	var plan string
	_ = a.SysDB.QueryRow(`SELECT plan FROM workspaces WHERE id = $1`, legacy).Scan(&plan)
	if plan != "unlimited" {
		t.Errorf("an existing workspace must move to unlimited: %s", plan)
	}
	if _, err := a.SysDB.Exec(`UPDATE workspaces SET plan = 'free' WHERE id = $1`, legacy); err != nil {
		t.Fatal(err)
	}
	if err := migrate.Run(context.Background(), a.SysDB, testAppURL(), "../..", func(string, ...any) {}); err != nil {
		t.Fatal(err)
	}
	_ = a.SysDB.QueryRow(`SELECT plan FROM workspaces WHERE id = $1`, legacy).Scan(&plan)
	if plan != "free" {
		t.Errorf("the grandfathering runs once; a later migrate must not touch plans: %s", plan)
	}
}
