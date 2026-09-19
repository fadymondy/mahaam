package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
ReportTools are the P3/P5 report tools of the user MCP. They call internal/work's report functions,
so the numbers are the reports page's numbers (rounding at report time, local-midnight cuts,
cumulative rounding across days) and the role rules are the same: a member's summary is their own
time; money only for manager+ with reports:finance.

	time_summary, budget_status, timesheet   reports:read
	profitability                            reports:finance (manager+)
*/
func ReportTools() []Tool {
	return []Tool{
		{
			Name: "time_summary",
			Description: "Tracked time over a date range, grouped by project, member, client, label, task, day or week, with the billable split. " +
				"Rounding is the workspace setting unless given. A member sees only their own time. Default: this month by project.",
			Scope: "reports:read",
			InputSchema: schema(nil, map[string]any{
				"from":     prop("string", "YYYY-MM-DD (workspace timezone); default the 1st of this month"),
				"to":       prop("string", "YYYY-MM-DD inclusive; default today"),
				"group_by": map[string]any{"type": "string", "enum": work.ReportGroups},
				"users":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Emails, ids or \"me\" (managers)"},
				"projects": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Project ids or names"},
				"clients":  map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Client ids or names"},
				"labels":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Label ids or names"},
				"billable": map[string]any{"type": "string", "enum": []string{"billable", "non_billable"}},
				"rounding": prop("integer", "Minutes (0 = none); default the workspace setting"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				sv := work.New(a)
				q, err := reportQuery(ctx, a, sv, decodeArgs(raw))
				if err != nil {
					return "", err
				}
				rep, err := sv.TimeReport(ctx, q)
				if err != nil {
					return "", toolErr(err)
				}
				return formatReport(rep), nil
			},
		},
		{
			Name:        "budget_status",
			Description: "Budget burn per project: hours (and, for managers, money) spent against the budget, with ok / warning (80%) / over (100%).",
			Scope:       "reports:read",
			InputSchema: schema(nil, map[string]any{"project": prop("string", "One project (id or name); default every project with a budget")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				sv := work.New(a)
				var list []work.Budget
				if ref := str(decodeArgs(raw), "project"); ref != "" {
					b, err := sv.ProjectBudget(ctx, ref)
					if err != nil {
						return "", toolErr(err)
					}
					list = []work.Budget{*b}
				} else {
					all, err := sv.Budgets(ctx)
					if err != nil {
						return "", toolErr(err)
					}
					list = all.Budgets
				}
				if len(list) == 0 {
					return "No project has a budget.", nil
				}
				var b strings.Builder
				for _, x := range list {
					fmt.Fprintf(&b, "%s  [%s]", x.ProjectName, strings.ToUpper(x.Level))
					if x.BudgetMinutes != nil {
						fmt.Fprintf(&b, "  hours %s / %s (%s)", work.HM(x.SpentSeconds), work.HM(*x.BudgetMinutes*60), pctText(x.HoursPercent))
					} else {
						fmt.Fprintf(&b, "  hours %s (no hours budget)", work.HM(x.SpentSeconds))
					}
					if x.BudgetMinor != nil && x.SpentMinor != nil {
						fmt.Fprintf(&b, "  money %s / %s %s (%s)", work.Money(*x.SpentMinor), work.Money(*x.BudgetMinor), x.Currency, pctText(x.MoneyPercent))
					}
					if x.Archived {
						b.WriteString("  archived")
					}
					fmt.Fprintf(&b, "  id=%s\n", x.ProjectID)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "timesheet",
			Description: "A person's week (default yours, this week): hours per project/task per local day, totals and the rounded total.",
			Scope:       "reports:read",
			InputSchema: schema(nil, map[string]any{
				"week": prop("string", "Any YYYY-MM-DD in the week (default this week)"),
				"user": prop("string", "Email, id or \"me\" (someone else needs time:manage)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				who, err := timeSubject(ctx, a, str(args, "user"))
				if err != nil {
					return "", err
				}
				ts, err := work.New(a).Timesheet(ctx, who, str(args, "week"))
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "Week %s … %s (%s)  total %s  rounded %s (%d min)  billable %s\n",
					ts.Days[0], ts.Days[6], ts.Timezone, work.HM(ts.Total), work.HM(ts.RoundedTotal), ts.RoundingMinutes, work.HM(ts.BillableTotal))
				short := make([]string, 7)
				for i, d := range ts.Days {
					if t, err := time.Parse("2006-01-02", d); err == nil {
						short[i] = t.Format("Mon 02")
					}
				}
				fmt.Fprintf(&b, "%-40s %s  total\n", "", strings.Join(short, "  "))
				for _, r := range ts.Rows {
					name := "(no project)"
					if r.ProjectName != nil {
						name = *r.ProjectName
					}
					if r.TaskKey != nil {
						name += " / " + *r.TaskKey
					}
					cells := make([]string, 7)
					for i, s := range r.Seconds {
						cells[i] = fmt.Sprintf("%6s", work.HM(s))
					}
					fmt.Fprintf(&b, "%-40s %s  %s\n", truncateName(name, 40), strings.Join(cells, " "), work.HM(r.Total))
				}
				if len(ts.Rows) == 0 {
					b.WriteString("No time this week.\n")
				}
				if ts.Running != nil {
					b.WriteString("A timer is running.\n")
				}
				return b.String(), nil
			},
		},
		{
			Name:        "profitability",
			Description: "Billable value − cost value per project and per client over a date range (managers). Default: this month.",
			Scope:       "reports:finance",
			InputSchema: schema(nil, map[string]any{
				"from":     prop("string", "YYYY-MM-DD"),
				"to":       prop("string", "YYYY-MM-DD"),
				"projects": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"clients":  map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"rounding": prop("integer", "Minutes; default the workspace setting"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				sv := work.New(a)
				q, err := reportQuery(ctx, a, sv, decodeArgs(raw))
				if err != nil {
					return "", err
				}
				p, err := sv.Profitability(ctx, q)
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "Profitability %s … %s in %s (rounding %d min)\n", p.From, p.To, p.Currency, p.RoundingMinutes)
				section := func(title string, rows []work.ProfitRow) {
					fmt.Fprintf(&b, "\nBy %s:\n", title)
					for _, r := range rows {
						name := r.Name
						if r.Key == "" {
							name = "(none)"
						}
						fmt.Fprintf(&b, "  %-32s billable %10s  cost %10s  profit %10s  margin %s  (%s)\n", truncateName(name, 32),
							work.Money(r.BillableMinor), work.Money(r.CostMinor), work.Money(r.ProfitMinor), pctText(r.MarginPercent), work.HM(r.Seconds))
					}
					if len(rows) == 0 {
						b.WriteString("  (no time)\n")
					}
				}
				section("project", p.Projects)
				section("client", p.Clients)
				t := p.Total
				fmt.Fprintf(&b, "\nTotal: billable %s  cost %s  profit %s  margin %s\n", work.Money(t.BillableMinor), work.Money(t.CostMinor), work.Money(t.ProfitMinor), pctText(t.MarginPercent))
				if p.OtherCurrency > 0 {
					fmt.Fprintf(&b, "%d entr%s in another currency are not valued.\n", p.OtherCurrency, plural(p.OtherCurrency, "y", "ies"))
				}
				return b.String(), nil
			},
		},
		{
			Name:        "update_feedback_status",
			Description: "Move a feedback issue on its board: backlog, todo, in_progress, waiting_approval, in_review or done (done closes it; leaving done reopens it). Optional resolution note.",
			Scope:       "feedback:write",
			InputSchema: schema([]string{"key", "status"}, map[string]any{
				"key":        prop("string", "MG-12 or id"),
				"status":     map[string]any{"type": "string", "enum": reports.Statuses},
				"resolution": prop("string", "What was done (kept when closing)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				s, _ := tenant.From(ctx)
				if !authz.Can(s.Role, authz.FeedbackWrite) {
					return "", fmt.Errorf("your role (%s) cannot change feedback issues", s.Role)
				}
				r, err := reports.Find(ctx, a.SQLDB, s.WorkspaceID, str(args, "key"))
				if err != nil {
					return "", errors.New("issue not found")
				}
				status := str(args, "status")
				if !reports.ValidStatus(status) {
					return "", fmt.Errorf("unknown status %q (use one of: %s)", status, strings.Join(reports.Statuses, ", "))
				}
				if status == r.Status && str(args, "resolution") == "" {
					return fmt.Sprintf("%s is already %s.", r.Key, status), nil
				}
				fields := map[string]any{"status": status}
				switch {
				case status == "done":
					fields["state"], fields["closed_at"] = "closed", time.Now().UTC()
				case r.Status == "done":
					fields["state"], fields["closed_at"] = "open", nil
				}
				if v := str(args, "resolution"); v != "" {
					fields["resolution"] = v
				}
				// The app pool: RLS keeps the write inside the token's workspace.
				if err := reports.Update(ctx, a.SQLDB, r, fields); err != nil {
					return "", fmt.Errorf("could not update: %w", err)
				}
				note := fmt.Sprintf("By %s via MCP: status %s → %s", s.Email, r.Status, status)
				if v := str(args, "resolution"); v != "" {
					note += "\n\n" + v
				}
				_ = reports.AddComment(ctx, a.SQLDB, r, s.UserID, "agent", note)
				return fmt.Sprintf("%s: %s → %s.", r.Key, r.Status, status), nil
			},
		},
	}
}

func pctText(p *float64) string {
	if p == nil {
		return "—"
	}
	return fmt.Sprintf("%.0f%%", *p)
}

func truncateName(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// reportQuery turns tool arguments into a ReportQuery, resolving names to ids.
func reportQuery(ctx context.Context, a *app.App, sv *work.Service, args map[string]any) (work.ReportQuery, error) {
	q := work.ReportQuery{From: str(args, "from"), To: str(args, "to"), GroupBy: str(args, "group_by"), Billable: str(args, "billable")}
	if v, ok := args["rounding"].(float64); ok {
		r := int(v)
		q.Rounding = &r
	}
	if list := strList(args, "users"); len(list) > 0 {
		s, _ := tenant.From(ctx)
		ids := []string{}
		for _, who := range list {
			id := s.UserID
			if !strings.EqualFold(strings.TrimSpace(who), "me") {
				var err error
				if id, err = people(ctx, a).resolve(ctx, who); err != nil {
					return q, err
				}
			}
			if id != s.UserID && !authz.Can(s.Role, authz.ReportsAll) {
				return q, errors.New("a member's reports cover only their own time; other people's time needs a manager")
			}
			ids = append(ids, id)
		}
		q.Users = ids
	}
	for _, ref := range strList(args, "projects") {
		p, err := sv.FindProject(ctx, ref)
		if err != nil {
			return q, toolErr(err)
		}
		q.Projects = append(q.Projects, p.ID)
	}
	for _, ref := range strList(args, "clients") {
		c, err := sv.GetClient(ctx, ref)
		if err != nil {
			return q, toolErr(err)
		}
		q.Clients = append(q.Clients, c.ID)
	}
	if names := strList(args, "labels"); len(names) > 0 {
		ids, err := labelIDs(ctx, sv, names)
		if err != nil {
			return q, err
		}
		q.Labels = ids
	}
	return q, nil
}

func formatReport(rep *work.TimeReport) string {
	var b strings.Builder
	who := "everyone"
	if rep.OwnTimeOnly {
		who = "your time"
	}
	fmt.Fprintf(&b, "Time %s … %s by %s (%s, %s, rounding %d min)\n", rep.From, rep.To, rep.GroupBy, who, rep.Timezone, rep.RoundingMinutes)
	for _, r := range rep.Rows {
		if r.Entries == 0 && (rep.GroupBy == "day" || rep.GroupBy == "week") {
			continue
		}
		name := r.Name
		if r.Key == "" {
			name = "(none)"
		}
		fmt.Fprintf(&b, "  %-36s %7s  (raw %s, billable %s, %d entr%s)", truncateName(name, 36), work.HM(r.Rounded),
			work.HM(r.Seconds), work.HM(r.BillableRounded), r.Entries, plural(r.Entries, "y", "ies"))
		if r.BillableMinor != nil {
			fmt.Fprintf(&b, "  value %s cost %s %s", work.Money(*r.BillableMinor), work.Money(*r.CostMinor), rep.Currency)
		}
		b.WriteString("\n")
	}
	t := rep.Total
	fmt.Fprintf(&b, "Total: %s rounded (%s raw), billable %s, non-billable %s, %d entr%s",
		work.HM(t.Rounded), work.HM(t.Seconds), work.HM(t.BillableRounded), work.HM(t.Rounded-t.BillableRounded), t.Entries, plural(t.Entries, "y", "ies"))
	if t.BillableMinor != nil {
		fmt.Fprintf(&b, "; billable value %s, cost %s, profit %s %s", work.Money(*t.BillableMinor), work.Money(*t.CostMinor), work.Money(*t.ProfitMinor), rep.Currency)
	}
	b.WriteString("\n")
	if rep.GroupBy == "label" {
		b.WriteString("(An entry counts under every label of its task, so label rows can add up to more than the total.)\n")
	}
	return b.String()
}
