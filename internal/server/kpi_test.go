package server

/*
TestKPI: the employee KPI end to end.

A member tracks time on two days, completes an assigned task, has their agent (MCP token) push AI
usage and work an issue (plan → answer a mention → finish), and a manager maps them to a GitHub
login + e-mail (manual). GitHub events are inserted directly (no GitHub here) under that login,
under that e-mail, under someone else's login and outside the range. A manager reviews them. The
KPI numbers are asserted; a member reads only their own KPI (and no AI cost); another workspace
gets 404; the MCP employee_kpi dossier carries the numbers; the team table has a row per
employee. Finally "Connect GitHub" (OAuth) runs against a fake GitHub: nonce cookie, state,
verified e-mails only.
*/

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestKPI(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "kowner")
	mem, memID, memEmail := signup(t, a, srv.URL, "kmember")
	outsider, _, _ := signup(t, a, srv.URL, "koutsider")
	wsObj := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "KPI " + rnd()}, 201)["workspace"].(map[string]any)
	ws, slug := wsObj["id"].(string), wsObj["slug"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, memID); err != nil {
		t.Fatal(err)
	}
	owner.ws, mem.ws = ws, ws
	outsider.ws = outsider.must("POST", "/api/me/workspaces", map[string]string{"name": "Other " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)

	projName := "KPI app " + rnd()
	proj := owner.must("POST", "/api/w/projects", map[string]any{"name": projName, "visibility": "workspace"}, 201)
	pid := proj["id"].(string)
	done := proj["statuses"].([]any)[5].(map[string]any)["id"].(string)

	now := time.Now().UTC()
	day := func(n int) string { return now.AddDate(0, 0, n).Format("2006-01-02") }
	from, to := day(-7), day(0)
	rng := "?from=" + from + "&to=" + to

	// Time: 90 billable minutes yesterday, 30 non-billable minutes two days ago.
	mem.must("POST", "/api/w/time/entries", map[string]any{"project": pid, "date": day(-1), "minutes": 90, "billable": true, "description": "build"}, 201)
	mem.must("POST", "/api/w/time/entries", map[string]any{"project": pid, "date": day(-2), "minutes": 30, "billable": false, "description": "review"}, 201)

	// Tasks: one assigned and completed, one assigned, open and overdue.
	t1 := owner.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "Ship it", "assignee_ids": []string{memID}}, 201)
	owner.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "Late one", "assignee_ids": []string{memID}, "due_at": day(-3)}, 201)
	mem.must("PATCH", "/api/w/tasks/"+t1["key"].(string), map[string]any{"status": done}, 200)

	// The member's agent: AI usage over MCP.
	tok := mem.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "agent " + rnd(), "scopes": []string{"kpi:read", "ai:record"}}, 201)
	agent := newClient(t, srv.URL)
	agent.bearer = tok["plaintext"].(string)
	call := func(tool string, args map[string]any) (string, bool) {
		t.Helper()
		code, out, _ := rpc(t, agent, "tools/call", map[string]any{"name": tool, "arguments": args})
		if code != 200 || out["error"] != nil {
			t.Fatalf("%s: %d %v", tool, code, out)
		}
		res := out["result"].(map[string]any)
		isErr, _ := res["isError"].(bool)
		return res["content"].([]any)[0].(map[string]any)["text"].(string), isErr
	}
	if text, isErr := call("record_ai_usage", map[string]any{"project": pid, "rows": []map[string]any{
		{"day": day(-1), "model": "claude-opus-5", "input_tokens": 1000, "output_tokens": 500, "cost": "3.00"},
	}}); isErr {
		t.Fatalf("record_ai_usage: %s", text)
	}

	// The agent works an issue: plan, a human @agent mention answered, finished (inserted as the
	// lifecycle writes them — the issue tools are covered by TestIssueLoop).
	var repID string
	if err := a.SysDB.QueryRow(`INSERT INTO reports (workspace_id, project_id, number, key, title, status, state, agent_seconds, finished_at, closed_at)
		VALUES ($1, $2, 900001, 'MG-900001', 'Fix login', 'done', 'closed', 600, now(), now()) RETURNING id`, ws, pid).Scan(&repID); err != nil {
		t.Fatal(err)
	}
	for i, c := range []struct{ kind, author, body string }{
		{"agent", memID, "**Plan**\n\nFix the cookie."},
		{"user", "", "@agent also check the logout"},
		{"agent", memID, "Checked the logout too."},
		{"agent", memID, "**Done.**\n\nShipped."},
	} {
		if _, err := a.SysDB.Exec(`INSERT INTO report_comments (workspace_id, report_id, author_id, author_kind, body, created_at)
			VALUES ($1, $2, NULLIF($3, ''), $4, $5, now() - make_interval(mins => $6))`, ws, repID, c.author, c.kind, c.body, 10-i); err != nil {
			t.Fatal(err)
		}
	}

	// GitHub: a manual mapping (members cannot map), then events.
	if code, _ := mem.do("PUT", "/api/w/members/"+memID+"/github", map[string]any{"login": "dev-octo"}); code != 403 {
		t.Errorf("a member mapped a GitHub account: %d", code)
	}
	gh := owner.must("PUT", "/api/w/members/"+memEmail+"/github", map[string]any{"login": "Dev-Octo", "emails": []string{"Dev.Commits@Example.test"}}, 200)
	if acc := gh["account"].(map[string]any); acc["connected_via"] != "manual" || acc["login"] != "Dev-Octo" {
		t.Errorf("mapping: %v", gh)
	}
	for i, e := range []struct {
		kind, login, email, status string
		ago                        time.Duration
	}{
		{"commit", "dev-octo", "", "", time.Hour},                       // by login, case-insensitive
		{"commit", "", "dev.commits@example.test", "", 2 * time.Hour},   // by e-mail only
		{"pull_request", "dev-octo", "", "merged", 3 * time.Hour},       // merged PR
		{"deployment", "dev-octo", "", "success", 4 * time.Hour},        // deployment
		{"commit", "someone-else", "other@example.test", "", time.Hour}, // not theirs
		{"commit", "dev-octo", "", "", 40 * 24 * time.Hour},             // outside the range
	} {
		if _, err := a.SysDB.Exec(`INSERT INTO github_events (workspace_id, project_id, kind, external_id, repo, author_login, author_email, title, status, occurred_at)
			VALUES ($1, $2, $3, $4, 'acme/app', $5, $6, $4, $7, $8)`, ws, pid, e.kind, "ev-"+rnd()+string(rune('a'+i)), e.login, e.email, e.status, now.Add(-e.ago)); err != nil {
			t.Fatal(err)
		}
	}

	// A review by the manager (members cannot write one, nobody reviews themself).
	if code, _ := mem.do("POST", "/api/w/members/"+memID+"/reviews", map[string]any{"period_start": from, "period_end": to, "body": "self"}); code != 403 {
		t.Errorf("a member wrote a review: %d", code)
	}
	if code, _ := owner.do("POST", "/api/w/members/me/reviews", map[string]any{"period_start": from, "period_end": to, "body": "self"}); code != 422 {
		t.Errorf("a self review: %d", code)
	}
	owner.must("POST", "/api/w/members/"+memID+"/reviews", map[string]any{"period_start": from, "period_end": to, "rating": 4, "body": "Solid week.\nShipped the login fix."}, 201)

	// ---- the manager's view --------------------------------------------------------------------
	k := owner.must("GET", "/api/w/members/"+memID+"/kpi"+rng, nil, 200)
	sec := func(m map[string]any, keys ...string) float64 {
		var v any = m
		for _, key := range keys {
			v = v.(map[string]any)[key]
		}
		return num(v)
	}
	checks := map[string][2]float64{
		"time.tracked_s":       {sec(k, "time", "tracked_s"), 7200},
		"time.billable_s":      {sec(k, "time", "billable_s"), 5400},
		"time.days_tracked":    {sec(k, "time", "days_tracked"), 2},
		"tasks.completed":      {sec(k, "tasks", "completed"), 1},
		"tasks.open_assigned":  {sec(k, "tasks", "open_assigned"), 1},
		"tasks.overdue":        {sec(k, "tasks", "overdue"), 1},
		"issues.started":       {sec(k, "issues", "started"), 1},
		"issues.finished":      {sec(k, "issues", "finished"), 1},
		"issues.agent_seconds": {sec(k, "issues", "agent_seconds"), 600},
		"issues.mentions":      {sec(k, "issues", "mentions_answered"), 1},
		"ai.input_tokens":      {sec(k, "ai", "input_tokens"), 1000},
		"ai.cost_minor":        {sec(k, "ai", "cost_minor"), 300},
		"github.commits":       {sec(k, "github", "commits"), 2},
		"github.pull_requests": {sec(k, "github", "pull_requests"), 1},
		"github.prs_merged":    {sec(k, "github", "prs_merged"), 1},
		"github.deployments":   {sec(k, "github", "deployments"), 1},
		"reviews.count":        {sec(k, "reviews", "count"), 1},
		"reviews.avg_rating":   {sec(k, "reviews", "avg_rating"), 4},
	}
	for name, c := range checks {
		if c[0] != c[1] {
			t.Errorf("%s = %v, want %v", name, c[0], c[1])
		}
	}
	if n := sec(k, "activity", "mcp_actions"); n < 1 {
		t.Errorf("the agent's MCP writes are counted: %v", n)
	}
	if bp := k["time"].(map[string]any)["by_project"].([]any); len(bp) != 1 || bp[0].(map[string]any)["name"] != projName {
		t.Errorf("time by project: %v", bp)
	}

	// ---- the member's own view: allowed, without AI cost; someone else's: refused -----------------
	own := mem.must("GET", "/api/w/members/me/kpi"+rng, nil, 200)
	if own["ai"].(map[string]any)["cost_minor"] != nil || sec(own, "ai", "input_tokens") != 1000 || sec(own, "time", "tracked_s") != 7200 {
		t.Errorf("own KPI (tokens yes, cost no): %v", own["ai"])
	}
	var ownerID string
	_ = a.SysDB.QueryRow(`SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`, ws).Scan(&ownerID)
	for _, p := range []string{"/api/w/members/" + ownerID + "/kpi", "/api/w/kpi/team", "/api/w/members/" + ownerID + "/reviews"} {
		if code, _ := mem.do("GET", p, nil); code != 403 {
			t.Errorf("member GET %s: %d, want 403", p, code)
		}
	}
	if rv := mem.must("GET", "/api/w/members/me/reviews", nil, 200)["reviews"].([]any); len(rv) != 1 {
		t.Errorf("a member reads their own reviews: %v", rv)
	}

	// ---- another workspace: 404 ------------------------------------------------------------------
	for _, p := range []string{"/api/w/members/" + memID + "/kpi", "/api/w/members/" + memID + "/github", "/api/w/members/" + memID + "/reviews"} {
		if code, _ := outsider.do("GET", p, nil); code != 404 {
			t.Errorf("another workspace GET %s: %d, want 404", p, code)
		}
	}

	// ---- team table and the MCP dossier ------------------------------------------------------------
	team := owner.must("GET", "/api/w/kpi/team"+rng, nil, 200)["rows"].([]any)
	var row map[string]any
	for _, r := range team {
		if m := r.(map[string]any); m["member"].(map[string]any)["user_id"] == memID {
			row = m
		}
	}
	if len(team) != 2 || row == nil || num(row["commits"]) != 2 || num(row["tracked_s"]) != 7200 || row["github_login"] != "Dev-Octo" {
		t.Errorf("team KPI: %v", team)
	}
	text, isErr := call("employee_kpi", map[string]any{"user": "me", "from": from, "to": to})
	if isErr {
		t.Fatalf("employee_kpi: %s", text)
	}
	for _, want := range []string{"# Employee KPI dossier — " + memEmail, "| Hours tracked | 2:00 |", "| Commits | 2 |", "| Plans posted (started) | 1 |", "> Solid week.", "GitHub: @Dev-Octo (manual"} {
		if !strings.Contains(text, want) {
			t.Errorf("employee_kpi lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "AI cost") {
		t.Error("a member's dossier shows AI cost")
	}
	if text, isErr := call("employee_kpi", map[string]any{"user": ownerID}); !isErr {
		t.Errorf("a member read the owner's KPI over MCP: %s", text)
	}
	if text, isErr := call("team_kpi", map[string]any{}); !isErr {
		t.Errorf("a member read the team KPI over MCP: %s", text)
	}
	dossier := owner.must("GET", "/api/w/members/"+memID+"/kpi/dossier"+rng, nil, 200)
	if !strings.Contains(dossier["markdown"].(string), "| AI cost | 3.00 USD |") || dossier["prompt"] == "" {
		t.Errorf("manager dossier: %v", dossier)
	}

	// ---- "Connect GitHub" against a fake GitHub ------------------------------------------------------
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/login/oauth/access_token":
			_ = r.ParseForm()
			if r.Form.Get("code") != "good" || r.Form.Get("client_secret") != "ghsecret" {
				_, _ = w.Write([]byte(`{"error":"bad_verification_code","error_description":"bad code"}`))
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"ghu_test"}`))
		case "/user":
			if r.Header.Get("Authorization") != "Bearer ghu_test" {
				w.WriteHeader(401)
				return
			}
			_, _ = w.Write([]byte(`{"id":4242,"login":"Owner-GH","email":null}`))
		case "/user/emails":
			_, _ = w.Write([]byte(`[{"email":"owner@gh.test","verified":true,"primary":true},{"email":"unverified@gh.test","verified":false}]`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer fake.Close()
	t.Setenv("GITHUB_APP_CLIENT_ID", "ghid")
	t.Setenv("GITHUB_APP_CLIENT_SECRET", "ghsecret")
	t.Setenv("GITHUB_WEB_URL", fake.URL)
	t.Setenv("GITHUB_API_URL", fake.URL)
	t.Setenv("GITHUB_USER_REDIRECT_URL", "")
	t.Setenv("APP_URL", srv.URL)
	t.Setenv("WEB_URL", "")
	st := owner.must("GET", "/api/w/me/github", nil, 200)
	if st["account"] != nil || st["oauth_available"] != true {
		t.Errorf("before connecting: %v", st)
	}
	start := owner.must("GET", "/api/w/me/github/connect?locale=ar", nil, 200)
	auth, _ := url.Parse(start["url"].(string))
	state := auth.Query().Get("state")
	if auth.Path != "/login/oauth/authorize" || auth.Query().Get("client_id") != "ghid" || auth.Query().Get("redirect_uri") != srv.URL+"/api/integrations/github/user-callback" || state == "" {
		t.Fatalf("authorize url: %s", auth)
	}
	noFollow := func(c *client) *http.Client {
		return &http.Client{Jar: c.http.Jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	cb := srv.URL + "/api/integrations/github/user-callback?code=good&state=" + url.QueryEscape(state)
	if r, err := noFollow(mem).Get(cb); err != nil || r.StatusCode != 400 {
		t.Errorf("callback in another browser (no nonce cookie): %v %v", r.StatusCode, err)
	}
	if r, _ := noFollow(owner).Get(srv.URL + "/api/integrations/github/user-callback?code=good&state=eyJ3Ijoid3MifQ.bad"); r.StatusCode != 400 {
		t.Errorf("forged state: %d", r.StatusCode)
	}
	r, err := noFollow(owner).Get(cb)
	if err != nil || r.StatusCode != 302 {
		t.Fatalf("callback: %v %v", r.StatusCode, err)
	}
	loc, _ := url.Parse(r.Header.Get("Location"))
	if loc.Path != "/ar/w/"+slug+"/me" || loc.Query().Get("github") != "connected" {
		t.Fatalf("callback redirect: %s", loc)
	}
	acc := owner.must("GET", "/api/w/me/github", nil, 200)["account"].(map[string]any)
	emails := strings.Join(func() []string {
		out := []string{}
		for _, e := range acc["emails"].([]any) {
			out = append(out, e.(string))
		}
		return out
	}(), ",")
	if acc["login"] != "Owner-GH" || acc["connected_via"] != "oauth" || num(acc["github_id"]) != 4242 ||
		!strings.Contains(emails, "owner@gh.test") || !strings.Contains(emails, "4242+owner-gh@users.noreply.github.com") || strings.Contains(emails, "unverified") {
		t.Errorf("connected account: %v", acc)
	}
	var sealed string
	_ = a.SysDB.QueryRow(`SELECT COALESCE(token_sealed, '') FROM user_github_accounts WHERE workspace_id = $1 AND login = 'Owner-GH'`, ws).Scan(&sealed)
	if sealed == "" || strings.Contains(sealed, "ghu_test") {
		t.Errorf("the user token must be stored sealed: %q", sealed)
	}
	// Mapping someone else to the same login is refused; disconnect works.
	if code, _ := owner.do("PUT", "/api/w/members/"+memID+"/github", map[string]any{"login": "owner-gh"}); code != 409 {
		t.Errorf("a login mapped twice: %d", code)
	}
	owner.must("DELETE", "/api/w/me/github", nil, 204)
	if st := owner.must("GET", "/api/w/me/github", nil, 200); st["account"] != nil {
		t.Errorf("after disconnect: %v", st)
	}
}
