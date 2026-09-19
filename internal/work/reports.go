package work

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/workspaces"
)

/*
Reports (plan: "Reports", P5). One aggregate over time_entries, grouped by project, member, client,
label, task, day or week, over a range of local days in the workspace timezone.

The rules, in one place:

	range      [from 00:00, to+1 00:00) local. An entry is clipped to it; a running entry counts up
	           to now.
	days       every entry is cut at local midnight (SplitByDay), so a 23:00–01:00 entry is one hour
	           on each day — also for week buckets and the daily series.
	rounding   applied HERE, at report time, never stored: an entry's in-range time is rounded to
	           rounding_minutes (half up). When an entry falls into several day/week buckets its
	           rounded total is distributed with cumulative rounding — bucket i gets
	           R(s1+…+si) − R(s1+…+s(i−1)) — so the buckets of an entry always add up to exactly
	           R(total), and the rows of any grouping add up to the report total.
	labels     an entry counts under EVERY label of its task (and under "no label" when there is
	           none), so label rows can add up to more than the total; the total counts each entry
	           once.
	money      value = round(rounded seconds × rate snapshot / 3600), half up, in minor units, on
	           the same cumulative rule. Billable value uses the bill rate of billable entries; cost
	           value the cost rate of every entry; profit = billable − cost. Only entries in the
	           workspace's current currency are valued (the others are counted in
	           other_currency_entries). Money is manager+ (reports:finance); nobody else receives it.
	who        a member's report is their own time, whatever they ask for; managers see everyone.

REST: /api/w/report/{time,export,budgets,profitability}; MCP: time_summary, budget_status,
profitability (internal/mcp/report_tools.go).
*/

// Report groupings.
var ReportGroups = []string{"project", "member", "client", "label", "task", "day", "week"}

// ReportQuery is what a time report is asked for (also the saved-view filter shape).
type ReportQuery struct {
	From     string   `json:"from,omitempty" doc:"YYYY-MM-DD, workspace timezone (default: the 1st of this month)"`
	To       string   `json:"to,omitempty" doc:"YYYY-MM-DD, inclusive (default: today)"`
	GroupBy  string   `json:"group_by,omitempty" enum:"project,member,client,label,task,day,week" doc:"Default project"`
	Users    []string `json:"users,omitempty" doc:"User ids (managers); a member always gets their own time"`
	Projects []string `json:"projects,omitempty" doc:"Project ids"`
	Clients  []string `json:"clients,omitempty" doc:"Client ids"`
	Labels   []string `json:"labels,omitempty" doc:"Label ids: entries on a task carrying any of them"`
	Billable string   `json:"billable,omitempty" enum:"billable,non_billable" doc:"Only billable or only non-billable entries"`
	Rounding *int     `json:"rounding,omitempty" doc:"Round each entry to this many minutes (0 = none); default the workspace setting"`
}

// ReportRow is one group of a report (or its total).
type ReportRow struct {
	Key             string  `json:"key" doc:"The group's id (project/user/client/label/task id, or the local date); empty = none"`
	Name            string  `json:"name"`
	Color           *string `json:"color,omitempty"`
	Seconds         int64   `json:"seconds" doc:"Raw tracked time in range"`
	Rounded         int64   `json:"rounded_s" doc:"After rounding"`
	BillableSeconds int64   `json:"billable_s"`
	BillableRounded int64   `json:"billable_rounded_s"`
	Entries         int     `json:"entries"`
	BillableMinor   *int64  `json:"billable_minor,omitempty" doc:"Billable value, minor units (finance only)"`
	CostMinor       *int64  `json:"cost_minor,omitempty" doc:"Cost value, minor units (finance only)"`
	ProfitMinor     *int64  `json:"profit_minor,omitempty" doc:"Billable − cost (finance only)"`

	entries map[string]bool
}

// ReportPoint is one local day of the report's series (rounded, all groups).
type ReportPoint struct {
	Day         string `json:"day"`
	Rounded     int64  `json:"rounded_s"`
	Billable    int64  `json:"billable_rounded_s"`
	NonBillable int64  `json:"non_billable_rounded_s"`
}

// TimeReport is the answer to a ReportQuery.
type TimeReport struct {
	From                 string        `json:"from"`
	To                   string        `json:"to"`
	GroupBy              string        `json:"group_by"`
	Timezone             string        `json:"timezone"`
	WeekStart            int           `json:"week_start"`
	RoundingMinutes      int           `json:"rounding_minutes"`
	Currency             string        `json:"currency"`
	Finance              bool          `json:"finance" doc:"Money columns are present"`
	OwnTimeOnly          bool          `json:"own_time_only" doc:"The caller sees only their own time"`
	Rows                 []ReportRow   `json:"rows"`
	Total                ReportRow     `json:"total"`
	Series               []ReportPoint `json:"series" doc:"Per local day"`
	OtherCurrencyEntries int           `json:"other_currency_entries" doc:"Entries in another currency: counted in time, not valued"`
	GeneratedAt          time.Time     `json:"generated_at"`
}

// reportEntry is one entry as the aggregate needs it.
type reportEntry struct {
	ID, UserID                           string
	ProjectID, ProjectName, ProjectColor *string
	TaskID, TaskKey, TaskTitle           *string
	ClientID, ClientName                 *string
	Start                                time.Time
	End                                  *time.Time
	Billable                             bool
	Bill, Cost                           *int64
	Currency                             string
}

const maxReportDays = 400

// reportRange resolves [from, to] to local midnights. Default: the 1st of this month to today.
func reportRange(from, to string, c *timeConf, now time.Time) (start, end time.Time, err error) {
	f, err := localDay(from, c.Loc)
	if err != nil {
		return
	}
	t, err := localDay(to, c.Loc)
	if err != nil {
		return
	}
	n := now.In(c.Loc)
	if t == nil {
		d := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, c.Loc)
		t = &d
	}
	if f == nil {
		d := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, c.Loc)
		f = &d
	}
	if t.Before(*f) {
		return start, end, invalid("from is after to")
	}
	start = *f
	end = time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, c.Loc)
	if days := int(end.Sub(start).Hours()/24 + 0.5); days > maxReportDays {
		return start, end, invalid("a report covers at most %d days", maxReportDays)
	}
	return start, end, nil
}

func cleanIDs(in []string) []string {
	out := []string{}
	for _, v := range in {
		for _, p := range strings.Split(v, ",") {
			if p = strings.TrimSpace(p); p != "" && len(out) < 200 {
				out = append(out, p)
			}
		}
	}
	return dedupe(out)
}

// valueMinor is round(seconds × rate / 3600), half up (seconds, rate >= 0).
func valueMinor(seconds, rate int64) int64 { return (seconds*rate + 1800) / 3600 }

func ptr64(v int64) *int64 { return &v }

// weekOf returns the local date (YYYY-MM-DD) of the first day of day's week.
func weekOf(day string, weekStart int) string {
	d, err := time.Parse("2006-01-02", day)
	if err != nil {
		return day
	}
	back := (int(d.Weekday()) - weekStart + 7) % 7
	return d.AddDate(0, 0, -back).Format("2006-01-02")
}

// loadReportEntries reads the entries overlapping [start, end) that match q (ids already cleaned).
func (sv *Service) loadReportEntries(ctx context.Context, ws string, start, end time.Time, q ReportQuery) ([]reportEntry, error) {
	args := []any{ws, end.UTC(), start.UTC()}
	where := `WHERE e.workspace_id = $1 AND e.started_at < $2 AND (e.ended_at IS NULL OR e.ended_at > $3)`
	in := func(expr string, ids []string) {
		if len(ids) == 0 {
			return
		}
		args = append(args, strings.Join(ids, ","))
		where += " AND " + expr + " = ANY(string_to_array($" + strconv.Itoa(len(args)) + ", ','))"
	}
	in("e.user_id", q.Users)
	in("e.project_id", q.Projects)
	in("coalesce(e.client_id, p.client_id)", q.Clients)
	if len(q.Labels) > 0 {
		args = append(args, strings.Join(q.Labels, ","))
		where += ` AND EXISTS (SELECT 1 FROM task_labels tl WHERE tl.workspace_id = e.workspace_id AND tl.task_id = e.task_id
			AND tl.label_id = ANY(string_to_array($` + strconv.Itoa(len(args)) + `, ',')))`
	}
	switch q.Billable {
	case "billable":
		where += " AND e.billable"
	case "non_billable":
		where += " AND NOT e.billable"
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT e.id, e.user_id, e.project_id, p.name, p.color, e.task_id, t.key, t.title,
		coalesce(e.client_id, p.client_id), c.name, e.started_at, e.ended_at, e.billable, e.bill_rate_minor, e.cost_rate_minor, e.currency
		FROM time_entries e
		LEFT JOIN projects p ON p.workspace_id = e.workspace_id AND p.id = e.project_id
		LEFT JOIN tasks t ON t.workspace_id = e.workspace_id AND t.id = e.task_id
		LEFT JOIN clients c ON c.workspace_id = e.workspace_id AND c.id = coalesce(e.client_id, p.client_id) `+
		where+` ORDER BY e.started_at, e.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []reportEntry
	for rows.Next() {
		var e reportEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.ProjectID, &e.ProjectName, &e.ProjectColor, &e.TaskID, &e.TaskKey, &e.TaskTitle,
			&e.ClientID, &e.ClientName, &e.Start, &e.End, &e.Billable, &e.Bill, &e.Cost, &e.Currency); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

type labelRef struct{ ID, Name, Color string }

func (sv *Service) taskLabels(ctx context.Context, ws string, entries []reportEntry) (map[string][]labelRef, error) {
	ids := []string{}
	seen := map[string]bool{}
	for _, e := range entries {
		if e.TaskID != nil && !seen[*e.TaskID] {
			seen[*e.TaskID] = true
			ids = append(ids, *e.TaskID)
		}
	}
	out := map[string][]labelRef{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT tl.task_id, l.id, l.name, l.color FROM task_labels tl
		JOIN labels l ON l.workspace_id = tl.workspace_id AND l.id = tl.label_id
		WHERE tl.workspace_id = $1 AND tl.task_id = ANY(string_to_array($2, ',')) ORDER BY lower(l.name)`, ws, strings.Join(ids, ","))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var task string
		var l labelRef
		if err := rows.Scan(&task, &l.ID, &l.Name, &l.Color); err != nil {
			return nil, err
		}
		out[task] = append(out[task], l)
	}
	return out, rows.Err()
}

// memberNames maps user ids to e-mail addresses (the owner pool: the app role cannot read users).
func (sv *Service) memberNames(ctx context.Context, ws string) map[string]string {
	out := map[string]string{}
	if sv.Sys == nil {
		return out
	}
	list, err := workspaces.Members(ctx, sv.Sys, ws)
	if err != nil {
		return out
	}
	for _, m := range list {
		out[m.UserID] = m.Email
	}
	return out
}

// reportScope applies the caller's limits to q: a member's report is their own time.
func reportScope(s *tenant.Scope, q *ReportQuery) (ownOnly bool) {
	if authz.Can(s.Role, authz.ReportsAll) {
		return false
	}
	q.Users = []string{s.UserID}
	return true
}

// TimeReport aggregates tracked time (see the package comment above for the rules).
func (sv *Service) TimeReport(ctx context.Context, q ReportQuery) (*TimeReport, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ReportsRead); err != nil {
		return nil, err
	}
	return sv.timeReport(ctx, s, q, time.Now().UTC())
}

func (sv *Service) timeReport(ctx context.Context, s *tenant.Scope, q ReportQuery, now time.Time) (*TimeReport, error) {
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	start, end, err := reportRange(q.From, q.To, conf, now)
	if err != nil {
		return nil, err
	}
	group := strings.TrimSpace(q.GroupBy)
	if group == "" {
		group = "project"
	}
	if err := oneOf("group_by", group, ReportGroups...); err != nil {
		return nil, err
	}
	if q.Billable != "" {
		if err := oneOf("billable", q.Billable, "billable", "non_billable"); err != nil {
			return nil, err
		}
	}
	rounding := conf.Rounding
	if q.Rounding != nil {
		if *q.Rounding < 0 || *q.Rounding > 240 {
			return nil, invalid("rounding is between 0 and 240 minutes")
		}
		rounding = *q.Rounding
	}
	q.Users, q.Projects, q.Clients, q.Labels = cleanIDs(q.Users), cleanIDs(q.Projects), cleanIDs(q.Clients), cleanIDs(q.Labels)
	ownOnly := reportScope(s, &q)
	finance := authz.Can(s.Role, authz.ReportsFinance)

	entries, err := sv.loadReportEntries(ctx, s.WorkspaceID, start, end, q)
	if err != nil {
		return nil, err
	}
	var labels map[string][]labelRef
	if group == "label" {
		if labels, err = sv.taskLabels(ctx, s.WorkspaceID, entries); err != nil {
			return nil, err
		}
	}
	var names map[string]string
	if group == "member" {
		names = sv.memberNames(ctx, s.WorkspaceID)
	}

	rep := &TimeReport{From: start.Format("2006-01-02"), To: end.AddDate(0, 0, -1).Format("2006-01-02"), GroupBy: group,
		Timezone: conf.Timezone, WeekStart: conf.WeekStart, RoundingMinutes: rounding, Currency: conf.Currency,
		Finance: finance, OwnTimeOnly: ownOnly, Rows: []ReportRow{}, Series: []ReportPoint{}, GeneratedAt: now}
	rows := map[string]*ReportRow{}
	var order []string
	row := func(key, name string, color *string) *ReportRow {
		r := rows[key]
		if r == nil {
			r = &ReportRow{Key: key, Name: name, Color: color, entries: map[string]bool{}}
			if finance {
				r.BillableMinor, r.CostMinor, r.ProfitMinor = ptr64(0), ptr64(0), ptr64(0)
			}
			rows[key] = r
			order = append(order, key)
		}
		return r
	}
	// Day and week reports list every bucket of the range, empty ones included (the chart's x axis).
	series := map[string]*ReportPoint{}
	for d := start; d.Before(end); d = time.Date(d.Year(), d.Month(), d.Day()+1, 0, 0, 0, 0, conf.Loc) {
		day := d.Format("2006-01-02")
		p := &ReportPoint{Day: day}
		series[day] = p
		rep.Series = append(rep.Series, *p)
		switch group {
		case "day":
			row(day, day, nil)
		case "week":
			w := weekOf(day, conf.WeekStart)
			row(w, w, nil)
		}
	}
	total := &ReportRow{Name: "total", entries: map[string]bool{}}
	if finance {
		total.BillableMinor, total.CostMinor, total.ProfitMinor = ptr64(0), ptr64(0), ptr64(0)
	}
	add := func(r *ReportRow, id string, raw, rounded int64, billable bool, bill, cost int64) {
		r.Seconds += raw
		r.Rounded += rounded
		if billable {
			r.BillableSeconds += raw
			r.BillableRounded += rounded
		}
		r.entries[id] = true
		if r.BillableMinor != nil {
			*r.BillableMinor += bill
			*r.CostMinor += cost
			*r.ProfitMinor += bill - cost
		}
	}

	for _, e := range entries {
		stop := now
		if e.End != nil {
			stop = *e.End
		}
		from, until := e.Start, stop
		if from.Before(start) {
			from = start
		}
		if until.After(end) {
			until = end
		}
		slices := SplitByDay(from, until, conf.Loc)
		if len(slices) == 0 {
			continue
		}
		valued := e.Currency == conf.Currency
		if !valued {
			rep.OtherCurrencyEntries++
		}
		// The fixed group key(s) of this entry (day/week keys come from each slice).
		var fixed []*ReportRow
		switch group {
		case "project":
			if e.ProjectID == nil {
				fixed = []*ReportRow{row("", "", nil)}
			} else {
				fixed = []*ReportRow{row(*e.ProjectID, sval(e.ProjectName), e.ProjectColor)}
			}
		case "member":
			name := names[e.UserID]
			if name == "" {
				name = e.UserID
			}
			fixed = []*ReportRow{row(e.UserID, name, nil)}
		case "client":
			if e.ClientID == nil {
				fixed = []*ReportRow{row("", "", nil)}
			} else {
				fixed = []*ReportRow{row(*e.ClientID, sval(e.ClientName), nil)}
			}
		case "task":
			if e.TaskID == nil {
				fixed = []*ReportRow{row("", "", nil)}
			} else {
				fixed = []*ReportRow{row(*e.TaskID, sval(e.TaskKey)+" "+sval(e.TaskTitle), e.ProjectColor)}
			}
		case "label":
			var ls []labelRef
			if e.TaskID != nil {
				ls = labels[*e.TaskID]
			}
			if len(ls) == 0 {
				fixed = []*ReportRow{row("", "", nil)}
			}
			for _, l := range ls {
				c := l.Color
				fixed = append(fixed, row(l.ID, l.Name, &c))
			}
		}
		var cum, prevR, prevBill, prevCost int64
		for _, sl := range slices {
			cum += sl.Seconds
			r := RoundSeconds(cum, rounding)
			rounded := r - prevR
			var bill, cost int64
			if finance && valued {
				if e.Billable && e.Bill != nil {
					v := valueMinor(r, *e.Bill)
					bill, prevBill = v-prevBill, v
				}
				if e.Cost != nil {
					v := valueMinor(r, *e.Cost)
					cost, prevCost = v-prevCost, v
				}
			}
			prevR = r
			targets := fixed
			switch group {
			case "day":
				targets = []*ReportRow{row(sl.Day, sl.Day, nil)}
			case "week":
				w := weekOf(sl.Day, conf.WeekStart)
				targets = []*ReportRow{row(w, w, nil)}
			}
			for _, t := range targets {
				add(t, e.ID, sl.Seconds, rounded, e.Billable, bill, cost)
			}
			add(total, e.ID, sl.Seconds, rounded, e.Billable, bill, cost)
			if p := series[sl.Day]; p != nil {
				p.Rounded += rounded
				if e.Billable {
					p.Billable += rounded
				} else {
					p.NonBillable += rounded
				}
			}
		}
	}

	for i := range rep.Series {
		rep.Series[i] = *series[rep.Series[i].Day]
	}
	for _, k := range order {
		r := rows[k]
		r.Entries = len(r.entries)
		rep.Rows = append(rep.Rows, *r)
	}
	if group != "day" && group != "week" {
		sort.SliceStable(rep.Rows, func(i, j int) bool {
			a, b := rep.Rows[i], rep.Rows[j]
			if (a.Key == "") != (b.Key == "") {
				return b.Key == "" // "none" last
			}
			if a.Rounded != b.Rounded {
				return a.Rounded > b.Rounded
			}
			return strings.ToLower(a.Name) < strings.ToLower(b.Name)
		})
	}
	total.Entries = len(total.entries)
	rep.Total = *total
	return rep, nil
}

// ---- budgets ------------------------------------------------------------------------------------------

// Budget is one project's burn against its budget. Burn is ALL tracked time on the project, unrounded,
// a running timer up to now; the money burn is the billable value (bill-rate snapshot × time) of
// billable entries in the workspace currency. Money fields are manager+ only.
type Budget struct {
	ProjectID     string   `json:"project_id"`
	ProjectName   string   `json:"project_name"`
	ProjectColor  string   `json:"project_color"`
	ClientName    *string  `json:"client_name"`
	BillingMode   string   `json:"billing_mode"`
	Archived      bool     `json:"archived"`
	BudgetMinutes *int64   `json:"budget_minutes"`
	SpentSeconds  int64    `json:"spent_s"`
	HoursPercent  *float64 `json:"hours_percent" doc:"spent / budget × 100; null without an hours budget"`
	BudgetMinor   *int64   `json:"budget_minor,omitempty" doc:"finance only"`
	SpentMinor    *int64   `json:"spent_minor,omitempty" doc:"finance only"`
	MoneyPercent  *float64 `json:"money_percent,omitempty" doc:"finance only"`
	Currency      string   `json:"currency"`
	Level         string   `json:"level" doc:"none (no budget), ok (< 80%), warning (>= 80%), over (>= 100%)"`
}

// BudgetList is the body of GET /api/w/report/budgets.
type BudgetList struct {
	Budgets []Budget `json:"budgets"`
	Finance bool     `json:"finance"`
}

func pct(spent, budget int64) *float64 {
	if budget <= 0 {
		return nil
	}
	v := float64(spent) * 100 / float64(budget)
	return &v
}

func level(ps ...*float64) string {
	out := "none"
	for _, p := range ps {
		if p == nil {
			continue
		}
		switch {
		case *p >= 100:
			return "over"
		case *p >= 80:
			out = "warning"
		case out == "none":
			out = "ok"
		}
	}
	return out
}

const budgetSelect = `SELECT p.id, p.name, p.color, c.name, p.billing_mode, p.archived_at IS NOT NULL, p.budget_minutes, p.budget_minor,
	coalesce((SELECT sum(floor(extract(epoch FROM coalesce(e.ended_at, $2::timestamptz) - e.started_at)))::bigint
	          FROM time_entries e WHERE e.workspace_id = p.workspace_id AND e.project_id = p.id AND e.started_at < $2::timestamptz), 0),
	coalesce((SELECT sum(round(floor(extract(epoch FROM coalesce(e.ended_at, $2::timestamptz) - e.started_at))::numeric * e.bill_rate_minor / 3600))::bigint
	          FROM time_entries e WHERE e.workspace_id = p.workspace_id AND e.project_id = p.id AND e.started_at < $2::timestamptz
	            AND e.billable AND e.bill_rate_minor IS NOT NULL AND e.currency = w.currency), 0),
	w.currency
	FROM projects p
	JOIN workspaces w ON w.id = p.workspace_id
	LEFT JOIN clients c ON c.workspace_id = p.workspace_id AND c.id = p.client_id `

func scanBudget(r scanner, finance bool) (*Budget, error) {
	b := &Budget{}
	var budgetMinor *int64
	var spentMinor int64
	if err := r.Scan(&b.ProjectID, &b.ProjectName, &b.ProjectColor, &b.ClientName, &b.BillingMode, &b.Archived,
		&b.BudgetMinutes, &budgetMinor, &b.SpentSeconds, &spentMinor, &b.Currency); err != nil {
		return nil, err
	}
	if b.BudgetMinutes != nil {
		b.HoursPercent = pct(b.SpentSeconds, *b.BudgetMinutes*60)
	}
	var money *float64
	if budgetMinor != nil {
		money = pct(spentMinor, *budgetMinor)
	}
	if finance {
		b.BudgetMinor, b.SpentMinor, b.MoneyPercent = budgetMinor, &spentMinor, money
		b.Level = level(b.HoursPercent, money)
	} else {
		b.Level = level(b.HoursPercent)
	}
	return b, nil
}

// Budgets lists the burn of every visible project that has a budget (archived ones last).
func (sv *Service) Budgets(ctx context.Context) (*BudgetList, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ReportsRead); err != nil {
		return nil, err
	}
	finance := authz.Can(s.Role, authz.ReportsFinance)
	args := []any{s.WorkspaceID, time.Now().UTC()}
	budgetCond := "p.budget_minutes IS NOT NULL"
	if finance {
		budgetCond = "(p.budget_minutes IS NOT NULL OR p.budget_minor IS NOT NULL)"
	}
	rows, err := sv.DB.QueryContext(ctx, budgetSelect+`WHERE p.workspace_id = $1 AND `+budgetCond+` AND `+visibleClause(s, &args)+`
		ORDER BY p.archived_at IS NOT NULL, lower(p.name)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &BudgetList{Budgets: []Budget{}, Finance: finance}
	for rows.Next() {
		b, err := scanBudget(rows, finance)
		if err != nil {
			return nil, err
		}
		out.Budgets = append(out.Budgets, *b)
	}
	return out, rows.Err()
}

// ProjectBudget is one visible project's burn (level "none" when it has no budget).
func (sv *Service) ProjectBudget(ctx context.Context, ref string) (*Budget, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := sv.FindProject(ctx, ref)
	if err != nil {
		return nil, err
	}
	// Clients see the project but not its time.
	if err := require(s, authz.ReportsRead); err != nil {
		return nil, err
	}
	finance := authz.Can(s.Role, authz.ReportsFinance)
	return scanBudget(sv.DB.QueryRowContext(ctx, budgetSelect+`WHERE p.workspace_id = $1 AND p.id = $3`, s.WorkspaceID, time.Now().UTC(), p.ID), finance)
}

// ---- profitability ------------------------------------------------------------------------------------

// ProfitRow is one project or client.
type ProfitRow struct {
	Key           string   `json:"key"`
	Name          string   `json:"name"`
	Color         *string  `json:"color,omitempty"`
	Seconds       int64    `json:"rounded_s"`
	Billable      int64    `json:"billable_rounded_s"`
	BillableMinor int64    `json:"billable_minor"`
	CostMinor     int64    `json:"cost_minor"`
	ProfitMinor   int64    `json:"profit_minor"`
	MarginPercent *float64 `json:"margin_percent" doc:"profit / billable × 100; null without billable value"`
}

// Profitability is billable value − cost value per project and per client (manager+).
type Profitability struct {
	From            string      `json:"from"`
	To              string      `json:"to"`
	Currency        string      `json:"currency"`
	RoundingMinutes int         `json:"rounding_minutes"`
	Projects        []ProfitRow `json:"projects"`
	Clients         []ProfitRow `json:"clients"`
	Total           ProfitRow   `json:"total"`
	OtherCurrency   int         `json:"other_currency_entries"`
}

func profitRows(in []ReportRow) []ProfitRow {
	out := make([]ProfitRow, 0, len(in))
	for _, r := range in {
		out = append(out, profitRow(r))
	}
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].Key == "") != (out[j].Key == "") {
			return out[j].Key == ""
		}
		return out[i].ProfitMinor > out[j].ProfitMinor
	})
	return out
}

func profitRow(r ReportRow) ProfitRow {
	p := ProfitRow{Key: r.Key, Name: r.Name, Color: r.Color, Seconds: r.Rounded, Billable: r.BillableRounded}
	if r.BillableMinor != nil {
		p.BillableMinor, p.CostMinor, p.ProfitMinor = *r.BillableMinor, *r.CostMinor, *r.ProfitMinor
	}
	if p.BillableMinor > 0 {
		m := float64(p.ProfitMinor) * 100 / float64(p.BillableMinor)
		p.MarginPercent = &m
	}
	return p
}

// Profitability answers per project and per client over a range (manager+, reports:finance).
func (sv *Service) Profitability(ctx context.Context, q ReportQuery) (*Profitability, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ReportsFinance); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	q.GroupBy = "project"
	byProject, err := sv.timeReport(ctx, s, q, now)
	if err != nil {
		return nil, err
	}
	q.GroupBy = "client"
	byClient, err := sv.timeReport(ctx, s, q, now)
	if err != nil {
		return nil, err
	}
	return &Profitability{From: byProject.From, To: byProject.To, Currency: byProject.Currency, RoundingMinutes: byProject.RoundingMinutes,
		Projects: profitRows(byProject.Rows), Clients: profitRows(byClient.Rows), Total: profitRow(byProject.Total),
		OtherCurrency: byProject.OtherCurrencyEntries}, nil
}
