package server

/*
TestCrossWorkspaceIsolation — the cross-workspace sweep (plan: tenancy step 5; P1 exit gate).

It boots the real stack (guard, generated CRUD, /api/w/* domain routes, RLS pool, MCP) against
a throwaway database, gives two users a workspace each, fills workspace A with one row of EVERY
tenant table through the real endpoints, then walks EVERY route on the router (chi.Walk — the
same list `list_routes` shows) and asserts, per route:

  1. anonymous                 -> 401 (or the route is on the public allowlist)
  2. bob + X-Workspace-ID=A    -> 404 (not a member; existence not revealed)
  3. bob + X-Workspace-ID=B, A's ids in the path -> never A's marker or ids in any body,
     never 2xx on a GET, never 2xx on ANY method of a /api/w/* route, and A's rows survive

A guarded route whose first path segment has no fixture below FAILS the test: a new route
cannot be swept with a meaningless id by accident — whoever adds it must say what it names.

After the sweep: bodies that reference A's rows from B (parent task, status, label, assignee,
client, team, member) are refused; the activity actor comes from the session even when
X-User-Id says otherwise; and the Claude-style MCP flow (create_task -> move_task ->
comment_task) lands on the board.

Run it with a dedicated database (it creates users and workspaces):

	TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55460/managy_test?sslmode=disable \
	TEST_APP_DATABASE_URL=postgres://managy_app_test:test@localhost:55460/managy_test?sslmode=disable \
	go test -count=1 ./internal/server/ -run Isolation -v
*/

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/db/migrate"
	"github.com/fadymondy/mahaam/internal/mcp"
	_ "github.com/fadymondy/mahaam/internal/plugins"
)

func rnd() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type client struct {
	t      *testing.T
	base   string
	http   *http.Client
	csrf   string
	ws     string
	bearer string
	extra  map[string]string
}

func newClient(t *testing.T, base string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: base, http: &http.Client{Jar: jar}}
}

func (c *client) ensureCSRF() {
	if c.csrf != "" {
		return
	}
	r, err := c.http.Get(c.base + "/api/auth/csrf")
	if err != nil {
		c.t.Fatal(err)
	}
	var out struct {
		Token string `json:"csrf_token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&out)
	r.Body.Close()
	c.csrf = out.Token
}

func (c *client) send(req *http.Request, method string) (int, []byte) {
	c.t.Helper()
	// The per-user realtime stream never ends by itself: read what it sends in two seconds.
	if strings.HasSuffix(req.URL.Path, "/events") {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		req = req.WithContext(ctx)
	}
	if c.ws != "" {
		req.Header.Set("X-Workspace-ID", c.ws)
	}
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	for k, v := range c.extra {
		req.Header.Set(k, v)
	}
	if method != http.MethodGet && method != http.MethodHead && c.bearer == "" {
		c.ensureCSRF()
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b
}

func (c *client) do(method, path string, body any) (int, []byte) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, rd)
	req.Header.Set("Content-Type", "application/json")
	return c.send(req, method)
}

func (c *client) upload(path, name string, data []byte) (int, []byte) {
	c.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	f, _ := w.CreateFormFile("file", name)
	_, _ = f.Write(data)
	_ = w.Close()
	req, _ := http.NewRequest(http.MethodPost, c.base+path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return c.send(req, http.MethodPost)
}

func (c *client) must(method, path string, body any, want int) map[string]any {
	c.t.Helper()
	code, b := c.do(method, path, body)
	if code != want {
		c.t.Fatalf("%s %s: got %d want %d: %s", method, path, code, want, b)
	}
	out := map[string]any{}
	_ = json.Unmarshal(b, &out)
	return out
}

func mcpCall(c *client, endpoint, tool string, args map[string]any) (int, string, bool) {
	c.t.Helper()
	code, b := c.do(http.MethodPost, endpoint, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "tools/call",
		"params": map[string]any{"name": tool, "arguments": args},
	})
	var res struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	_ = json.Unmarshal(b, &res)
	text := ""
	if len(res.Result.Content) > 0 {
		text = res.Result.Content[0].Text
	}
	return code, text, res.Result.IsError
}

func TestCrossWorkspaceIsolation(t *testing.T) {
	owner, appURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_APP_DATABASE_URL")
	if owner == "" || appURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_APP_DATABASE_URL (a throwaway database) to run the isolation sweep")
	}
	t.Setenv("DATABASE_URL", owner)
	t.Setenv("APP_DATABASE_URL", appURL)
	t.Setenv("DB_DRIVER", "pgx")
	t.Setenv("AUTH_SECRET", "isolation-test-secret-isolation-test-secret-0123")
	t.Setenv("STORAGE_DIR", t.TempDir())
	// Workspaces created by these tests start unlimited (the plan tests move them explicitly).
	t.Setenv("PLAN_DEFAULT", "unlimited")

	// Migrate the test database exactly as `togo migrate` would.
	k0 := togo.New()
	sys, err := k0.SQL(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate.Run(context.Background(), sys, appURL, "../..", t.Logf); err != nil {
		t.Fatal(err)
	}
	k0.Close()

	a := Boot()
	defer a.Kernel.Close()
	srv := httptest.NewServer(a.Kernel.Handler())
	defer srv.Close()

	// ---- two tenants -------------------------------------------------------
	marker := "ISO-A-SECRET-" + rnd()
	alice, bob := newClient(t, srv.URL), newClient(t, srv.URL)
	aliceEmail, bobEmail := "alice-"+rnd()+"@example.test", "bob-"+rnd()+"@example.test"
	alice.must("POST", "/api/auth/register", map[string]string{"email": aliceEmail, "password": "correct-horse-1"}, 201)
	bob.must("POST", "/api/auth/register", map[string]string{"email": bobEmail, "password": "correct-horse-2"}, 201)
	var aliceID, bobID string
	_ = a.SysDB.QueryRow(`SELECT id FROM users WHERE email = $1`, aliceEmail).Scan(&aliceID)
	_ = a.SysDB.QueryRow(`SELECT id FROM users WHERE email = $1`, bobEmail).Scan(&bobID)

	wsA := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Iso A " + rnd()}, 201)["workspace"].(map[string]any)
	wsB := bob.must("POST", "/api/me/workspaces", map[string]string{"name": "Iso B " + rnd()}, 201)["workspace"].(map[string]any)
	aID, bID := wsA["id"].(string), wsB["id"].(string)

	// ---- one row of every tenant table in A --------------------------------
	alice.ws = aID
	inv := alice.must("POST", "/api/w/invitations", map[string]string{"email": "carol-" + rnd() + "@example.test", "role": "member"}, 201)
	invID := inv["invitation"].(map[string]any)["id"].(string)
	tok := alice.must("POST", "/api/w/mcp_tokens", map[string]any{"name": marker,
		"scopes": []string{"members:read", "feedback:read", "projects:read", "tasks:read", "tasks:write", "clients:read"}}, 201)
	tokID := tok["token"].(map[string]any)["id"].(string)
	aliceToken := tok["plaintext"].(string)
	rep := alice.must("POST", "/api/reports", map[string]any{
		"workspace_id": aID, "number": 1, "key": "MG-1", "title": marker, "issue_type": "bug", "status": "backlog",
		"state": "open", "priority": "medium", "sort_order": 0, "agent_seconds": 0, "human_only": false,
	}, 201)
	repID := rep["id"].(string)
	com := alice.must("POST", "/api/report_comments", map[string]any{
		"workspace_id": aID, "report_id": repID, "author_kind": "user", "body": marker,
	}, 201)
	comID := com["id"].(string)
	var memberID string
	if err := a.SysDB.QueryRow(`SELECT id FROM workspace_members WHERE workspace_id = $1`, aID).Scan(&memberID); err != nil {
		t.Fatal(err)
	}

	// P1 rows, all through the real /api/w/* endpoints.
	clID := alice.must("POST", "/api/w/clients", map[string]any{"name": marker + " client", "email": "ap@example.test"}, 201)["id"].(string)
	teamID := alice.must("POST", "/api/w/teams", map[string]any{"name": marker + " team", "member_ids": []string{aliceID}}, 201)["id"].(string)
	proj := alice.must("POST", "/api/w/projects", map[string]any{"name": marker + " project", "client_id": clID, "visibility": "members"}, 201)
	prID := proj["id"].(string)
	statuses := proj["statuses"].([]any)
	if len(statuses) != 4 {
		t.Fatalf("a new project should get 4 default statuses, got %d", len(statuses))
	}
	stTodo := statuses[0].(map[string]any)["id"].(string)
	stDone := statuses[3].(map[string]any)["id"].(string)
	alice.must("PUT", "/api/w/projects/"+prID+"/teams/"+teamID, nil, 200)
	lbID := alice.must("POST", "/api/w/labels", map[string]any{"name": marker + "-label", "color": "teal"}, 201)["id"].(string)
	task := alice.must("POST", "/api/w/projects/"+prID+"/tasks", map[string]any{
		"title": marker + " task", "label_ids": []string{lbID}, "assignee_ids": []string{aliceID}, "priority": "high",
	}, 201)
	tkID, tkKey := task["id"].(string), task["key"].(string)
	if tkKey == "MG-1" {
		t.Errorf("task reused the report's key MG-1 — tasks and reports must share one sequence")
	}
	ckID := alice.must("POST", "/api/w/tasks/"+tkKey+"/checklist", map[string]any{"title": marker}, 201)["id"].(string)
	cmID := alice.must("POST", "/api/w/tasks/"+tkKey+"/comments", map[string]any{"body": marker + " @" + strings.Split(aliceEmail, "@")[0]}, 201)["id"].(string)
	code, b := alice.upload("/api/w/tasks/"+tkKey+"/attachments", "brief.txt", []byte(marker+" file body"))
	if code != 201 {
		t.Fatalf("upload: %d %s", code, b)
	}
	var att map[string]any
	_ = json.Unmarshal(b, &att)
	atID := att["id"].(string)
	subtask := alice.must("POST", "/api/w/projects/"+prID+"/tasks", map[string]any{"title": marker + " sub", "parent": tkKey}, 201)
	if subtask["parent"] == nil {
		t.Errorf("subtask was created without its parent: %v", subtask)
	}

	rowID := func(q string) string {
		var id string
		if err := a.SysDB.QueryRow(q, aID).Scan(&id); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return id
	}
	pmID := rowID(`SELECT id FROM project_members WHERE workspace_id = $1 LIMIT 1`)
	tmID := rowID(`SELECT id FROM team_members WHERE workspace_id = $1 LIMIT 1`)
	ptID := rowID(`SELECT id FROM project_teams WHERE workspace_id = $1 LIMIT 1`)
	taID := rowID(`SELECT id FROM task_assignees WHERE workspace_id = $1 LIMIT 1`)
	tlID := rowID(`SELECT id FROM task_labels WHERE workspace_id = $1 LIMIT 1`)
	acID := rowID(`SELECT id FROM activity_logs WHERE workspace_id = $1 LIMIT 1`)

	// P2 rows: a time entry (logged yesterday), a member rate, a notification.
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	teID := alice.must("POST", "/api/w/time/entries", map[string]any{"project": prID, "description": marker + " time", "date": yesterday, "minutes": 30}, 201)["id"].(string)
	rateID := alice.must("PUT", "/api/w/rates/"+aliceID, map[string]any{"bill_rate_minor": 12000, "cost_rate_minor": 5000}, 200)["id"].(string)
	var noteID string
	if err := a.SysDB.QueryRow(`INSERT INTO notifications (workspace_id, user_id, kind, title) VALUES ($1, $2, 'time.missing_day', $3) RETURNING id`,
		aID, aliceID, marker).Scan(&noteID); err != nil {
		t.Fatal(err)
	}

	// P5 rows: a saved report view and notification settings.
	savedID := alice.must("POST", "/api/w/saved-reports", map[string]any{"name": marker + " view", "filters": map[string]any{"group_by": "member"}}, 201)["id"].(string)
	alice.must("PATCH", "/api/w/notification-settings", map[string]any{"muted_kinds": []string{"time.missing_day"}}, 200)
	prefID := rowID(`SELECT id FROM notification_prefs WHERE workspace_id = $1 LIMIT 1`)

	// P6 row: a billable hour today (rateID set alice's bill rate above) drafted into an invoice,
	// which locks that entry. The invoice's client_name carries the marker.
	today := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02") // yesterday: a 60-minute block "today" is in the future just after midnight UTC
	alice.must("POST", "/api/w/time/entries", map[string]any{"project": prID, "description": marker + " billable", "date": today, "minutes": 60, "billable": true}, 201)
	invoiceID := alice.must("POST", "/api/w/invoices/from-time", map[string]any{"client_id": clID, "tax_rate": "0.1"}, 201)["id"].(string)

	// P7: a per-project public feedback key, for /api/w/feedback-keys/{key}.
	fkID := alice.must("POST", "/api/w/projects/"+prID+"/feedback-keys", map[string]any{"name": marker + " key", "allowed_origins": []string{"https://example.com"}}, 201)["id"].(string)

	// Integrations: a Linear import connected through the real endpoint (the sealed key never
	// comes back), plus a GitHub link and a logged commit inserted directly (no GitHub here).
	// Every integration route is /api/w/projects/{project}/... (segment "projects", mapped below).
	intID := alice.must("PUT", "/api/w/projects/"+prID+"/integrations/linear", map[string]any{"team_id": marker, "api_key": marker + "-key"}, 200)["id"].(string)
	var ghEvID string
	if _, err := a.SysDB.Exec(`INSERT INTO project_integrations (workspace_id, project_id, provider, status, config, created_by)
		VALUES ($1, $2, 'github', 'active', jsonb_build_object('installation_id', '1', 'repo', $3::text), $4)`, aID, prID, "acme/"+marker, aliceID); err != nil {
		t.Fatal(err)
	}
	if err := a.SysDB.QueryRow(`INSERT INTO github_events (workspace_id, project_id, kind, external_id, title) VALUES ($1, $2, 'commit', $3, $3) RETURNING id`,
		aID, prID, marker).Scan(&ghEvID); err != nil {
		t.Fatal(err)
	}

	// Project vault: a secret (sealed) for /api/w/vault/{item}[/reveal].
	vaultID := alice.must("POST", "/api/w/projects/"+prID+"/vault", map[string]any{"kind": "secret", "title": marker + " vault", "value": marker + "-secret"}, 201)["id"].(string)

	// Access: a label grant to alice's team, for /api/w/access-grants/{grant}.
	grantID := alice.must("POST", "/api/w/access-grants", map[string]any{"subject_type": "team", "subject": teamID, "scope_type": "label", "scope": lbID}, 201)["id"].(string)

	// Billing sources: a subscription on A's project (for /api/w/subscriptions/{subscription}) and
	// a day of AI usage (listed by /api/w/ai-usage, which must stay inside workspace A).
	subID := alice.must("POST", "/api/w/projects/"+prID+"/subscriptions", map[string]any{"name": marker + " sub", "price": "10.00"}, 201)["id"].(string)
	aiRows := alice.must("POST", "/api/w/projects/"+prID+"/ai-usage", map[string]any{"rows": []map[string]any{
		{"day": today, "model": marker, "cost": "1.00"}}}, 200)["rows"].([]any)
	aiID := aiRows[0].(map[string]any)["id"].(string)

	// Roadmap 5: a pending customer request in A's project, for /api/w/requests/{key}/*. Its row
	// id (not its MG-n key, which B has too) fills the path.
	reqKey := alice.must("POST", "/api/w/portal/requests", map[string]any{"project_id": prID, "title": marker + " request", "kind": "feature"}, 201)["key"].(string)
	reqID := rowID(`SELECT id FROM reports WHERE workspace_id = $1 AND request_state = 'pending' AND key = '` + reqKey + `'`)

	// Employee KPI: a manual GitHub mapping for alice and a review of her (inserted directly: nobody
	// reviews themself through the API), for /api/w/members/{user}/{kpi,github,reviews} and
	// /api/w/reviews/{review}. GET /api/w/kpi/team is unparameterised (below).
	alice.must("PUT", "/api/w/members/"+aliceID+"/github", map[string]any{"login": "iso-a-" + rnd(), "emails": []string{"a-" + rnd() + "@example.test"}}, 200)
	ughID := rowID(`SELECT id FROM user_github_accounts WHERE workspace_id = $1 LIMIT 1`)
	var reviewID string
	if err := a.SysDB.QueryRow(`INSERT INTO member_reviews (workspace_id, user_id, author_id, period_start, period_end, rating, body)
		VALUES ($1, $2, $2, current_date, current_date, 3, $3) RETURNING id`, aID, aliceID, marker+" review").Scan(&reviewID); err != nil {
		t.Fatal(err)
	}

	aIDs := []string{aID, invID, tokID, repID, comID, memberID, clID, teamID, prID, stTodo, stDone, lbID, tkID,
		ckID, cmID, atID, pmID, tmID, ptID, taID, tlID, acID, teID, rateID, noteID, savedID, prefID, invoiceID, fkID, intID, ghEvID, vaultID, grantID, subID, aiID, reqID, ughID, reviewID}

	// idFor names the A row a route's path parameters are filled with, by the route's first
	// segment after /api/ (or /api/w/). A guarded route whose segment is missing here fails.
	idFor := map[string]string{
		// generated CRUD (/api/<table>/{id})
		"workspaces": aID, "workspace_members": memberID, "invitations": invID, "mcp_tokens": tokID,
		"reports": repID, "report_comments": comID,
		// hand-written /api/w/issues/{key} and /api/w/issues/{key}/comments
		"issues":  repID,
		"clients": clID, "projects": prID, "project_members": pmID, "teams": teamID, "team_members": tmID,
		"project_teams": ptID, "task_statuses": stTodo, "tasks": tkID, "task_assignees": taID,
		"task_checklist_items": ckID, "labels": lbID, "task_labels": tlID, "task_comments": cmID,
		"attachments": atID, "activity_logs": acID,
		// hand-written /api/w/<segment>/{...}
		"statuses": stTodo, "checklist": ckID, "comments": cmID,
		// P2: generated CRUD, and /api/w/time/entries/{entry}, /api/w/rates/{user},
		// /api/w/member-rates/{rate}, /api/w/notifications/{notification}/read
		"time_entries": teID, "member_rates": rateID, "notifications": noteID,
		"time": teID, "rates": aliceID, "member-rates": rateID,
		// P5: generated CRUD, /api/w/saved-reports/{saved}; /api/w/projects/{project}/budget uses "projects"
		"saved_reports": savedID, "notification_prefs": prefID, "saved-reports": savedID,
		// P6: /api/w/invoices/{invoice}[/payments|/export|/print], and the client-scoped
		// /api/w/clients/{client}/{invoices,unbilled} (segment "clients", already mapped).
		"invoices": invoiceID,
		// P7: /api/w/feedback-keys/{key}[/revoke]. The client-portal contact routes
		// /api/w/clients/{client}/contacts[/{user}] use segment "clients" (mapped above).
		"feedback-keys": fkID,
		// /api/w/vault/{item}[/reveal]; /api/w/projects/{project}/vault* use "projects".
		"vault": vaultID,
		// /api/w/access-grants/{grant}; /api/w/projects/{project}/project-labels use "projects".
		"access-grants": grantID,
		// /api/w/subscriptions/{subscription}; …/ai-usage, …/ai-markup and …/subscriptions under
		// "projects". GET /api/w/ai-usage is unparameterised (below).
		"subscriptions": subID,
		// Roadmap 5: /api/w/portal/projects/{project} and /api/w/portal/issues/{key}[/comments]
		// (one fixture per segment: A's project id — an unknown issue ref is a 404 all the same),
		// and the staff inbox /api/w/requests/{key}/{accept,decline,convert-to-task}.
		"portal":   prID,
		"requests": reqID,
		// Employee KPI: /api/w/members/{user}/{kpi[/dossier],github,reviews} (A's member alice — a user
		// outside B is a 404 there) and /api/w/reviews/{review}. /api/w/me/github* use "me".
		"members": aliceID,
		"reviews": reviewID,
	}
	// Guarded routes without path parameters, by segment. Anything else is unknown.
	unparameterised := map[string]bool{
		"workspace": true, // DELETE /api/w/workspace — the owner deletes their own workspace (slug-confirmed)
		"ai-usage": true, // the workspace AI usage summary (manager+)
		"current":  true, "members": true, "activity": true, "me": true, "graphql": true,
		"feedback": true, // the signed-in "Report a problem" intake (reports land in the platform workspace)
		"events":   true, // P2: the per-user realtime stream (read with a timeout, see send)
		// P5: /api/w/report/{time,export,budgets,profitability}, /api/w/notification-settings
		"report": true, "notification-settings": true,
		// P7: the client's own portal reads/writes (GET issues|invoices, POST issues) —
		// collection routes scoped to the caller, no path parameter.
		"portal":  true,
		"kpi":     true, // GET /api/w/kpi/team (manager+, the caller's workspace)
		"plan":    true, // GET /api/w/plan: the workspace's plan and usage (admin+)
		"billing": true, // GET /api/w/billing, POST /api/w/billing/{checkout,portal} (admin+)
	}

	leaks := func(b []byte) string {
		s := string(b)
		if strings.Contains(s, marker) {
			return "marker"
		}
		for _, id := range aIDs {
			if strings.Contains(s, id) {
				return "id " + id
			}
		}
		return ""
	}

	// ---- sweep every route -------------------------------------------------
	type route struct{ method, pattern string }
	var routes []route
	_ = chi.Walk(a.Kernel.Router, func(method, pattern string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes = append(routes, route{method, pattern})
		return nil
	})

	param := regexp.MustCompile(`\{[^}]+\}`)
	swept, swept1 := 0, 0
	anon := newClient(t, srv.URL)
	for _, rt := range routes {
		if !strings.HasPrefix(rt.pattern, "/api/") && rt.pattern != "/graphql" {
			continue // pages, docs, playground
		}
		probe, _ := http.NewRequest(rt.method, srv.URL+rt.pattern, nil)
		probe.URL.Path = rt.pattern
		if classify(probe) == tierPublic || classify(probe) == tierBlocked {
			continue // the allowlist is reviewed in guard.go; MCP is swept below
		}
		// The platform admin panel (/api/admin/*, not the admin MCP): not discoverable — anonymous
		// and a signed-in non-admin (bob, in either workspace) both get 404, with A's ids in the
		// path, on every method. Admins are exercised in TestPlatformAdmin.
		if classify(probe) == tierAdmin {
			path := strings.NewReplacer("{workspace}", aID, "{user}", aliceID, "{plan}", "free").Replace(rt.pattern)
			if param.MatchString(path) {
				t.Errorf("UNKNOWN ADMIN ROUTE %s %s: map its parameter in the sweep", rt.method, rt.pattern)
				continue
			}
			swept++
			if code, b := anon.do(rt.method, path, map[string]any{}); code != http.StatusNotFound {
				t.Errorf("%s %s anonymous: got %d, want 404: %s", rt.method, rt.pattern, code, b)
			}
			for _, ws := range []string{aID, bID} {
				bob.ws = ws
				code, b := bob.do(rt.method, path, map[string]any{})
				if code != http.StatusNotFound {
					t.Errorf("%s %s as a non-admin: got %d, want 404: %s", rt.method, rt.pattern, code, b)
				}
				if what := leaks(b); what != "" {
					t.Errorf("%s %s as a non-admin leaked A's %s", rt.method, rt.pattern, what)
				}
			}
			continue
		}
		segs := strings.Split(strings.TrimPrefix(rt.pattern, "/api/"), "/")
		table := segs[0]
		handWritten := table == "w"
		if handWritten && len(segs) > 1 {
			table = segs[1]
		}
		if rt.pattern == "/graphql" {
			table = "graphql"
		}
		hasParam := strings.Contains(rt.pattern, "{")
		fixture, known := idFor[table]
		if hasParam && !known {
			t.Errorf("UNKNOWN ROUTE %s %s: no fixture id for %q — add a row of it to workspace A and map it in idFor", rt.method, rt.pattern, table)
			continue
		}
		if !hasParam && !known && !unparameterised[table] {
			t.Errorf("UNKNOWN ROUTE %s %s: segment %q is not in the sweep's route map", rt.method, rt.pattern, table)
			continue
		}
		path := param.ReplaceAllString(rt.pattern, fixture)
		if !hasParam {
			path = rt.pattern
		}
		var body any = map[string]any{}
		if rt.pattern == "/graphql" {
			body = map[string]any{"query": "{ reports { id title } workspaces { id name } reportComments { id body } tasks { id title } projects { id name } }"}
		}
		swept++
		if handWritten && strings.HasPrefix(rt.pattern, "/api/w/") && hasParam {
			swept1++
		}
		name := rt.method + " " + rt.pattern

		// 1. anonymous
		if code, b := anon.do(rt.method, path, body); code != http.StatusUnauthorized {
			t.Errorf("%s anonymous: got %d, want 401: %s", name, code, b)
		}

		tier := classify(probe)
		if tier == tierWorkspace {
			// 2. bob naming A
			bob.ws = aID
			if code, b := bob.do(rt.method, path, body); code != http.StatusNotFound {
				t.Errorf("%s as a non-member of A: got %d, want 404: %s", name, code, b)
			}
		}

		// 3. bob in his own workspace, A's ids in the path
		bob.ws = bID
		code, b := bob.do(rt.method, path, body)
		if what := leaks(b); what != "" {
			t.Errorf("%s from B leaked A's %s (status %d): %s", name, what, code, b)
		}
		if hasParam && rt.method == http.MethodGet && code/100 == 2 {
			t.Errorf("%s from B with A's id answered %d", name, code)
		}
		if hasParam && handWritten && code/100 == 2 {
			t.Errorf("%s from B with A's id answered %d — a domain route must 404 another workspace's row", name, code)
		}
	}
	if swept < 60 || swept1 < 30 {
		t.Fatalf("swept only %d routes (%d parameterised domain routes) — the walk is broken", swept, swept1)
	}
	t.Logf("swept %d guarded routes x 3 callers (%d parameterised /api/w/* routes)", swept, swept1)

	// Unknown routes are 404 for a member, on the generic tree and the domain tree alike.
	alice.ws = aID
	for _, p := range []string{"/api/not_a_table", "/api/not_a_table/" + tkID, "/api/w/not-a-route", "/api/w/tasks/" + tkID + "/nope"} {
		if code, b := alice.do("GET", p, nil); code != http.StatusNotFound {
			t.Errorf("unknown route %s answered %d, want 404: %s", p, code, b)
		}
	}

	// A write that names A in the BODY from B is refused by RLS WITH CHECK.
	bob.ws = bID
	if code, b := bob.do("POST", "/api/reports", map[string]any{
		"workspace_id": aID, "number": 99, "key": "MG-99", "title": "planted", "issue_type": "bug", "status": "backlog",
		"state": "open", "priority": "medium", "sort_order": 0, "agent_seconds": 0, "human_only": false,
	}); code/100 == 2 {
		t.Errorf("B planted a report in A: %d %s", code, b)
	}

	// ---- B references A's rows in request bodies ----------------------------
	pB := bob.must("POST", "/api/w/projects", map[string]any{"name": "B project"}, 201)
	pBID := pB["id"].(string)
	bTask := bob.must("POST", "/api/w/projects/"+pBID+"/tasks", map[string]any{"title": "B task"}, 201)
	bKey := bTask["key"].(string)
	for label, attempt := range map[string]func() (int, []byte){
		"task with A's parent": func() (int, []byte) {
			return bob.do("POST", "/api/w/projects/"+pBID+"/tasks", map[string]any{"title": "x", "parent": tkID})
		},
		"task with A's status": func() (int, []byte) {
			return bob.do("POST", "/api/w/projects/"+pBID+"/tasks", map[string]any{"title": "x", "status": stDone})
		},
		"task with A's label": func() (int, []byte) {
			return bob.do("POST", "/api/w/projects/"+pBID+"/tasks", map[string]any{"title": "x", "label_ids": []string{lbID}})
		},
		"task assigned to alice": func() (int, []byte) {
			return bob.do("POST", "/api/w/projects/"+pBID+"/tasks", map[string]any{"title": "x", "assignee_ids": []string{aliceID}})
		},
		"project with A's client": func() (int, []byte) {
			return bob.do("POST", "/api/w/projects", map[string]any{"name": "x", "client_id": clID})
		},
		"attach A's team": func() (int, []byte) { return bob.do("PUT", "/api/w/projects/"+pBID+"/teams/"+teamID, nil) },
		"add alice to B's project": func() (int, []byte) {
			return bob.do("PUT", "/api/w/projects/"+pBID+"/members/"+aliceID, map[string]any{})
		},
		"move into A's status": func() (int, []byte) {
			return bob.do("POST", "/api/w/tasks/"+bKey+"/move", map[string]any{"status": stDone})
		},
		"label B's task with A's": func() (int, []byte) {
			return bob.do("PUT", "/api/w/tasks/"+bKey+"/labels", map[string]any{"label_ids": []string{lbID}})
		},
		"assign alice to B's task": func() (int, []byte) {
			return bob.do("PUT", "/api/w/tasks/"+bKey+"/assignees", map[string]any{"user_ids": []string{aliceID}})
		},
		"team with alice as member": func() (int, []byte) {
			return bob.do("POST", "/api/w/teams", map[string]any{"name": "x", "member_ids": []string{aliceID}})
		},
	} {
		// A refusal may echo the id B itself sent ("unknown client <id>") — the same words
		// whether or not the id exists in A, so it confirms nothing. Anything else of A's is a leak.
		echo := strings.NewReplacer(tkID, "", stDone, "", lbID, "", clID, "", teamID, "")
		if code, b := attempt(); code/100 == 2 || leaks([]byte(echo.Replace(string(b)))) != "" {
			t.Errorf("B %s: %d %s", label, code, b)
		}
	}
	// B's own MG-1 is B's, not A's: keys are per workspace and resolve inside the caller's.
	if code, b := bob.do("GET", "/api/w/tasks/"+tkKey, nil); leaks(b) != "" {
		t.Errorf("B resolving A's key %s leaked (status %d): %s", tkKey, code, b)
	}

	// ---- A survived every write attempt -------------------------------------
	alice.ws = aID
	for path, want := range map[string]string{
		"/api/reports/" + repID:           marker,
		"/api/report_comments/" + comID:   marker,
		"/api/w/tasks/" + tkID:            marker,
		"/api/w/projects/" + prID:         marker,
		"/api/w/clients/" + clID:          marker,
		"/api/w/time/entries/" + teID:     marker,
		"/api/w/saved-reports/" + savedID: marker,
		"/api/w/invoices/" + invoiceID:    marker, // the invoice's client_name carries the marker
	} {
		if code, b := alice.do("GET", path, nil); code != 200 || !strings.Contains(string(b), want) {
			t.Errorf("A's row at %s was damaged from B: %d %s", path, code, b)
		}
	}
	if code, b := alice.do("GET", "/api/w/invitations", nil); code != 200 || !strings.Contains(string(b), invID) {
		t.Errorf("A's invitation was removed from B: %d %s", code, b)
	}
	var planted int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM reports WHERE workspace_id = $1 AND request_state IS NULL`, aID).Scan(&planted)
	if planted != 1 {
		t.Errorf("A should have exactly 1 report, has %d", planted)
	}
	// ...and its one customer request is still pending (B could not accept, decline or convert it).
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM reports WHERE workspace_id = $1 AND request_state = 'pending'`, aID).Scan(&planted)
	if planted != 1 {
		t.Errorf("A's request should still be pending, found %d pending", planted)
	}
	var aTasks int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM tasks WHERE workspace_id = $1`, aID).Scan(&aTasks)
	if aTasks != 2 {
		t.Errorf("A should have exactly 2 tasks, has %d", aTasks)
	}
	if code, b := alice.do("GET", "/api/w/attachments/"+atID, nil); code != 200 || !strings.Contains(string(b), marker+" file body") {
		t.Errorf("A's attachment should download for alice: %d %s", code, b)
	}

	// ---- activity: the actor is the session, never a header ------------------
	alice.extra = map[string]string{"X-User-Id": bobID, "X-Forwarded-For": "6.6.6.6"}
	spoof := alice.must("POST", "/api/w/tasks/"+tkKey+"/comments", map[string]any{"body": "spoof attempt"}, 201)
	alice.extra = nil
	var actor, via, ip string
	if err := a.SysDB.QueryRow(`SELECT actor_id, actor_via, ip FROM activity_logs WHERE workspace_id = $1 AND subject_id = $2`,
		aID, spoof["id"]).Scan(&actor, &via, &ip); err != nil {
		t.Fatal(err)
	}
	if actor != aliceID || via != "session" || ip == "6.6.6.6" {
		t.Errorf("activity must record the session user and RemoteAddr, got actor=%s via=%s ip=%s", actor, via, ip)
	}
	// The app role cannot rewrite history.
	if code, _ := alice.do("DELETE", "/api/activity_logs/"+acID, nil); code/100 == 2 {
		t.Errorf("activity entries must not be deletable through the generic API (got %d)", code)
	}

	// ---- board order persists -------------------------------------------------
	second := alice.must("POST", "/api/w/projects/"+prID+"/tasks", map[string]any{"title": "second"}, 201)
	alice.must("POST", "/api/w/tasks/"+second["key"].(string)+"/move", map[string]any{"status": stTodo, "index": 0}, 200)
	board := alice.must("GET", "/api/w/projects/"+prID+"/board", nil, 200)
	var todo []string
	for _, x := range board["tasks"].([]any) {
		tk := x.(map[string]any)
		if tk["status_id"] == stTodo {
			todo = append(todo, tk["key"].(string))
		}
	}
	if len(todo) < 2 || todo[0] != second["key"] {
		t.Errorf("moving %s to index 0 did not persist; To do column is %v", second["key"], todo)
	}

	// ---- account level: bob's list never shows A ----------------------------
	bob.ws = ""
	if _, b := bob.do("GET", "/api/me/workspaces", nil); leaks(b) != "" {
		t.Errorf("/api/me/workspaces leaked A to bob: %s", b)
	}

	// ---- MCP: a token acts only in its own workspace -------------------------
	bob.ws = bID
	btok := bob.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "bob agent", "scopes": []string{"members:read", "tasks:read"}}, 201)
	bobMCP := newClient(t, srv.URL)
	bobMCP.bearer = btok["plaintext"].(string)
	if code, text, isErr := mcpCall(bobMCP, "/api/mcp", "whoami", nil); code != 200 || isErr || !strings.Contains(text, bID) || strings.Contains(text, aID) {
		t.Errorf("bob's whoami: %d %v %q", code, isErr, text)
	}
	if _, text, isErr := mcpCall(bobMCP, "/api/mcp", "list_feedback", nil); !isErr || !strings.Contains(text, "feedback:read") {
		t.Errorf("an out-of-scope call must fail in-band naming the scope, got isErr=%v %q", isErr, text)
	}
	if _, text, isErr := mcpCall(bobMCP, "/api/mcp", "create_task", map[string]any{"project": "B project", "title": "x"}); !isErr || !strings.Contains(text, "tasks:write") {
		t.Errorf("create_task without tasks:write must fail in-band naming the scope, got isErr=%v %q", isErr, text)
	}
	for _, ref := range []string{tkKey, tkID} {
		if _, text, isErr := mcpCall(bobMCP, "/api/mcp", "get_task", map[string]any{"key": ref}); leaks([]byte(text)) != "" || (strings.Contains(text, marker)) {
			t.Errorf("bob's token reading A's task %s leaked: isErr=%v %q", ref, isErr, text)
		}
	}
	if _, text, _ := mcpCall(bobMCP, "/api/mcp", "list_tasks", nil); leaks([]byte(text)) != "" {
		t.Errorf("bob's list_tasks leaked A: %q", text)
	}

	// Claude-style: create_task -> move_task -> comment_task, then it is on the board.
	aliceMCP := newClient(t, srv.URL)
	aliceMCP.bearer = aliceToken
	if _, text, isErr := mcpCall(aliceMCP, "/api/mcp", "list_feedback", nil); isErr || !strings.Contains(text, marker) {
		t.Errorf("alice's token should see A's feedback: %v %q", isErr, text)
	}
	_, text, isErr := mcpCall(aliceMCP, "/api/mcp", "create_task", map[string]any{
		"project": marker + " project", "title": "Filed by Claude", "assignees": []string{"me"}, "labels": []string{marker + "-label"}, "priority": "urgent",
	})
	key := regexp.MustCompile(`M[HG]-\d+`).FindString(text)
	if isErr || key == "" {
		t.Fatalf("create_task over MCP: %v %q", isErr, text)
	}
	if _, text, isErr := mcpCall(aliceMCP, "/api/mcp", "move_task", map[string]any{"key": key, "status": "done"}); isErr || !strings.Contains(text, "Done") {
		t.Errorf("move_task: %v %q", isErr, text)
	}
	if _, text, isErr := mcpCall(aliceMCP, "/api/mcp", "comment_task", map[string]any{"key": strings.ToLower(key), "body": "Picked up by the agent."}); isErr {
		t.Errorf("comment_task: %v %q", isErr, text)
	}
	board = alice.must("GET", "/api/w/projects/"+prID+"/board", nil, 200)
	found := false
	for _, x := range board["tasks"].([]any) {
		tk := x.(map[string]any)
		if tk["key"] == key {
			found = true
			if tk["status_id"] != stDone || tk["completed_at"] == nil || tk["comment_count"].(float64) != 1 {
				t.Errorf("%s on the board: status=%v completed=%v comments=%v", key, tk["status_id"], tk["completed_at"], tk["comment_count"])
			}
		}
	}
	if !found {
		t.Errorf("%s created over MCP is not on the board", key)
	}
	var mcpEntries int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM activity_logs WHERE workspace_id = $1 AND actor_via = 'mcp' AND actor_id = $2
		AND changes::jsonb ->> 'mcp_token_id' = $3`, aID, aliceID, tokID).Scan(&mcpEntries)
	if mcpEntries < 3 {
		t.Errorf("MCP writes must be attributed to the token's user via mcp with the token id, found %d entries", mcpEntries)
	}
	if code, _, _ := mcpCall(aliceMCP, "/api/admin/mcp", "list_issues", nil); code != http.StatusUnauthorized {
		t.Errorf("a user token must not open the admin MCP, got %d", code)
	}

	// ---- admin MCP: only a platform admin's admin token ----------------------
	plain, visible := mcp.NewToken(mcp.AdminPrefix)
	if _, err := a.SysDB.Exec(`INSERT INTO admin_mcp_tokens (user_id, name, token_hash, prefix, scopes) VALUES ($1, 't', $2, $3, '["admin:issues:read"]')`,
		aliceID, mcp.HashToken(plain), visible); err != nil {
		t.Fatal(err)
	}
	adminMCP := newClient(t, srv.URL)
	adminMCP.bearer = plain
	if code, _, _ := mcpCall(adminMCP, "/api/admin/mcp", "list_issues", nil); code != http.StatusUnauthorized {
		t.Errorf("an admin token of a NON-admin user must be refused, got %d", code)
	}
	_, _ = a.SysDB.Exec(`UPDATE users SET roles = 'admin' WHERE id = $1`, aliceID)
	if code, text, isErr := mcpCall(adminMCP, "/api/admin/mcp", "list_issues", nil); code != 200 || isErr {
		t.Errorf("admin list_issues: %d %v %q", code, isErr, text)
	}
	if _, text, isErr := mcpCall(adminMCP, "/api/admin/mcp", "list_users", nil); !isErr || !strings.Contains(text, "admin:users:read") {
		t.Errorf("admin out-of-scope call must fail in-band: %v %q", isErr, text)
	}
	if code, _, _ := mcpCall(adminMCP, "/api/mcp", "whoami", nil); code != http.StatusUnauthorized {
		t.Errorf("an admin token must not open the user MCP, got %d", code)
	}
	fmt.Fprintln(io.Discard)
}
