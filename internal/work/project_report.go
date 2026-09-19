package work

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
The project report: one visible project's summary, progress, budget burn, time by member and
by week, open issues and recent activity, as JSON (what the UI can render) or as a Doc rendered
to Markdown / PDF.

Every number comes from the function the UI already uses, never a second computation:
  - progress: Project.Tasks (the Overview's todo / doing / done), % done rounded like the page
    (Math.round(done / total × 100)); tasks by status from GetProject's Statuses
  - budget: ProjectBudget (the Overview's budget panel)
  - time: TimeReport filtered to the project, grouped by member and by week (the reports page)
  - activity: ProjectActivity (the Overview's feed)
  - open issues: the issues list's rows for the project with state = open (feedback:read)

Role rules follow: the caller must see the project and hold reports:read (clients see a project
but not its time, so they get 403); a member's time sections cover their own time (as on the
reports page), money only with reports:finance.
*/

// ProjectIssue is one open issue of the project.
type ProjectIssue struct {
	Key       string    `json:"key"`
	Title     string    `json:"title"`
	Type      string    `json:"type"`
	Status    string    `json:"status"`
	Priority  string    `json:"priority"`
	CreatedAt time.Time `json:"created_at"`
}

// ProjectActivityLine is one recent activity entry with the actor resolved.
type ProjectActivityLine struct {
	At      time.Time `json:"at"`
	Actor   string    `json:"actor"`
	Action  string    `json:"action"`
	Subject string    `json:"subject"`
}

// ProjectReport is GET /api/w/projects/{project}/report?format=json.
type ProjectReport struct {
	Project        Project               `json:"project"`
	From           string                `json:"from"`
	To             string                `json:"to"`
	Timezone       string                `json:"timezone"`
	TotalTasks     int                   `json:"total_tasks"`
	PercentDone    int                   `json:"percent_done" doc:"round(done / total × 100), as on the Overview"`
	Statuses       []Status              `json:"statuses" doc:"Tasks by status"`
	Budget         *Budget               `json:"budget"`
	ByMember       *TimeReport           `json:"by_member"`
	ByWeek         *TimeReport           `json:"by_week"`
	IssuesVisible  bool                  `json:"issues_visible" doc:"false when the caller cannot read issues"`
	OpenIssueCount int                   `json:"open_issue_count"`
	OpenIssues     []ProjectIssue        `json:"open_issues" doc:"Up to 50, board order"`
	Activity       []ProjectActivityLine `json:"activity" doc:"The 20 most recent entries"`
	GeneratedAt    time.Time             `json:"generated_at"`
}

// ProjectReport builds the report. from/to are YYYY-MM-DD in the workspace timezone; the default
// covers the project from its start (or creation) to today, capped at the report limit.
func (sv *Service) ProjectReport(ctx context.Context, ref, from, to string) (*ProjectReport, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := sv.FindProject(ctx, ref)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ReportsRead); err != nil {
		return nil, err
	}
	detail, err := sv.GetProject(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	now := time.Now().In(conf.Loc)
	today := now.Format("2006-01-02")
	if strings.TrimSpace(to) == "" {
		to = today
	}
	if strings.TrimSpace(from) == "" {
		start := detail.CreatedAt.In(conf.Loc).Format("2006-01-02")
		if detail.StartsOn != nil && *detail.StartsOn < start {
			start = *detail.StartsOn
		}
		if start > to {
			start = to
		}
		if t, err := time.ParseInLocation("2006-01-02", to, conf.Loc); err == nil {
			if earliest := t.AddDate(0, 0, -(maxReportDays - 1)).Format("2006-01-02"); start < earliest {
				start = earliest
			}
		}
		from = start
	}

	out := &ProjectReport{Project: detail.Project, Timezone: conf.Timezone, Statuses: detail.Statuses,
		OpenIssues: []ProjectIssue{}, Activity: []ProjectActivityLine{}, GeneratedAt: time.Now().UTC()}
	if out.Statuses == nil {
		out.Statuses = []Status{}
	}
	t := detail.Tasks
	out.TotalTasks = t.Todo + t.Doing + t.Done
	if out.TotalTasks > 0 {
		out.PercentDone = int(math.Round(float64(t.Done) / float64(out.TotalTasks) * 100))
	}
	if out.Budget, err = sv.ProjectBudget(ctx, p.ID); err != nil {
		return nil, err
	}
	q := ReportQuery{From: from, To: to, Projects: []string{p.ID}, GroupBy: "member"}
	if out.ByMember, err = sv.TimeReport(ctx, q); err != nil {
		return nil, err
	}
	q.GroupBy = "week"
	if out.ByWeek, err = sv.TimeReport(ctx, q); err != nil {
		return nil, err
	}
	out.From, out.To = out.ByMember.From, out.ByMember.To

	if authz.Can(s.Role, authz.FeedbackRead) {
		out.IssuesVisible = true
		if err := sv.DB.QueryRowContext(ctx, `SELECT count(*) FROM reports WHERE workspace_id = $1 AND project_id = $2 AND state = 'open'`,
			s.WorkspaceID, p.ID).Scan(&out.OpenIssueCount); err != nil {
			return nil, err
		}
		rows, err := sv.DB.QueryContext(ctx, `SELECT key, title, issue_type, status, priority, created_at FROM reports
			WHERE workspace_id = $1 AND project_id = $2 AND state = 'open' ORDER BY sort_order, number LIMIT 50`, s.WorkspaceID, p.ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var i ProjectIssue
			if err := rows.Scan(&i.Key, &i.Title, &i.Type, &i.Status, &i.Priority, &i.CreatedAt); err != nil {
				rows.Close()
				return nil, err
			}
			out.OpenIssues = append(out.OpenIssues, i)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	acts, err := sv.ProjectActivity(ctx, p.ID, 20)
	if err != nil {
		return nil, err
	}
	names := sv.memberNames(ctx, s.WorkspaceID)
	for _, a := range acts {
		actor := names[a.ActorID]
		if actor == "" {
			actor = a.ActorID
		}
		out.Activity = append(out.Activity, ProjectActivityLine{At: a.CreatedAt, Actor: actor, Action: a.Action, Subject: activitySubject(a)})
	}
	return out, nil
}

func activitySubject(a Activity) string {
	for _, k := range []string{"title", "name", "key"} {
		if v, ok := a.Changes[k].(string); ok && v != "" {
			return v
		}
	}
	return a.SubjectType
}

// ---- documents ------------------------------------------------------------------------------------

var docText = map[string]map[string]string{
	"en": {
		"time_report": "Time report", "profitability_report": "Profitability", "project_report": "Project report",
		"range": "Period", "group_by": "Grouped by", "rounding": "Rounding", "timezone": "Timezone", "currency": "Currency",
		"generated": "Generated", "own_time": "This report covers only your own time.", "none_rounding": "none", "min": "min",
		"other_currency": "%d entries in another currency are counted in time but not valued.",
		"summary":        "Summary", "progress": "Progress", "budget": "Budget", "time_member": "Time by member", "time_week": "Time by week",
		"open_issues": "Open issues", "activity": "Recent activity", "status": "Status", "client": "Client", "billing": "Billing",
		"dates": "Dates", "tasks": "Tasks", "done_pct": "Done", "todo": "To do", "doing": "In progress", "done": "Done",
		"category": "Category", "count": "Tasks", "hours_budget": "Hours budget", "money_budget": "Money budget", "spent": "Spent",
		"level": "Level", "no_budget": "No budget is set.", "no_time": "No time tracked in this period.",
		"no_issues": "No open issues.", "no_activity": "No activity yet.", "issues_hidden": "Your role cannot read issues.",
		"key": "Key", "title": "Title", "type": "Type", "priority": "Priority", "opened": "Opened", "when": "When", "who": "Who",
		"action": "Action", "subject": "Subject", "showing": "Showing %d of %d.", "description": "Description", "archived": "Archived",
	},
	"ar": {
		"time_report": "تقرير الوقت", "profitability_report": "الربحية", "project_report": "تقرير المشروع",
		"range": "الفترة", "group_by": "مجمّع حسب", "rounding": "التقريب", "timezone": "المنطقة الزمنية", "currency": "العملة",
		"generated": "أُنشئ في", "own_time": "يغطي هذا التقرير وقتك أنت فقط.", "none_rounding": "بلا", "min": "دقيقة",
		"other_currency": "%d إدخالًا بعملة أخرى محسوبة في الوقت دون قيمة.",
		"summary":        "الملخص", "progress": "التقدم", "budget": "الميزانية", "time_member": "الوقت حسب العضو", "time_week": "الوقت حسب الأسبوع",
		"open_issues": "المشكلات المفتوحة", "activity": "آخر النشاط", "status": "الحالة", "client": "العميل", "billing": "الفوترة",
		"dates": "التواريخ", "tasks": "المهام", "done_pct": "المنجز", "todo": "للتنفيذ", "doing": "قيد التنفيذ", "done": "منجز",
		"category": "الفئة", "count": "المهام", "hours_budget": "ميزانية الساعات", "money_budget": "الميزانية المالية", "spent": "المصروف",
		"level": "المستوى", "no_budget": "لا توجد ميزانية.", "no_time": "لا يوجد وقت مسجّل في هذه الفترة.",
		"no_issues": "لا توجد مشكلات مفتوحة.", "no_activity": "لا يوجد نشاط بعد.", "issues_hidden": "دورك لا يسمح بقراءة المشكلات.",
		"key": "المعرّف", "title": "العنوان", "type": "النوع", "priority": "الأولوية", "opened": "فُتحت", "when": "الوقت", "who": "من",
		"action": "الإجراء", "subject": "العنصر", "showing": "عرض %d من %d.", "description": "الوصف", "archived": "مؤرشف",
	},
}

func dt(lang, key string) string {
	if m, ok := docText[lang]; ok {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return docText["en"][key]
}

func docLang(lang string) string {
	if lang == "ar" {
		return "ar"
	}
	return "en"
}

func roundingText(lang string, m int) string {
	if m == 0 {
		return dt(lang, "none_rounding")
	}
	return fmt.Sprintf("%d %s", m, dt(lang, "min"))
}

// TimeReportDoc is the time report as a document: its context, then the page's table.
func TimeReportDoc(rep *TimeReport, lang string) *Doc {
	lang = docLang(lang)
	h := headers(lang)
	d := &Doc{Lang: lang, Title: dt(lang, "time_report"), Subtitle: rep.From + " → " + rep.To}
	d.kv(pair(dt(lang, "range"), rep.From+" → "+rep.To), pair(dt(lang, "group_by"), h[rep.GroupBy]),
		pair(dt(lang, "rounding"), roundingText(lang, rep.RoundingMinutes)), pair(dt(lang, "timezone"), rep.Timezone),
		pair(dt(lang, "currency"), rep.Currency), pair(dt(lang, "generated"), rep.GeneratedAt.UTC().Format("2006-01-02 15:04 UTC")))
	if rep.OwnTimeOnly {
		d.note(dt(lang, "own_time"))
	}
	d.table(tableFrom(timeReportTable(rep, lang, plainCell), true))
	if rep.OtherCurrencyEntries > 0 {
		d.note(fmt.Sprintf(dt(lang, "other_currency"), rep.OtherCurrencyEntries))
	}
	return d
}

// ProfitabilityDoc is the profitability report as a document.
func ProfitabilityDoc(p *Profitability, by, lang string) *Doc {
	lang = docLang(lang)
	h := headers(lang)
	d := &Doc{Lang: lang, Title: dt(lang, "profitability_report"), Subtitle: p.From + " → " + p.To}
	d.kv(pair(dt(lang, "range"), p.From+" → "+p.To), pair(dt(lang, "group_by"), h[by]),
		pair(dt(lang, "rounding"), roundingText(lang, p.RoundingMinutes)), pair(dt(lang, "currency"), p.Currency))
	d.table(tableFrom(profitabilityTable(p, by, lang, plainCell), true))
	if p.OtherCurrency > 0 {
		d.note(fmt.Sprintf(dt(lang, "other_currency"), p.OtherCurrency))
	}
	return d
}

func pctText(v *float64) string {
	if v == nil {
		return "—"
	}
	return fmt.Sprintf("%.0f%%", *v)
}

// Doc renders the project report.
func (r *ProjectReport) Doc(lang string) *Doc {
	lang = docLang(lang)
	p := r.Project
	d := &Doc{Lang: lang, Title: dt(lang, "project_report") + " · " + p.Name, Subtitle: r.From + " → " + r.To}

	d.h2(dt(lang, "summary"))
	client := "—"
	if p.ClientName != nil {
		client = *p.ClientName
	}
	dates := "—"
	if p.StartsOn != nil || p.EndsOn != nil {
		dates = deref(p.StartsOn, "…") + " → " + deref(p.EndsOn, "…")
	}
	facts := [][2]string{pair(dt(lang, "status"), p.Status), pair(dt(lang, "client"), client),
		pair(dt(lang, "billing"), p.BillingMode), pair(dt(lang, "dates"), dates), pair(dt(lang, "timezone"), r.Timezone),
		pair(dt(lang, "generated"), r.GeneratedAt.UTC().Format("2006-01-02 15:04 UTC"))}
	if p.ArchivedAt != nil {
		facts = append(facts, pair(dt(lang, "archived"), p.ArchivedAt.UTC().Format("2006-01-02")))
	}
	d.kv(facts...)
	if p.Description != nil && strings.TrimSpace(*p.Description) != "" {
		d.p(*p.Description)
	}

	d.h2(dt(lang, "progress"))
	d.kv(pair(dt(lang, "tasks"), fmt.Sprint(r.TotalTasks)), pair(dt(lang, "done_pct"), fmt.Sprintf("%d%%", r.PercentDone)),
		pair(dt(lang, "todo"), fmt.Sprint(p.Tasks.Todo)), pair(dt(lang, "doing"), fmt.Sprint(p.Tasks.Doing)),
		pair(dt(lang, "done"), fmt.Sprint(p.Tasks.Done)))
	if len(r.Statuses) > 0 {
		st := &DocTable{Columns: []string{dt(lang, "status"), dt(lang, "category"), dt(lang, "count")}, Right: map[int]bool{2: true}}
		for _, s := range r.Statuses {
			st.Rows = append(st.Rows, []string{s.Name, dt(lang, s.Category), fmt.Sprint(s.TaskCount)})
		}
		d.table(st)
	}

	d.h2(dt(lang, "budget"))
	if b := r.Budget; b == nil || b.Level == "none" {
		d.p(dt(lang, "no_budget"))
	} else {
		kv := [][2]string{}
		if b.BudgetMinutes != nil {
			kv = append(kv, pair(dt(lang, "hours_budget"), HM(*b.BudgetMinutes*60)+" · "+dt(lang, "spent")+" "+HM(b.SpentSeconds)+" ("+pctText(b.HoursPercent)+")"))
		}
		if b.BudgetMinor != nil && b.SpentMinor != nil {
			kv = append(kv, pair(dt(lang, "money_budget"), Money(*b.BudgetMinor)+" "+b.Currency+" · "+dt(lang, "spent")+" "+Money(*b.SpentMinor)+" ("+pctText(b.MoneyPercent)+")"))
		}
		kv = append(kv, pair(dt(lang, "level"), b.Level))
		d.kv(kv...)
	}

	for _, sec := range []struct {
		key string
		rep *TimeReport
	}{{"time_member", r.ByMember}, {"time_week", r.ByWeek}} {
		d.h2(dt(lang, sec.key))
		if sec.rep == nil || len(sec.rep.Rows) == 0 {
			d.p(dt(lang, "no_time"))
			continue
		}
		if sec.rep.OwnTimeOnly {
			d.note(dt(lang, "own_time"))
		}
		d.table(tableFrom(timeReportTable(sec.rep, lang, plainCell), true))
	}

	d.h2(dt(lang, "open_issues"))
	switch {
	case !r.IssuesVisible:
		d.p(dt(lang, "issues_hidden"))
	case len(r.OpenIssues) == 0:
		d.p(dt(lang, "no_issues"))
	default:
		it := &DocTable{Columns: []string{dt(lang, "key"), dt(lang, "title"), dt(lang, "type"), dt(lang, "status"), dt(lang, "priority"), dt(lang, "opened")}}
		for _, i := range r.OpenIssues {
			it.Rows = append(it.Rows, []string{i.Key, i.Title, i.Type, i.Status, i.Priority, i.CreatedAt.UTC().Format("2006-01-02")})
		}
		d.table(it)
		if r.OpenIssueCount > len(r.OpenIssues) {
			d.note(fmt.Sprintf(dt(lang, "showing"), len(r.OpenIssues), r.OpenIssueCount))
		}
	}

	d.h2(dt(lang, "activity"))
	if len(r.Activity) == 0 {
		d.p(dt(lang, "no_activity"))
	} else {
		loc := loadLocation(r.Timezone)
		at := &DocTable{Columns: []string{dt(lang, "when"), dt(lang, "who"), dt(lang, "action"), dt(lang, "subject")}}
		for _, a := range r.Activity {
			at.Rows = append(at.Rows, []string{a.At.In(loc).Format("2006-01-02 15:04"), a.Actor, a.Action, a.Subject})
		}
		d.table(at)
	}
	return d
}

var nonSlug = regexp.MustCompile(`[^p{L}p{N}]+`)

func deref(p *string, def string) string {
	if p == nil || *p == "" {
		return def
	}
	return *p
}

// ExportProjectReport renders the project report as pdf | md (json is served as the struct).
func (sv *Service) ExportProjectReport(ctx context.Context, ref, format, lang, from, to string) (*ExportFile, *ProjectReport, error) {
	if format == "" {
		format = "pdf"
	}
	if err := oneOf("format", format, "pdf", "md", "json"); err != nil {
		return nil, nil, err
	}
	r, err := sv.ProjectReport(ctx, ref, from, to)
	if err != nil {
		return nil, nil, err
	}
	if format == "json" {
		return nil, r, nil
	}
	slug := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(r.Project.Name), "-"), "-")
	if slug == "" {
		slug = "project"
	}
	f, err := renderDoc(r.Doc(lang), fmt.Sprintf("mahaam-project-%s-%s-%s.%s", slug, r.From, r.To, format), format)
	return f, r, err
}
