package server

/*
TestClientImport checks customer import and the report documents end to end on a real stack:

  - preview writes nothing; commit creates / updates (fills only) / skips / reports invalid rows
    with row + column, records activity, and a second commit of the same file changes nothing
  - members cannot import (403); another workspace neither matches nor sees the imported clients
  - vCard import; the WhatsApp API and Google answer "not configured" without env
  - Google Contacts: consent URL + nonce cookie, the PUBLIC callback against a fake Google
    (state verified, token exchange, paginated connections), preview through the session, which
    another workspace's user cannot use; a forged state or a missing cookie is refused
  - time report as Markdown / PDF; the project report as JSON / Markdown / PDF with the reports
    page's numbers; other workspace 404; MCP import + export tools
*/

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestClientImport(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	t.Setenv("WHATSAPP_API_URL", "")
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "imowner")
	mem, memID, _ := signup(t, a, srv.URL, "immember")
	slug := "imp-" + rnd()
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Import " + rnd(), "slug": slug}, 201)["workspace"].(map[string]any)
	wsID := ws["id"].(string)
	slug = ws["slug"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, wsID, memID); err != nil {
		t.Fatal(err)
	}
	owner.ws, mem.ws = wsID, wsID
	acme := owner.must("POST", "/api/w/clients", map[string]any{"name": "Acme", "email": "owner@acme.test"}, 201)["id"].(string)

	csv := "Name,Email,Phone,Company,Notes\n" +
		"Acme Owner,OWNER@acme.test,+20 100 000 0001,Acme Holding,\n" + // update: fills phone + company
		"Nour Adel,nour@example.test,,Adel & Co,met at expo\n" + // create
		"Broken,not-an-email,,,\n" + // invalid (email)
		"Nour again,NOUR@example.test,,,\n" // in-file duplicate
	body := map[string]any{"source": "csv", "content": csv}

	if code, _ := mem.do("POST", "/api/w/clients/import/preview", body); code != 403 {
		t.Errorf("member preview: %d", code)
	}
	var before int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM clients WHERE workspace_id = $1`, wsID).Scan(&before)
	pv := owner.must("POST", "/api/w/clients/import/preview", body, 200)
	counts := pv["counts"].(map[string]any)
	if counts["create"] != 1.0 || counts["update"] != 1.0 || counts["invalid"] != 1.0 || counts["skip"] != 1.0 {
		t.Fatalf("preview counts: %v", counts)
	}
	errs := pv["errors"].([]any)
	if len(errs) != 1 || errs[0].(map[string]any)["column"] != "email" || errs[0].(map[string]any)["row"] != 4.0 {
		t.Errorf("preview errors (row = file line, column): %v", errs)
	}
	if pv["mapping"].(map[string]any)["Company"] != "company" {
		t.Errorf("mapping: %v", pv["mapping"])
	}
	var after int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM clients WHERE workspace_id = $1`, wsID).Scan(&after)
	if after != before {
		t.Fatalf("a preview must write nothing: %d → %d", before, after)
	}

	res := owner.must("POST", "/api/w/clients/import/commit", body, 200)
	if c := res["counts"].(map[string]any); c["create"] != 1.0 || c["update"] != 1.0 || c["invalid"] != 1.0 {
		t.Fatalf("commit counts: %v", c)
	}
	var phone, company string
	_ = a.SysDB.QueryRow(`SELECT COALESCE(phone, ''), COALESCE(company, '') FROM clients WHERE id = $1`, acme).Scan(&phone, &company)
	if phone != "+20 100 000 0001" || company != "Acme Holding" {
		t.Errorf("the update fills phone + company: %q %q", phone, company)
	}
	var created string
	_ = a.SysDB.QueryRow(`SELECT id FROM clients WHERE workspace_id = $1 AND email = 'nour@example.test'`, wsID).Scan(&created)
	if created == "" {
		t.Fatal("nour was not created")
	}
	var acts int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM activity_logs WHERE workspace_id = $1 AND action IN ('client.created', 'client.updated')
		AND changes::jsonb->>'source' = 'import:csv'`, wsID).Scan(&acts)
	if acts != 2 {
		t.Errorf("activity entries for the import: %d", acts)
	}
	again := owner.must("POST", "/api/w/clients/import/commit", body, 200)["counts"].(map[string]any)
	if again["create"] != 0.0 || again["update"] != 0.0 {
		t.Errorf("re-importing the same file must change nothing: %v", again)
	}

	// vCard.
	vcf := "BEGIN:VCARD\nVERSION:3.0\nFN:Layla Hassan\nTEL;TYPE=CELL:+971 50 000 0009\nORG:Nile Tech\nEND:VCARD\n"
	vc := owner.must("POST", "/api/w/clients/import/commit", map[string]any{"source": "vcard", "content": vcf}, 200)
	if vc["counts"].(map[string]any)["create"] != 1.0 {
		t.Errorf("vcard: %v", vc)
	}
	// Optional sources without env.
	if code, b := owner.do("POST", "/api/w/clients/import/preview", map[string]any{"source": "whatsapp_api"}); code != 503 || !strings.Contains(string(b), "not configured") {
		t.Errorf("whatsapp api unconfigured: %d %s", code, b)
	}
	if code, _ := owner.do("POST", "/api/w/clients/import/google/start", nil); code != 503 {
		t.Errorf("google unconfigured: %d", code)
	}

	// Another workspace: the same file creates its own clients and never touches ours.
	other, _, _ := signup(t, a, srv.URL, "imoutsider")
	other.ws = other.must("POST", "/api/me/workspaces", map[string]string{"name": "Other " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	opv := other.must("POST", "/api/w/clients/import/preview", body, 200)
	if c := opv["counts"].(map[string]any); c["update"] != 0.0 || c["create"] != 2.0 {
		t.Errorf("other workspace must not match our clients: %v", c)
	}
	for _, id := range []string{acme, created} {
		if code, _ := other.do("GET", "/api/w/clients/"+id, nil); code != 404 {
			t.Errorf("other workspace GET client %s: %d", id, code)
		}
	}

	// Google Contacts against a fake Google.
	google := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/token":
			_ = r.ParseForm()
			if r.Form.Get("code") != "good-code" || r.Form.Get("client_secret") != "gsecret" {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"gtoken","token_type":"Bearer"}`))
		case r.URL.Path == "/v1/people/me/connections":
			if r.Header.Get("Authorization") != "Bearer gtoken" {
				w.WriteHeader(401)
				return
			}
			if r.URL.Query().Get("pageToken") == "" {
				_, _ = w.Write([]byte(`{"connections":[{"names":[{"displayName":"Google One"}],"emailAddresses":[{"value":"g1@example.test"}]}],"nextPageToken":"p2"}`))
				return
			}
			_, _ = w.Write([]byte(`{"connections":[{"names":[{"displayName":"Acme via Google"}],"emailAddresses":[{"value":"owner@acme.test"}],"organizations":[{"name":"Ignored Co"}]}]}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer google.Close()
	t.Setenv("GOOGLE_CLIENT_ID", "gid")
	t.Setenv("GOOGLE_CLIENT_SECRET", "gsecret")
	t.Setenv("GOOGLE_AUTH_URL", google.URL+"/auth")
	t.Setenv("GOOGLE_TOKEN_URL", google.URL+"/token")
	t.Setenv("GOOGLE_PEOPLE_URL", google.URL)
	t.Setenv("APP_URL", srv.URL)
	t.Setenv("WEB_URL", "")
	start := owner.must("POST", "/api/w/clients/import/google/start?locale=ar", nil, 200)
	consent, _ := url.Parse(start["url"].(string))
	state := consent.Query().Get("state")
	if consent.Query().Get("redirect_uri") != srv.URL+"/api/integrations/google/callback" || state == "" {
		t.Fatalf("consent url: %s", consent)
	}
	noFollow := func(c *client) *http.Client {
		return &http.Client{Jar: c.http.Jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	cb := srv.URL + "/api/integrations/google/callback?code=good-code&state=" + url.QueryEscape(state)
	// Another browser (no nonce cookie) cannot complete it.
	if r, err := noFollow(other).Get(cb); err != nil || r.StatusCode != 400 {
		t.Errorf("callback without the nonce cookie: %v %v", r.StatusCode, err)
	}
	// A forged state.
	if r, _ := noFollow(owner).Get(srv.URL + "/api/integrations/google/callback?code=good-code&state=eyJ3Ijoid3MifQ.bad"); r.StatusCode != 400 {
		t.Errorf("forged state: %d", r.StatusCode)
	}
	r, err := noFollow(owner).Get(cb)
	if err != nil || r.StatusCode != 302 {
		t.Fatalf("callback: %v %v", r.StatusCode, err)
	}
	loc, _ := url.Parse(r.Header.Get("Location"))
	session := loc.Query().Get("session")
	if loc.Path != "/ar/w/"+slug+"/clients" || session == "" {
		t.Fatalf("callback redirect: %s", loc)
	}
	gp := owner.must("POST", "/api/w/clients/import/preview", map[string]any{"source": "google", "session": session}, 200)
	if c := gp["counts"].(map[string]any); c["create"] != 1.0 || c["update"] != 0.0 || c["skip"] != 1.0 {
		// owner@acme.test already has a company (Acme Holding) and phone: nothing to fill.
		t.Errorf("google preview (paginated, deduped): %v", c)
	}
	if code, _ := other.do("POST", "/api/w/clients/import/preview", map[string]any{"source": "google", "session": session}); code != 404 {
		t.Errorf("another workspace used the google session: %d", code)
	}
	gc := owner.must("POST", "/api/w/clients/import/commit", map[string]any{"source": "google", "session": session}, 200)
	if gc["counts"].(map[string]any)["create"] != 1.0 {
		t.Errorf("google commit: %v", gc["counts"])
	}
	if code, _ := owner.do("POST", "/api/w/clients/import/preview", map[string]any{"source": "google", "session": session}); code != 404 {
		t.Errorf("a google session is used once: %d", code)
	}

	// Report documents.
	proj := "Import site " + rnd()
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": proj, "visibility": "workspace", "client_id": acme, "budget_minutes": 600}, 201)["id"].(string)
	// Yesterday: 90 minutes "today" is in the future before 01:30 UTC.
	today := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	owner.must("POST", "/api/w/time/entries", map[string]any{"project": pid, "date": today, "minutes": 90, "description": "build"}, 201)
	owner.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "First task"}, 201)

	code, md := owner.do("GET", "/api/w/report/export?format=md&group_by=project&projects="+pid, nil)
	if code != 200 || !strings.Contains(string(md), "# Time report") || !strings.Contains(string(md), "| "+proj+" | 1:30 |") {
		t.Errorf("time report md: %d\n%s", code, md)
	}
	if code, pdf := owner.do("GET", "/api/w/report/export?format=pdf&lang=ar", nil); code != 200 || !strings.HasPrefix(string(pdf), "%PDF-") {
		t.Errorf("time report pdf: %d", code)
	}

	var rep struct {
		PercentDone int `json:"percent_done"`
		TotalTasks  int `json:"total_tasks"`
		ByMember    struct {
			Total struct {
				Rounded int64 `json:"rounded_s"`
			} `json:"total"`
		} `json:"by_member"`
		Budget struct {
			Spent int64 `json:"spent_s"`
		} `json:"budget"`
	}
	code, raw := owner.do("GET", "/api/w/projects/"+pid+"/report?format=json&from="+today, nil)
	if code != 200 || json.Unmarshal(raw, &rep) != nil {
		t.Fatalf("project report json: %d %s", code, raw)
	}
	page := owner.must("GET", fmt.Sprintf("/api/w/report/time?group_by=member&projects=%s&from=%s&to=%s", pid, today, today), nil, 200)
	if rep.ByMember.Total.Rounded != int64(page["total"].(map[string]any)["rounded_s"].(float64)) || rep.Budget.Spent != 5400 || rep.TotalTasks != 1 {
		t.Errorf("project report numbers differ from the reports page: %+v vs %v", rep, page["total"])
	}
	code, pmd := owner.do("GET", "/api/w/projects/"+pid+"/report?format=md", nil)
	if code != 200 || !strings.Contains(string(pmd), "# Project report · "+proj) || !strings.Contains(string(pmd), "- **Client:** Acme") {
		t.Errorf("project report md: %d\n%s", code, pmd)
	}
	if code, pdf := owner.do("GET", "/api/w/projects/"+pid+"/report?format=pdf", nil); code != 200 || !strings.HasPrefix(string(pdf), "%PDF-") {
		t.Errorf("project report pdf: %d", code)
	}
	if code, _ := mem.do("GET", "/api/w/projects/"+pid+"/report?format=md", nil); code != 200 {
		t.Errorf("member project report: %d", code)
	}
	if code, _ := other.do("GET", "/api/w/projects/"+pid+"/report?format=md", nil); code != 404 {
		t.Errorf("other workspace project report: %d", code)
	}

	// MCP.
	tok := owner.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "import " + rnd(), "scopes": []string{"clients:write", "reports:read"}}, 201)
	agent := newClient(t, srv.URL)
	agent.bearer = tok["plaintext"].(string)
	if _, text, isErr := mcpCall(agent, "/api/mcp", "import_clients_preview", map[string]any{"source": "vcard", "content": vcf}); isErr || !strings.Contains(text, "0 would be created") {
		t.Errorf("import_clients_preview: %v %q", isErr, text)
	}
	if _, text, isErr := mcpCall(agent, "/api/mcp", "export_project_report", map[string]any{"project": proj}); isErr || !strings.Contains(text, "# Project report") {
		t.Errorf("export_project_report: %v %q", isErr, text)
	}
	if _, text, isErr := mcpCall(agent, "/api/mcp", "export_time_report", map[string]any{"projects": []string{proj}}); isErr || !strings.Contains(text, "| "+proj+" |") {
		t.Errorf("export_time_report: %v %q", isErr, text)
	}
}
