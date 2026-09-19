package server

/*
TestReports — the P5 exit criteria against the real stack, on the throwaway database of the sweep:

 1. report totals equal the raw entries, for every grouping, under several rounding settings and in
    two timezones (Africa/Cairo, America/New_York — the range crosses New York's DST switch). The
    expectation is computed here independently: raw seconds by SQL, local days by stepping calendar
    days in the zone, rounding per entry, cumulative across days
 2. a member's report is their own time and carries no money; profitability is manager+
 3. the CSV and XLSX exports are the table: same columns, same cells, total row
 4. a budget alert fires once at 80% and once at 100% (writes and the scheduler job alike)
 5. notification events: assigned, mentioned, done — never to the actor; muting stops a kind
 6. email: each inbox item mailed once (file driver); the digest once a day; email settings refused
    while email is not configured
 7. saved views: own, shared (manager+), owner-only edits

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run Reports -v
*/

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/fadymondy/mahaam/internal/work"
)

type logged struct {
	id, user, project, task string
	start, end              time.Time
	billable                bool
	bill, cost              int64
}

func roundTo(sec int64, min int) int64 { return work.RoundSeconds(sec, min) }

func val(sec, rate int64) int64 { return (sec*rate + 1800) / 3600 }

// perDay splits [a, b) by stepping calendar days in loc (independent of work.SplitByDay).
func perDay(a, b time.Time, loc *time.Location, from, to time.Time) (days []string, secs []int64) {
	if a.Before(from) {
		a = from
	}
	if b.After(to) {
		b = to
	}
	la := a.In(loc)
	for d := time.Date(la.Year(), la.Month(), la.Day(), 0, 0, 0, 0, loc); d.Before(b); d = d.AddDate(0, 0, 1) {
		next := d.AddDate(0, 0, 1)
		lo, hi := a, b
		if d.After(lo) {
			lo = d
		}
		if next.Before(hi) {
			hi = next
		}
		if hi.After(lo) {
			days = append(days, d.Format("2006-01-02"))
			secs = append(secs, int64(hi.Sub(lo)/time.Second))
		}
	}
	return
}

func rowsBy(rep map[string]any) map[string]map[string]any {
	out := map[string]map[string]any{}
	for _, r := range rep["rows"].([]any) {
		m := r.(map[string]any)
		out[m["key"].(string)] = m
	}
	return out
}

func TestReports(t *testing.T) {
	mailDir := t.TempDir()
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", mailDir)
	a, srv := bootStack(t)
	ctx := context.Background()
	sv := work.New(a)

	alice, aliceID, _ := signup(t, a, srv.URL, "ralice")
	mia, miaID, miaEmail := signup(t, a, srv.URL, "rmia")
	aID := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Reports " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, aID, miaID); err != nil {
		t.Fatal(err)
	}
	alice.ws, mia.ws = aID, aID
	miaHandle := strings.Split(miaEmail, "@")[0]

	// Rates first (snapshotted on each entry): mia bills 120.00/h and costs 50.00/h; alice bills 90.00/h.
	alice.must("PUT", "/api/w/rates/"+miaID, map[string]any{"bill_rate_minor": 12000, "cost_rate_minor": 5000, "effective_from": "2026-01-01"}, 200)
	alice.must("PUT", "/api/w/rates/"+aliceID, map[string]any{"bill_rate_minor": 9000, "cost_rate_minor": 3333, "effective_from": "2026-01-01"}, 200)
	clID := alice.must("POST", "/api/w/clients", map[string]any{"name": "Client " + rnd()}, 201)["id"].(string)
	p1 := alice.must("POST", "/api/w/projects", map[string]any{"name": "Billable " + rnd(), "billing_mode": "hourly", "client_id": clID}, 201)["id"].(string)
	p2 := alice.must("POST", "/api/w/projects", map[string]any{"name": "Internal " + rnd()}, 201)["id"].(string)
	l1 := alice.must("POST", "/api/w/labels", map[string]any{"name": "design-" + rnd(), "color": "teal"}, 201)["id"].(string)
	l2 := alice.must("POST", "/api/w/labels", map[string]any{"name": "backend-" + rnd(), "color": "blue"}, 201)["id"].(string)
	t1 := alice.must("POST", "/api/w/projects/"+p1+"/tasks", map[string]any{"title": "Both labels", "label_ids": []string{l1, l2}}, 201)
	t2 := alice.must("POST", "/api/w/projects/"+p1+"/tasks", map[string]any{"title": "No labels"}, 201)
	t1ID, t2ID := t1["id"].(string), t2["id"].(string)

	// Entries with odd seconds, two crossing midnight, one across New York's DST switch (2026-03-08 07:00Z).
	type spec struct {
		c             *client
		user          string
		project, task string
		start, end    string
		billable      bool
	}
	specs := []spec{
		{mia, miaID, p1, t1ID, "2026-03-07T22:17:13Z", "2026-03-08T07:05:41Z", true},
		{mia, miaID, p1, t2ID, "2026-03-09T10:00:00Z", "2026-03-09T10:37:29Z", true},
		{mia, miaID, p2, "", "2026-03-10T21:52:10Z", "2026-03-10T23:08:55Z", false},
		{alice, aliceID, p1, "", "2026-03-11T08:00:07Z", "2026-03-11T09:13:00Z", true},
		{alice, aliceID, "", "", "2026-03-12T12:00:00Z", "2026-03-12T12:07:31Z", false},
		{mia, miaID, p1, t1ID, "2026-03-13T23:30:00Z", "2026-03-14T01:44:44Z", true},
		{mia, miaID, p1, t2ID, "2026-03-15T03:59:59Z", "2026-03-15T04:00:30Z", false},
	}
	var entries []logged
	for _, s := range specs {
		body := map[string]any{"started_at": s.start, "ended_at": s.end, "billable": s.billable, "description": "report fixture"}
		if s.project != "" {
			body["project"] = s.project
		}
		if s.task != "" {
			body["task"] = s.task
		}
		e := s.c.must("POST", "/api/w/time/entries", body, 201)
		st, _ := time.Parse(time.RFC3339, s.start)
		en, _ := time.Parse(time.RFC3339, s.end)
		l := logged{id: e["id"].(string), user: s.user, project: s.project, task: s.task, start: st, end: en, billable: s.billable}
		_ = a.SysDB.QueryRow(`SELECT coalesce(bill_rate_minor, 0), coalesce(cost_rate_minor, 0) FROM time_entries WHERE id = $1`, l.id).Scan(&l.bill, &l.cost)
		if e["billable"] != s.billable {
			t.Fatalf("entry billable = %v, want %v", e["billable"], s.billable)
		}
		entries = append(entries, l)
	}
	if entries[0].bill != 12000 || entries[0].cost != 5000 || entries[3].bill != 9000 {
		t.Fatalf("rate snapshots: %+v", entries[:4])
	}
	labelsOf := map[string][]string{t1ID: {l1, l2}}

	// ---- 1. totals match the raw entries -----------------------------------------------------------
	checks := 0
	for _, tz := range []string{"Africa/Cairo", "America/New_York"} {
		alice.must("PATCH", "/api/w/time/settings", map[string]any{"timezone": tz, "week_start": 1}, 200)
		loc, _ := time.LoadLocation(tz)
		for _, rng := range [][2]string{{"2026-03-01", "2026-03-31"}, {"2026-03-08", "2026-03-14"}} {
			from := time.Date(2026, 3, atoi(rng[0][8:]), 0, 0, 0, 0, loc)
			to := time.Date(2026, 3, atoi(rng[1][8:])+1, 0, 0, 0, 0, loc)
			// Raw seconds by SQL, independently.
			var rawSQL int64
			if err := a.SysDB.QueryRow(`SELECT coalesce(sum(floor(extract(epoch FROM least(ended_at, $3) - greatest(started_at, $2)))), 0)::bigint
				FROM time_entries WHERE workspace_id = $1 AND started_at < $3 AND ended_at > $2`, aID, from, to).Scan(&rawSQL); err != nil {
				t.Fatal(err)
			}
			for _, rounding := range []int{0, 1, 6, 15, 60} {
				// Expected, per entry: day slices, cumulative rounding.
				var raw, rounded, billR, bill, cost int64
				perDayR := map[string]int64{}
				perKey := map[string]map[string]int64{}
				add := func(group, key string, v int64) {
					if perKey[group] == nil {
						perKey[group] = map[string]int64{}
					}
					perKey[group][key] += v
				}
				for _, e := range entries {
					days, secs := perDay(e.start, e.end, loc, from, to)
					if len(days) == 0 {
						continue
					}
					var cum, prev int64
					for i, d := range days {
						cum += secs[i]
						r := roundTo(cum, rounding)
						perDayR[d] += r - prev
						prev = r
					}
					raw += cum
					er := roundTo(cum, rounding)
					rounded += er
					if e.billable {
						billR += er
						bill += val(er, e.bill)
					}
					cost += val(er, e.cost)
					add("project", e.project, er)
					add("member", e.user, er)
					client := ""
					if e.project == p1 {
						client = clID
					}
					add("client", client, er)
					add("task", e.task, er)
					if ls := labelsOf[e.task]; len(ls) > 0 {
						for _, l := range ls {
							add("label", l, er)
						}
					} else {
						add("label", "", er)
					}
				}
				if raw != rawSQL {
					t.Fatalf("%s %v: test expectation %d != SQL raw %d", tz, rng, raw, rawSQL)
				}
				for _, group := range work.ReportGroups {
					path := fmt.Sprintf("/api/w/report/time?from=%s&to=%s&group_by=%s&rounding=%d", rng[0], rng[1], group, rounding)
					rep := alice.must("GET", path, nil, 200)
					tot := rep["total"].(map[string]any)
					name := fmt.Sprintf("%s %v r=%d by %s", tz, rng, rounding, group)
					if int64(num(tot["seconds"])) != rawSQL || int64(num(tot["rounded_s"])) != rounded ||
						int64(num(tot["billable_rounded_s"])) != billR {
						t.Errorf("%s: total raw=%v rounded=%v billable=%v, want %d %d %d", name, tot["seconds"], tot["rounded_s"], tot["billable_rounded_s"], rawSQL, rounded, billR)
					}
					if int64(num(tot["billable_minor"])) != bill || int64(num(tot["cost_minor"])) != cost || int64(num(tot["profit_minor"])) != bill-cost {
						t.Errorf("%s: money %v/%v/%v, want %d/%d/%d", name, tot["billable_minor"], tot["cost_minor"], tot["profit_minor"], bill, cost, bill-cost)
					}
					rows := rowsBy(rep)
					var sumRaw, sumR int64
					for _, r := range rows {
						sumRaw += int64(num(r["seconds"]))
						sumR += int64(num(r["rounded_s"]))
					}
					switch group {
					case "day":
						for d, want := range perDayR {
							if got := int64(num(rows[d]["rounded_s"])); got != want {
								t.Errorf("%s: day %s = %d, want %d", name, d, got, want)
							}
						}
						if len(rows) != int(math.Round(to.Sub(from).Hours()/24)) {
							t.Errorf("%s: %d day rows for the range", name, len(rows))
						}
					case "week":
						// Weeks are sums of days; checked through the totals below.
					default:
						for k, want := range perKey[group] {
							if got := int64(num(rows[k]["rounded_s"])); got != want {
								t.Errorf("%s: row %q = %d, want %d", name, k, got, want)
							}
						}
					}
					if group != "label" && (sumRaw != rawSQL || sumR != rounded) {
						t.Errorf("%s: rows add up to raw=%d rounded=%d, total is %d %d", name, sumRaw, sumR, rawSQL, rounded)
					}
					checks++
				}
			}
		}
	}
	t.Logf("report totals matched the raw entries in %d reports (2 timezones × 2 ranges × 5 roundings × 7 groupings)", checks)
	alice.must("PATCH", "/api/w/time/settings", map[string]any{"timezone": "Africa/Cairo", "rounding_minutes": 15}, 200)

	// ---- 2. members: own time, no money; profitability is manager+ ----------------------------------
	own := mia.must("GET", "/api/w/report/time?from=2026-03-01&to=2026-03-31&group_by=member&users="+aliceID, nil, 200)
	if own["own_time_only"] != true || own["finance"] != false {
		t.Errorf("a member's report: own_time_only=%v finance=%v", own["own_time_only"], own["finance"])
	}
	for k := range rowsBy(own) {
		if k != miaID {
			t.Errorf("a member's report contains %s's time", k)
		}
	}
	if b, _ := json.Marshal(own); strings.Contains(string(b), "minor") {
		t.Errorf("a member's report carries money: %s", b)
	}
	if code, b := mia.do("GET", "/api/w/report/profitability?from=2026-03-01&to=2026-03-31", nil); code != 403 {
		t.Errorf("a member read profitability: %d %s", code, b)
	}
	if code, _ := mia.do("GET", "/api/w/report/export?kind=profitability&from=2026-03-01&to=2026-03-31", nil); code != 403 {
		t.Errorf("a member exported profitability: %d", code)
	}
	prof := alice.must("GET", "/api/w/report/profitability?from=2026-03-01&to=2026-03-31", nil, 200)
	pt := prof["total"].(map[string]any)
	if num(pt["profit_minor"]) != num(pt["billable_minor"])-num(pt["cost_minor"]) || num(pt["billable_minor"]) == 0 {
		t.Errorf("profitability total: %v", pt)
	}
	if len(prof["clients"].([]any)) != 2 { // the client, and "no client"
		t.Errorf("profitability by client: %v", prof["clients"])
	}

	// ---- 3. exports are the table ---------------------------------------------------------------------
	q := "from=2026-03-01&to=2026-03-31&group_by=project"
	rep := alice.must("GET", "/api/w/report/time?"+q, nil, 200)
	code, csvBody := alice.do("GET", "/api/w/report/export?"+q+"&format=csv", nil)
	if code != 200 {
		t.Fatalf("csv export: %d %s", code, csvBody)
	}
	records, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(csvBody, []byte("\xEF\xBB\xBF")))).ReadAll()
	if err != nil {
		t.Fatalf("csv does not parse: %v", err)
	}
	wantHeader := []string{"Project", "Tracked", "Rounded", "Hours", "Billable", "Entries", "Billable value (USD)", "Cost (USD)", "Profit (USD)"}
	if strings.Join(records[0], "|") != strings.Join(wantHeader, "|") {
		t.Errorf("csv header %v", records[0])
	}
	var tableRows [][]string
	line := func(name string, r map[string]any) []string {
		return []string{name, work.HM(int64(num(r["seconds"]))), work.HM(int64(num(r["rounded_s"]))), work.Hours(int64(num(r["rounded_s"]))),
			work.HM(int64(num(r["billable_rounded_s"]))), fmt.Sprint(int(num(r["entries"]))),
			work.Money(int64(num(r["billable_minor"]))), work.Money(int64(num(r["cost_minor"]))), work.Money(int64(num(r["profit_minor"])))}
	}
	for _, x := range rep["rows"].([]any) {
		r := x.(map[string]any)
		name := r["name"].(string)
		if r["key"] == "" {
			name = "(none)"
		}
		tableRows = append(tableRows, line(name, r))
	}
	tableRows = append(tableRows, line("Total", rep["total"].(map[string]any)))
	if len(records)-1 != len(tableRows) {
		t.Fatalf("csv has %d rows, the table %d", len(records)-1, len(tableRows))
	}
	for i, want := range tableRows {
		if strings.Join(records[i+1], "|") != strings.Join(want, "|") {
			t.Errorf("csv row %d = %v, table %v", i+1, records[i+1], want)
		}
	}
	code, xlsxBody := alice.do("GET", "/api/w/report/export?"+q+"&format=xlsx", nil)
	if code != 200 {
		t.Fatalf("xlsx export: %d", code)
	}
	book, err := excelize.OpenReader(bytes.NewReader(xlsxBody))
	if err != nil {
		t.Fatalf("xlsx does not open: %v", err)
	}
	sheet, err := book.GetRows("Report")
	if err != nil {
		t.Fatal(err)
	}
	if len(sheet) != len(records) {
		t.Fatalf("xlsx has %d rows, csv %d", len(sheet), len(records))
	}
	for i := range records {
		if strings.Join(sheet[i], "|") != strings.Join(records[i], "|") {
			t.Errorf("xlsx row %d = %v, csv %v", i, sheet[i], records[i])
		}
	}
	// Formula injection is neutralised in names.
	evil := alice.must("POST", "/api/w/projects", map[string]any{"name": "=HYPERLINK(\"http://x\")"}, 201)["id"].(string)
	alice.must("POST", "/api/w/time/entries", map[string]any{"project": evil, "started_at": "2026-03-20T10:00:00Z", "ended_at": "2026-03-20T10:10:00Z"}, 201)
	_, csvBody = alice.do("GET", "/api/w/report/export?"+q+"&format=csv", nil)
	if !strings.Contains(string(csvBody), `'=HYPERLINK`) {
		t.Errorf("a formula-like name must be prefixed with an apostrophe: %s", csvBody)
	}
	ar := alice.must("GET", "/api/w/report/time?"+q, nil, 200)
	_, arCSV := alice.do("GET", "/api/w/report/export?"+q+"&format=csv&lang=ar", nil)
	if !strings.Contains(string(arCSV), "المشروع") || ar == nil {
		t.Errorf("arabic headers missing: %.120s", arCSV)
	}
	t.Logf("csv and xlsx: %d rows, identical to the table", len(tableRows))

	// ---- 4. budget alerts: once at 80%, once at 100% ------------------------------------------------------
	bp := alice.must("POST", "/api/w/projects", map[string]any{"name": "Budgeted " + rnd(), "billing_mode": "hourly", "budget_minutes": 10}, 201)["id"].(string)
	alice.must("PUT", "/api/w/projects/"+bp+"/members/"+miaID, map[string]any{"role": "lead"}, 200)
	alerts := func(user string, threshold int) int {
		var n int
		_ = a.SysDB.QueryRow(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND kind = 'budget.threshold'
			AND data::jsonb ->> 'project_id' = $3 AND (data::jsonb ->> 'threshold')::int = $4`, aID, user, bp, threshold).Scan(&n)
		return n
	}
	logMin := func(day string, minutes int) {
		mia.must("POST", "/api/w/time/entries", map[string]any{"project": bp, "date": day, "minutes": minutes}, 201)
	}
	logMin("2026-04-01", 7)
	if alerts(aliceID, 80)+alerts(miaID, 80) != 0 {
		t.Errorf("an alert fired at 70%%")
	}
	logMin("2026-04-02", 1) // 80%
	if alerts(aliceID, 80) != 1 || alerts(miaID, 80) != 1 {
		t.Errorf("80%% alert: owner %d, lead %d (want 1, 1)", alerts(aliceID, 80), alerts(miaID, 80))
	}
	logMin("2026-04-03", 1) // 90%
	if n, err := sv.CheckBudgets(ctx, time.Now()); err != nil || alerts(aliceID, 80) != 1 {
		t.Errorf("the 80%% alert repeated: job created %d (%v), owner has %d", n, err, alerts(aliceID, 80))
	}
	if alerts(aliceID, 100) != 0 {
		t.Errorf("100%% alert before 100%%")
	}
	logMin("2026-04-04", 1) // 100%
	if alerts(aliceID, 100) != 1 || alerts(miaID, 100) != 1 {
		t.Errorf("100%% alert: owner %d, lead %d", alerts(aliceID, 100), alerts(miaID, 100))
	}
	logMin("2026-04-05", 5)
	if n, err := sv.CheckBudgets(ctx, time.Now()); err != nil || alerts(aliceID, 100) != 1 || alerts(aliceID, 80) != 1 {
		t.Errorf("alerts after more time and the job: job=%d %v, 80=%d 100=%d", n, err, alerts(aliceID, 80), alerts(aliceID, 100))
	}
	bud := alice.must("GET", "/api/w/projects/"+bp+"/budget", nil, 200)
	if bud["level"] != "over" || num(bud["spent_s"]) != 15*60 {
		t.Errorf("project budget: %v", bud)
	}
	if list := mia.must("GET", "/api/w/report/budgets", nil, 200); list["finance"] != false || strings.Contains(fmt.Sprint(list), "spent_minor") {
		t.Errorf("a member's budget list carries money: %v", list)
	}
	t.Logf("budget alerts: 80%% once, 100%% once, to the owner and the lead")

	// ---- 5. notification events ---------------------------------------------------------------------------
	count := func(user, kind string) int {
		var n int
		_ = a.SysDB.QueryRow(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND kind = $3`, aID, user, kind).Scan(&n)
		return n
	}
	task := alice.must("POST", "/api/w/projects/"+p1+"/tasks", map[string]any{"title": "Assigned at creation", "assignee_ids": []string{miaID, aliceID}}, 201)
	key := task["key"].(string)
	if count(miaID, "task.assigned") != 1 || count(aliceID, "task.assigned") != 0 {
		t.Errorf("assigned: mia %d (want 1), alice %d (want 0: the actor)", count(miaID, "task.assigned"), count(aliceID, "task.assigned"))
	}
	alice.must("POST", "/api/w/tasks/"+key+"/comments", map[string]any{"body": "please look @" + miaHandle}, 201)
	if count(miaID, "task.mentioned") != 1 {
		t.Errorf("mentioned: mia %d", count(miaID, "task.mentioned"))
	}
	mia.must("POST", "/api/w/tasks/"+key+"/comments", map[string]any{"body": "self @" + miaHandle}, 201)
	if count(miaID, "task.mentioned") != 1 {
		t.Errorf("mentioning yourself notified you")
	}
	alice.must("POST", "/api/w/tasks/"+key+"/move", map[string]any{"status": "done"}, 200)
	if count(miaID, "task.done") != 1 || count(aliceID, "task.done") != 0 {
		t.Errorf("done: mia %d, alice %d", count(miaID, "task.done"), count(aliceID, "task.done"))
	}
	alice.must("POST", "/api/w/tasks/"+key+"/move", map[string]any{"status": "done", "index": 0}, 200)
	if count(miaID, "task.done") != 1 {
		t.Errorf("a reorder inside done notified again")
	}
	// Mute
	set := mia.must("PATCH", "/api/w/notification-settings", map[string]any{"muted_kinds": []string{"task.mentioned"}}, 200)
	if fmt.Sprint(set["muted_kinds"]) != "[task.mentioned]" || set["email"].(map[string]any)["configured"] != false {
		t.Errorf("settings: %v", set)
	}
	alice.must("POST", "/api/w/tasks/"+key+"/comments", map[string]any{"body": "again @" + miaHandle}, 201)
	if count(miaID, "task.mentioned") != 1 {
		t.Errorf("a muted kind was stored")
	}
	if code, b := mia.do("PATCH", "/api/w/notification-settings", map[string]any{"email_enabled": false}); code != 409 {
		t.Errorf("changing email settings without email configured: %d %s", code, b)
	}
	if code, b := mia.do("PATCH", "/api/w/notification-settings", map[string]any{"muted_kinds": []string{"nope"}}); code != 422 {
		t.Errorf("unknown kind: %d %s", code, b)
	}

	// ---- 6. email: once per item; the digest once per day -------------------------------------------------
	files := func() int {
		m, _ := filepath.Glob(filepath.Join(mailDir, "*.eml"))
		return len(m)
	}
	before := files()
	sent, err := sv.DeliverEmails(ctx)
	if err != nil || sent == 0 || files()-before != sent {
		t.Fatalf("deliver: sent %d, files %d → %d, %v", sent, before, files(), err)
	}
	if again, _ := sv.DeliverEmails(ctx); again != 0 {
		t.Errorf("the second delivery run sent %d", again)
	}
	var unsent int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND email_status IS NULL`, aID).Scan(&unsent)
	if unsent != 0 {
		t.Errorf("%d notifications were not processed", unsent)
	}
	m, _ := filepath.Glob(filepath.Join(mailDir, "*.eml"))
	found := false
	for _, f := range m {
		b, _ := os.ReadFile(f)
		if strings.Contains(string(b), "To: "+miaEmail) && strings.Contains(string(b), key) {
			found = true
		}
	}
	if !found {
		t.Errorf("no email to mia about %s", key)
	}
	// The workspace is in Cairo: send at a moment of today that is at or after 08:00 local.
	cairo, _ := time.LoadLocation("Africa/Cairo")
	nine := time.Now().Add(time.Second)
	if l := nine.In(cairo); l.Hour() < 8 {
		nine = time.Date(l.Year(), l.Month(), l.Day(), 8, 30, 0, 0, cairo)
	}
	lc := nine.In(cairo)
	tomorrow7 := time.Date(lc.Year(), lc.Month(), lc.Day()+1, 7, 0, 0, 0, cairo)
	before = files()
	d1, err := sv.SendDigests(ctx, nine)
	if err != nil || d1 < 1 {
		t.Fatalf("digest: %d %v", d1, err)
	}
	if d2, _ := sv.SendDigests(ctx, nine.Add(10*time.Second)); d2 != 0 {
		t.Errorf("a second digest the same day: %d", d2)
	}
	if early, _ := sv.SendDigests(ctx, tomorrow7); early != 0 {
		t.Errorf("a digest before 08:00 local: %d", early)
	}
	t.Logf("email: %d notification messages, %d digest(s), no repeats (file driver: %d files)", sent, d1, files())

	// ---- 7. saved views ------------------------------------------------------------------------------------------
	mine := mia.must("POST", "/api/w/saved-reports", map[string]any{"name": "My March", "filters": map[string]any{"from": "2026-03-01", "to": "2026-03-31", "group_by": "day"}}, 201)
	if code, _ := mia.do("POST", "/api/w/saved-reports", map[string]any{"name": "x", "shared": true}); code != 403 {
		t.Errorf("a member shared a view: %d", code)
	}
	if code, _ := mia.do("POST", "/api/w/saved-reports", map[string]any{"name": "x", "kind": "profitability"}); code != 403 {
		t.Errorf("a member saved a profitability view: %d", code)
	}
	team := alice.must("POST", "/api/w/saved-reports", map[string]any{"name": "Team by member", "shared": true, "filters": map[string]any{"group_by": "member"}}, 201)
	private := alice.must("POST", "/api/w/saved-reports", map[string]any{"name": "Alice only"}, 201)
	list := mia.must("GET", "/api/w/saved-reports", nil, 200)["reports"].([]any)
	names := []string{}
	for _, x := range list {
		names = append(names, x.(map[string]any)["name"].(string))
	}
	if strings.Join(names, ",") != "My March,Team by member" {
		t.Errorf("mia's views: %v", names)
	}
	if code, _ := mia.do("GET", "/api/w/saved-reports/"+private["id"].(string), nil); code != 404 {
		t.Errorf("mia opened alice's private view: %d", code)
	}
	if code, _ := mia.do("DELETE", "/api/w/saved-reports/"+team["id"].(string), nil); code != 403 {
		t.Errorf("mia deleted a shared view: %d", code)
	}
	if code, _ := mia.do("PATCH", "/api/w/saved-reports/"+mine["id"].(string), map[string]any{"filters": map[string]any{"group_by": "hour"}}); code != 422 {
		t.Errorf("a bad grouping was saved: %d", code)
	}
	upd := mia.must("PATCH", "/api/w/saved-reports/"+mine["id"].(string), map[string]any{"name": "March by day"}, 200)
	if upd["name"] != "March by day" || upd["filters"].(map[string]any)["group_by"] != "day" {
		t.Errorf("rename lost the filters: %v", upd)
	}
	mia.must("DELETE", "/api/w/saved-reports/"+mine["id"].(string), nil, 204)
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}
