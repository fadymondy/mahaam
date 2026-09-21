package server

/*
TestTimeTracking — the P2 exit criteria against the real stack (guard, RLS pool, internal/work,
the user MCP, the realtime hub, the reminder jobs), on the throwaway database of the sweep:

 1. 50 parallel starts leave exactly one running timer and no overlapping entries; the database
    itself refuses a second running timer and an overlap when the application is bypassed
 2. stop: your own only; time:manage (manager+) stops a member's
 3. a cross-midnight entry splits correctly in two timezones (Africa/Cairo, America/New_York)
 4. rates: snapshot unchanged after a rate edit; new entries take the new rate; effective dating;
    members never see rates
 5. locked / invoiced entries are refused over REST and MCP
 6. MCP start/stop/log round-trip shows on the timesheet; another member's time needs time:manage
 7. realtime: timer.started / timer.stopped reach every stream of the same person, and only theirs
 8. reminders: long-running timer and no-time-today, each sent once, in the person's inbox
 9. a new project's default columns are in the workspace language (ar)

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run TimeTracking -v
*/

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/db/migrate"
	"github.com/fadymondy/mahaam/internal/work"
)

func bootStack(t *testing.T) (*app.App, *httptest.Server) {
	t.Helper()
	owner, appURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_APP_DATABASE_URL")
	if owner == "" || appURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_APP_DATABASE_URL (a throwaway database)")
	}
	t.Setenv("DATABASE_URL", owner)
	t.Setenv("APP_DATABASE_URL", appURL)
	t.Setenv("DB_DRIVER", "pgx")
	t.Setenv("AUTH_SECRET", "time-test-secret-time-test-secret-time-test-0123")
	t.Setenv("STORAGE_DIR", t.TempDir())
	// Workspaces created by these tests start unlimited (the plan tests move them explicitly).
	t.Setenv("PLAN_DEFAULT", "unlimited")
	// No background clock in a test: a job firing halfway through makes the
	// result depend on where the minute boundary fell (MH-249).
	t.Setenv("SCHEDULER", "off")
	k0 := togo.New()
	sys, err := k0.SQL(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate.Run(context.Background(), sys, appURL, "../..", func(string, ...any) {}); err != nil {
		t.Fatal(err)
	}
	k0.Close()
	a := Boot()
	srv := httptest.NewServer(a.Kernel.Handler())
	t.Cleanup(func() {
		srv.Close()
		a.Kernel.Close()
	})
	return a, srv
}

func signup(t *testing.T, a *app.App, base, prefix string) (*client, string, string) {
	t.Helper()
	c := newClient(t, base)
	email := prefix + "-" + rnd() + "@example.test"
	c.must("POST", "/api/auth/register", map[string]string{"email": email, "password": "correct-horse-9"}, 201)
	var id string
	if err := a.SysDB.QueryRow(`SELECT id FROM users WHERE email = $1`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return c, id, email
}

func num(v any) float64 {
	f, _ := v.(float64)
	return f
}

func dayTotal(t *testing.T, ts map[string]any, day string) float64 {
	t.Helper()
	days, _ := ts["days"].([]any)
	totals, _ := ts["day_totals"].([]any)
	for i, d := range days {
		if d == day {
			return num(totals[i])
		}
	}
	t.Fatalf("day %s is not in the week %v", day, days)
	return 0
}

type sseEvent struct{ name, data string }

// openStream opens GET /api/w/events as c in ws and returns its events.
func openStream(t *testing.T, c *client, ws string) <-chan sseEvent {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/api/w/events", nil)
	req.Header.Set("X-Workspace-ID", ws)
	res, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("events: %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	ch := make(chan sseEvent, 64)
	go func() {
		defer close(ch)
		defer res.Body.Close()
		sc := bufio.NewScanner(res.Body)
		sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
		name := ""
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				name = line[len("event: "):]
			case strings.HasPrefix(line, "data: "):
				ch <- sseEvent{name, line[len("data: "):]}
			}
		}
	}()
	return ch
}

func expectEvent(t *testing.T, who string, ch <-chan sseEvent, name, contains string) sseEvent {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				t.Fatalf("%s: stream closed waiting for %s", who, name)
			}
			if ev.name == name && strings.Contains(ev.data, contains) {
				return ev
			}
		case <-deadline:
			t.Fatalf("%s: no %s event containing %q within 3s", who, name, contains)
		}
	}
}

func expectQuiet(t *testing.T, who string, ch <-chan sseEvent, d time.Duration) {
	t.Helper()
	deadline := time.After(d)
	for {
		select {
		case ev := <-ch:
			if ev.name != "timer.state" {
				t.Errorf("%s received another person's event %s: %s", who, ev.name, ev.data)
			}
		case <-deadline:
			return
		}
	}
}

func TestTimeTracking(t *testing.T) {
	a, srv := bootStack(t)
	ctx := context.Background()

	// A: alice (owner), mia (member), rex (member). B: bob.
	alice, aliceID, aliceEmail := signup(t, a, srv.URL, "alice")
	mia, miaID, _ := signup(t, a, srv.URL, "mia")
	rex, rexID, _ := signup(t, a, srv.URL, "rex")
	bob, _, _ := signup(t, a, srv.URL, "bob")
	aID := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Time A " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	bID := bob.must("POST", "/api/me/workspaces", map[string]string{"name": "Time B " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	for _, u := range []string{miaID, rexID} {
		if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, aID, u); err != nil {
			t.Fatal(err)
		}
	}
	alice.ws, mia.ws, rex.ws, bob.ws = aID, aID, aID, bID
	alice.must("PATCH", "/api/w/time/settings", map[string]any{"timezone": "Africa/Cairo"}, 200)
	projName := "Launch " + rnd()
	prID := alice.must("POST", "/api/w/projects", map[string]any{"name": projName, "billing_mode": "hourly"}, 201)["id"].(string)

	// ---- 1. fifty parallel starts ---------------------------------------------------------------
	mia.ensureCSRF()
	var wg sync.WaitGroup
	codes := make([]int, 50)
	bodies := make([]string, 50)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			code, b := mia.do("POST", "/api/w/time/start", map[string]any{"project": prID, "description": fmt.Sprintf("parallel %d", i)})
			codes[i], bodies[i] = code, string(b)
		}(i)
	}
	wg.Wait()
	for i, c := range codes {
		if c != 201 {
			t.Errorf("parallel start %d: %d %s", i, c, bodies[i])
		}
	}
	var running, total, overlaps int
	_ = a.SysDB.QueryRow(`SELECT count(*) FILTER (WHERE ended_at IS NULL), count(*) FROM time_entries WHERE workspace_id = $1 AND user_id = $2`,
		aID, miaID).Scan(&running, &total)
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM time_entries x JOIN time_entries y
		ON x.workspace_id = y.workspace_id AND x.user_id = y.user_id AND x.id < y.id
		AND tstzrange(x.started_at, coalesce(x.ended_at, 'infinity')) && tstzrange(y.started_at, coalesce(y.ended_at, 'infinity'))
		WHERE x.workspace_id = $1 AND x.user_id = $2`, aID, miaID).Scan(&overlaps)
	if running != 1 || total != 50 || overlaps != 0 {
		t.Fatalf("after 50 parallel starts: %d running (want 1), %d entries (want 50), %d overlapping pairs (want 0)", running, total, overlaps)
	}
	t.Logf("50 parallel starts: 1 running, 50 entries, 0 overlaps")
	// The database enforces it without the application: a second running timer, and an overlap.
	var runStart time.Time
	_ = a.SysDB.QueryRow(`SELECT started_at FROM time_entries WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NULL`, aID, miaID).Scan(&runStart)
	if _, err := a.SysDB.Exec(`INSERT INTO time_entries (workspace_id, user_id, started_at, created_by) VALUES ($1, $2, $3, $2)`,
		aID, miaID, runStart.Add(time.Hour)); err == nil || !(strings.Contains(err.Error(), "one_running_timer") || strings.Contains(err.Error(), "no_overlap")) {
		t.Errorf("the database accepted a second running timer: %v", err)
	}
	if _, err := a.SysDB.Exec(`INSERT INTO time_entries (workspace_id, user_id, started_at, ended_at, created_by) VALUES ($1, $2, $3, $4, $2)`,
		aID, miaID, runStart.Add(-time.Second), runStart.Add(time.Second)); err == nil || !strings.Contains(err.Error(), "no_overlap") {
		t.Errorf("the database accepted an overlapping entry: %v", err)
	}
	var genDur int64
	_ = a.SysDB.QueryRow(`SELECT duration_s FROM time_entries WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NOT NULL
		ORDER BY started_at LIMIT 1`, aID, miaID).Scan(&genDur)
	if genDur < 0 {
		t.Errorf("generated duration_s is negative: %d", genDur)
	}

	// ---- 2. stop: own only; time:manage stops a member's ---------------------------------------
	mia.must("POST", "/api/w/time/stop", map[string]any{}, 200)
	if code, b := mia.do("POST", "/api/w/time/stop", map[string]any{}); code != 409 {
		t.Errorf("stopping with no timer running: %d %s", code, b)
	}
	alice.must("POST", "/api/w/time/start", map[string]any{"description": "alice's timer"}, 201)
	if code, b := mia.do("POST", "/api/w/time/stop", map[string]any{"user": aliceID}); code != 403 {
		t.Errorf("a member stopped the owner's timer: %d %s", code, b)
	}
	alice.must("POST", "/api/w/time/stop", map[string]any{}, 200)
	mia.must("POST", "/api/w/time/start", map[string]any{"description": "mia's timer"}, 201)
	stopped := alice.must("POST", "/api/w/time/stop", map[string]any{"user": miaID}, 200)
	if stopped["user_id"] != miaID || stopped["ended_at"] == nil {
		t.Errorf("the owner stopping mia's timer: %v", stopped)
	}
	var actor, changes string
	_ = a.SysDB.QueryRow(`SELECT actor_id, changes FROM activity_logs WHERE workspace_id = $1 AND subject_id = $2 AND action = 'time.stopped'`,
		aID, stopped["id"]).Scan(&actor, &changes)
	if actor != aliceID || !strings.Contains(changes, miaID) {
		t.Errorf("stopping someone else's timer must record the actor and the owner: actor=%s changes=%s", actor, changes)
	}

	// ---- 4a. rates set before the entries they apply to ---------------------------------------
	alice.must("PUT", "/api/w/rates/"+miaID, map[string]any{"effective_from": "2026-01-01", "bill_rate_minor": 10000, "cost_rate_minor": 4000}, 200)
	alice.must("PUT", "/api/w/rates/"+miaID, map[string]any{"effective_from": "2026-09-11", "bill_rate_minor": 20000, "cost_rate_minor": 6000}, 200)

	// ---- 3. cross-midnight split in two timezones ---------------------------------------------
	e1 := mia.must("POST", "/api/w/time/entries", map[string]any{"project": prID, "description": "late deploy",
		"started_at": "2026-09-10T20:00:00Z", "ended_at": "2026-09-11T02:00:00Z"}, 201)
	e1ID := e1["id"].(string)
	if num(e1["duration_s"]) != 21600 || e1["billable"] != true || e1["source"] != "manual" {
		t.Errorf("logged entry: %v", e1)
	}
	ts := mia.must("GET", "/api/w/time/timesheet?week=2026-09-10", nil, 200)
	if c, d := dayTotal(t, ts, "2026-09-10"), dayTotal(t, ts, "2026-09-11"); c != 3600 || d != 18000 {
		t.Errorf("Africa/Cairo: 20:00–02:00 UTC is 23:00–05:00 local: want 3600 + 18000, got %v + %v", c, d)
	}
	alice.must("PATCH", "/api/w/time/settings", map[string]any{"timezone": "America/New_York"}, 200)
	ts = mia.must("GET", "/api/w/time/timesheet?week=2026-09-10", nil, 200)
	if c, d := dayTotal(t, ts, "2026-09-10"), dayTotal(t, ts, "2026-09-11"); c != 21600 || d != 0 {
		t.Errorf("America/New_York: 20:00–02:00 UTC is 16:00–22:00 local: want 21600 + 0, got %v + %v", c, d)
	}
	alice.must("PATCH", "/api/w/time/settings", map[string]any{"timezone": "Africa/Cairo"}, 200)
	night := mia.must("POST", "/api/w/time/entries", map[string]any{"project": prID, "description": "night shift",
		"date": "2026-09-08", "started_at": "23:00", "ended_at": "01:00"}, 201)
	if num(night["duration_s"]) != 7200 || !strings.HasPrefix(fmt.Sprint(night["started_at"]), "2026-09-08T20:00:00") {
		t.Errorf("23:00–01:00 Cairo on 2026-09-08 must be 20:00Z for 2h: %v", night)
	}
	ts = mia.must("GET", "/api/w/time/timesheet?week=2026-09-08", nil, 200)
	if c, d := dayTotal(t, ts, "2026-09-08"), dayTotal(t, ts, "2026-09-09"); c != 3600 || d != 3600 {
		t.Errorf("23:00–01:00 local splits 1h + 1h: got %v + %v", c, d)
	}
	t.Logf("cross-midnight split: Cairo 3600+18000, New York 21600+0, local 23:00–01:00 3600+3600")

	// ---- 4. rate snapshots --------------------------------------------------------------------------
	got := alice.must("GET", "/api/w/time/entries/"+e1ID, nil, 200)
	if num(got["bill_rate_minor"]) != 10000 || num(got["cost_rate_minor"]) != 4000 {
		t.Fatalf("entry on 2026-09-10 must snapshot the 2026-01-01 card (10000/4000): %v", got)
	}
	later := mia.must("POST", "/api/w/time/entries", map[string]any{"project": prID, "description": "after the raise",
		"started_at": "2026-09-12T08:00:00Z", "ended_at": "2026-09-12T09:00:00Z"}, 201)
	if l := alice.must("GET", "/api/w/time/entries/"+later["id"].(string), nil, 200); num(l["bill_rate_minor"]) != 20000 {
		t.Errorf("entry on 2026-09-12 must take the 2026-09-11 card (20000): %v", l)
	}
	alice.must("PUT", "/api/w/rates/"+miaID, map[string]any{"effective_from": "2026-01-01", "bill_rate_minor": 99999, "cost_rate_minor": 1}, 200)
	if again := alice.must("GET", "/api/w/time/entries/"+e1ID, nil, 200); num(again["bill_rate_minor"]) != 10000 || num(again["cost_rate_minor"]) != 4000 {
		t.Errorf("a rate edit rewrote an existing entry's snapshot: %v", again)
	}
	fresh := mia.must("POST", "/api/w/time/entries", map[string]any{"project": prID, "description": "after the edit",
		"started_at": "2026-09-09T10:00:00Z", "ended_at": "2026-09-09T11:00:00Z"}, 201)
	if f := alice.must("GET", "/api/w/time/entries/"+fresh["id"].(string), nil, 200); num(f["bill_rate_minor"]) != 99999 {
		t.Errorf("a new entry must take the edited card (99999): %v", f)
	}
	if own := mia.must("GET", "/api/w/time/entries/"+e1ID, nil, 200); own["bill_rate_minor"] != nil || own["cost_rate_minor"] != nil {
		t.Errorf("a member must not see rates: %v", own)
	}
	if code, _ := mia.do("GET", "/api/w/rates", nil); code != 403 {
		t.Errorf("a member read the rates sheet: %d", code)
	}
	t.Logf("rate snapshot unchanged after the edit (10000/4000); new entries 99999; effective dating 20000")

	// ---- 5. locked and invoiced entries are immutable -------------------------------------------
	_, _ = a.SysDB.Exec(`UPDATE time_entries SET locked_at = now() WHERE id = $1`, e1ID)
	// P6 is real now: an invoiced entry points at an actual invoice (composite FK), so mark `later`
	// invoiced by drafting a minimal invoice and linking it, as DraftFromTime does.
	var invClientID, invoiceID string
	if err := a.SysDB.QueryRow(`INSERT INTO clients (workspace_id, name, currency) VALUES ($1, 'Invoiced Co', 'USD') RETURNING id`, aID).Scan(&invClientID); err != nil {
		t.Fatal(err)
	}
	if err := a.SysDB.QueryRow(`INSERT INTO invoices (workspace_id, client_id, number, status, currency, created_by)
		VALUES ($1, $2, 'INV-TEST-000001', 'sent', 'USD', $3) RETURNING id`, aID, invClientID, miaID).Scan(&invoiceID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SysDB.Exec(`UPDATE time_entries SET invoice_id = $2, locked_at = now() WHERE id = $1`, later["id"], invoiceID); err != nil {
		t.Fatal(err)
	}
	if code, b := mia.do("DELETE", "/api/w/time/entries/"+e1ID, nil); code != 409 {
		t.Errorf("deleting a locked entry: %d %s", code, b)
	}
	if code, b := mia.do("PATCH", "/api/w/time/entries/"+e1ID, map[string]any{"description": "rewritten"}); code != 409 {
		t.Errorf("editing a locked entry: %d %s", code, b)
	}

	// ---- 6. MCP round-trip ------------------------------------------------------------------------
	tok := mia.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "mia agent", "scopes": []string{"members:read", "time:read", "time:write"}}, 201)
	agent := newClient(t, srv.URL)
	agent.bearer = tok["plaintext"].(string)
	call := func(tool string, args map[string]any) (string, bool) {
		_, text, isErr := mcpCall(agent, "/api/mcp", tool, args)
		return text, isErr
	}
	if text, isErr := call("delete_time_entry", map[string]any{"id": later["id"]}); !isErr || !strings.Contains(text, "locked") {
		t.Errorf("MCP delete of an invoiced entry must be refused in-band: %v %q", isErr, text)
	}
	if text, _ := call("whoami", nil); !strings.Contains(text, "running timer: none") {
		t.Errorf("whoami before start: %q", text)
	}
	if text, isErr := call("start_timer", map[string]any{"project": projName, "description": "via MCP"}); isErr || !strings.HasPrefix(text, "Started: via MCP") {
		t.Fatalf("start_timer: %v %q", isErr, text)
	}
	if text, _ := call("whoami", nil); !strings.Contains(text, "running timer: via MCP") {
		t.Errorf("whoami must show the running timer: %q", text)
	}
	if text, isErr := call("get_running_timer", nil); isErr || !strings.Contains(text, "via MCP") {
		t.Errorf("get_running_timer: %v %q", isErr, text)
	}
	if text, isErr := call("stop_timer", map[string]any{"user": aliceEmail}); !isErr || !strings.Contains(text, "time:manage") {
		t.Errorf("stopping another member's timer without time:manage must fail in-band: %v %q", isErr, text)
	}
	if text, isErr := call("stop_timer", nil); isErr || !strings.HasPrefix(text, "Stopped: via MCP") {
		t.Errorf("stop_timer: %v %q", isErr, text)
	}
	if text, isErr := call("log_time", map[string]any{"project": projName, "date": "2026-09-09", "minutes": 45, "description": "MCP log"}); isErr || !strings.HasPrefix(text, "Logged: MCP log") {
		t.Errorf("log_time: %v %q", isErr, text)
	}
	ts = mia.must("GET", "/api/w/time/timesheet?week=2026-09-09", nil, 200)
	foundLog := false
	for _, x := range ts["entries"].([]any) {
		e := x.(map[string]any)
		if e["description"] == "MCP log" && e["source"] == "mcp" && num(e["duration_s"]) == 2700 {
			foundLog = true
		}
	}
	if !foundLog {
		t.Errorf("the MCP-logged entry is not on mia's timesheet: %v", ts["entries"])
	}
	week := mia.must("GET", "/api/w/time/timesheet", nil, 200)
	if !strings.Contains(fmt.Sprint(week["entries"]), "via MCP") {
		t.Errorf("the MCP-started timer is not on this week's timesheet")
	}
	var viaMCP int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM activity_logs WHERE workspace_id = $1 AND actor_id = $2 AND actor_via = 'mcp'
		AND action IN ('time.started', 'time.stopped', 'time.logged')`, aID, miaID).Scan(&viaMCP)
	if viaMCP < 3 {
		t.Errorf("MCP time writes must be in the activity feed via MCP: %d", viaMCP)
	}
	t.Logf("MCP start/stop/log round-trip on the timesheet; %d activity entries via MCP", viaMCP)

	// ---- 7. realtime: the same person's streams, and only theirs ------------------------------------
	tabA, tabB := openStream(t, mia, aID), openStream(t, mia, aID)
	aliceTab, bobTab := openStream(t, alice, aID), openStream(t, bob, bID)
	for who, ch := range map[string]<-chan sseEvent{"mia tab A": tabA, "mia tab B": tabB, "alice": aliceTab, "bob": bobTab} {
		expectEvent(t, who, ch, "timer.state", "running")
	}
	if n := a.Live.Subscribers(aID, miaID); n != 2 {
		t.Errorf("mia should have 2 open streams, has %d", n)
	}
	started := mia.must("POST", "/api/w/time/start", map[string]any{"project": prID, "description": "realtime"}, 201)["started"].(map[string]any)
	for who, ch := range map[string]<-chan sseEvent{"mia tab A": tabA, "mia tab B": tabB} {
		ev := expectEvent(t, who, ch, "timer.started", started["id"].(string))
		if strings.Contains(ev.data, "rate_minor") {
			t.Errorf("%s: the realtime payload must never carry rates: %s", who, ev.data)
		}
	}
	if text, isErr := call("start_timer", map[string]any{"description": "agent took over"}); isErr {
		t.Fatalf("start_timer: %q", text)
	}
	for who, ch := range map[string]<-chan sseEvent{"mia tab A": tabA, "mia tab B": tabB} {
		expectEvent(t, who, ch, "timer.stopped", started["id"].(string))
		expectEvent(t, who, ch, "timer.started", "agent took over")
	}
	mia.must("POST", "/api/w/time/stop", map[string]any{}, 200)
	expectEvent(t, "mia tab A", tabA, "timer.stopped", "agent took over")
	expectQuiet(t, "alice", aliceTab, 800*time.Millisecond)
	expectQuiet(t, "bob", bobTab, 200*time.Millisecond)
	t.Logf("realtime: both of mia's streams got timer.started/stopped (REST and MCP); alice and bob got nothing")

	// ---- 8. reminders --------------------------------------------------------------------------------
	if _, err := a.SysDB.Exec(`INSERT INTO time_entries (workspace_id, user_id, started_at, created_by, currency)
		VALUES ($1, $2, now() - interval '9 hours', $2, 'USD')`, aID, rexID); err != nil {
		t.Fatal(err)
	}
	sv := work.New(a)
	countNotes := func(user, kind, key string) int {
		var n int
		_ = a.SysDB.QueryRow(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND kind = $3 AND dedupe_key LIKE $4`,
			aID, user, kind, key).Scan(&n)
		return n
	}
	for i := 0; i < 2; i++ {
		if _, err := sv.RemindLongRunning(ctx, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if n := countNotes(rexID, "timer.long_running", "entry:%"); n != 1 {
		t.Errorf("long-running reminder for rex: %d rows after two runs, want exactly 1", n)
	}
	inbox := rex.must("GET", "/api/w/notifications", nil, 200)
	if num(inbox["unread"]) != 1 || !strings.Contains(fmt.Sprint(inbox["notifications"]), "timer.long_running") {
		t.Errorf("rex's inbox: %v", inbox)
	}
	rex.must("POST", "/api/w/notifications/read-all", map[string]any{}, 200)
	if again := rex.must("GET", "/api/w/notifications", nil, 200); num(again["unread"]) != 0 {
		t.Errorf("read-all left %v unread", again["unread"])
	}
	if code, _ := mia.do("GET", "/api/w/notifications", nil); code != 200 {
		t.Errorf("mia's inbox: %d", code)
	} else if b := mia.must("GET", "/api/w/notifications", nil, 200); strings.Contains(fmt.Sprint(b), "timer.long_running") {
		t.Errorf("mia sees rex's notification: %v", b)
	}
	cairo, _ := time.LoadLocation("Africa/Cairo")
	monday7pm := time.Date(2026, 9, 7, 19, 0, 0, 0, cairo)
	for i := 0; i < 2; i++ {
		if _, err := sv.RemindMissingTime(ctx, monday7pm); err != nil {
			t.Fatal(err)
		}
	}
	if n := countNotes(miaID, "time.missing_day", "day:2026-09-07"); n != 1 {
		t.Errorf("no-time reminder for mia on Monday 2026-09-07 after 18:00: %d rows after two runs, want 1", n)
	}
	if _, err := sv.RemindMissingTime(ctx, time.Date(2026, 9, 8, 17, 0, 0, 0, cairo)); err != nil {
		t.Fatal(err)
	}
	if n := countNotes(rexID, "time.missing_day", "day:2026-09-08"); n != 0 {
		t.Errorf("a reminder went out before 18:00 local: %d", n)
	}
	if _, err := sv.RemindMissingTime(ctx, time.Date(2026, 9, 12, 19, 0, 0, 0, cairo)); err != nil {
		t.Fatal(err)
	}
	if n := countNotes(rexID, "time.missing_day", "day:2026-09-12"); n != 0 {
		t.Errorf("a reminder went out on a Saturday (week starts Monday): %d", n)
	}
	t.Logf("reminders: long-running once, no-time once per day, none before 18:00 or on the weekend")

	// ---- 9. default columns in the workspace language -------------------------------------------------
	cID := bob.must("POST", "/api/me/workspaces", map[string]any{"name": "مساحة " + rnd(), "locale": "ar"}, 201)["workspace"].(map[string]any)["id"].(string)
	bob.ws = cID
	proj := bob.must("POST", "/api/w/projects", map[string]any{"name": "مشروع"}, 201)
	var names []string
	for _, st := range proj["statuses"].([]any) {
		names = append(names, st.(map[string]any)["name"].(string))
	}
	if strings.Join(names, "|") != "قائمة الانتظار|للتنفيذ|قيد التنفيذ|بانتظار الموافقة|قيد المراجعة|منجز" {
		t.Errorf("an Arabic workspace's default columns: %v", names)
	}
	bob.ws = bID
	if code, b := bob.do("GET", "/api/w/time/entries/"+e1ID, nil); code != 404 || strings.Contains(string(b), "late deploy") {
		t.Errorf("bob read A's entry: %d %s", code, b)
	}

	// ---- 10. replaying a logged entry is refused, which is what makes an offline queue safe ------
	// An offline client queues finished blocks and replays them on reconnect. Nothing in the API
	// carries an idempotency key, so replay safety rests entirely on the no_overlap exclusion
	// constraint: the same block cannot be inserted twice for the same person. This pins that
	// contract — a queue may treat 409 as "already recorded" and drop the item, rather than
	// retrying forever or double-billing the customer.
	rex.ws = aID
	block := map[string]any{
		"project":     prID,
		"started_at":  "2026-03-02T09:00:00Z",
		"ended_at":    "2026-03-02T10:00:00Z",
		"description": "offline block",
	}
	first := rex.must("POST", "/api/w/time/entries", block, 201)
	if first["id"] == nil {
		t.Fatalf("logging a block did not return an entry: %v", first)
	}
	if code, b := rex.do("POST", "/api/w/time/entries", block); code != 409 {
		t.Errorf("replaying the same block: got %d %s, want 409 so a queue can drop it", code, b)
	}
	// A different block on the same day must still be accepted — the guard is the time range,
	// not "one entry per day".
	rex.must("POST", "/api/w/time/entries", map[string]any{
		"project":    prID,
		"started_at": "2026-03-02T11:00:00Z",
		"ended_at":   "2026-03-02T12:00:00Z",
	}, 201)
}

func testAppURL() string { return os.Getenv("TEST_APP_DATABASE_URL") }
