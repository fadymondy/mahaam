package work

import (
	"context"
	"fmt"
	"time"

	"github.com/fadymondy/managy/internal/tenant"
)

/*
Budget alerts (P5): when a project's burn reaches 80% or 100% of its hours budget, or of its money
budget, a budget.threshold notification goes to the workspace's managers and up and — for the
hours budget only, since leads may not see money — to the project's leads.

Each (project, metric, threshold, budget value) is sent once per person: the dedupe key carries
the budget value, so raising a budget re-arms its alerts, and a job or a write that runs again
sends nothing new. A burn that jumps past 100% sends only the 100% alert.

Checked after every time write that adds time to a project (start/stop, log, edit) and every five
minutes by the scheduler (running timers burn without a write).
*/

var budgetText = map[string][2]string{
	"en": {"%s has used %d%% of its %s budget", "%s is over its %s budget"},
	"ar": {"استهلك المشروع %s ‏%d%% من ميزانية %s", "تجاوز المشروع %s ميزانية %s"},
}

var metricWord = map[string]map[string]string{
	"en": {"hours": "hours", "money": "money"},
	"ar": {"hours": "الساعات", "money": "المال"},
}

// afterTimeWrite checks the budgets of the projects a time write touched. Errors are logged:
// the write itself has already succeeded.
func (sv *Service) afterTimeWrite(ctx context.Context, ws string, projects ...*string) {
	for _, p := range projects {
		if p == nil || *p == "" {
			continue
		}
		if _, err := sv.checkBudget(ctx, ws, *p, time.Now().UTC()); err != nil && sv.Log != nil {
			sv.Log.Error("budget alert", "project", *p, "err", err)
		}
	}
}

// checkBudget sends the due alerts of one project and returns how many notifications it created.
func (sv *Service) checkBudget(ctx context.Context, ws, projectID string, now time.Time) (int, error) {
	if sv.DB == nil {
		return 0, nil
	}
	ctx = tenant.WithWorkspace(ctx, ws)
	b, err := scanBudget(sv.DB.QueryRowContext(ctx, budgetSelect+`WHERE p.workspace_id = $1 AND p.id = $3 AND p.archived_at IS NULL`,
		ws, now, projectID), true)
	if err != nil {
		if _, ok := AsError(err); ok {
			return 0, nil // archived or gone
		}
		return 0, err
	}
	type due struct {
		metric    string
		threshold int
		percent   float64
		budget    int64
	}
	var list []due
	pick := func(metric string, p *float64, budget *int64) {
		if p == nil || budget == nil {
			return
		}
		switch {
		case *p >= 100:
			list = append(list, due{metric, 100, *p, *budget})
		case *p >= 80:
			list = append(list, due{metric, 80, *p, *budget})
		}
	}
	pick("hours", b.HoursPercent, b.BudgetMinutes)
	pick("money", b.MoneyPercent, b.BudgetMinor)
	if len(list) == 0 {
		return 0, nil
	}
	var locale, slug string
	if err := sv.DB.QueryRowContext(ctx, `SELECT locale, slug FROM workspaces WHERE id = $1`, ws).Scan(&locale, &slug); err != nil {
		return 0, err
	}
	txt, ok := budgetText[locale]
	if !ok {
		locale, txt = "en", budgetText["en"]
	}
	created := 0
	for _, d := range list {
		leads := d.metric == "hours"
		rows, err := sv.DB.QueryContext(ctx, `SELECT user_id FROM workspace_members
			WHERE workspace_id = $1 AND status = 'active' AND role IN ('owner','admin','manager')
			UNION
			SELECT pm.user_id FROM project_members pm JOIN workspace_members m ON m.workspace_id = pm.workspace_id AND m.user_id = pm.user_id
			WHERE pm.workspace_id = $1 AND pm.project_id = $2 AND pm.role = 'lead' AND m.status = 'active' AND $3`, ws, projectID, leads)
		if err != nil {
			return created, err
		}
		var people []string
		for rows.Next() {
			var u string
			if err := rows.Scan(&u); err != nil {
				rows.Close()
				return created, err
			}
			people = append(people, u)
		}
		rows.Close()
		word := metricWord[locale][d.metric]
		title := fmt.Sprintf(txt[0], b.ProjectName, d.threshold, word)
		if d.threshold >= 100 {
			title = fmt.Sprintf(txt[1], b.ProjectName, word)
		}
		data := map[string]any{"project_id": projectID, "project_name": b.ProjectName, "metric": d.metric,
			"threshold": d.threshold, "percent": int(d.percent)}
		if d.metric == "hours" {
			data["spent_s"], data["budget_minutes"] = b.SpentSeconds, d.budget
		}
		for _, u := range people {
			n, err := notify(ctx, sv.DB, ws, u, newNote{Kind: "budget.threshold", Title: title,
				URL:    "/w/" + slug + "/projects/" + projectID,
				Dedupe: fmt.Sprintf("project:%s:%s:%d:%d", projectID, d.metric, d.threshold, d.budget), Data: data})
			if err != nil {
				return created, err
			}
			if n != nil {
				created++
				sv.publish(ws, u, "notification.created", n)
			}
		}
	}
	return created, nil
}

// CheckBudgets is the scheduler job: every active project with a budget, in every workspace.
func (sv *Service) CheckBudgets(ctx context.Context, now time.Time) (int, error) {
	if sv.Sys == nil {
		return 0, nil
	}
	// Which projects exist is cross-tenant by definition: the owner pool, then one workspace at a time.
	rows, err := sv.Sys.QueryContext(ctx, `SELECT workspace_id, id FROM projects
		WHERE archived_at IS NULL AND (budget_minutes IS NOT NULL OR budget_minor IS NOT NULL)`)
	if err != nil {
		return 0, err
	}
	type ref struct{ ws, id string }
	var list []ref
	for rows.Next() {
		var r ref
		if err := rows.Scan(&r.ws, &r.id); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, r)
	}
	rows.Close()
	total := 0
	for _, r := range list {
		n, err := sv.checkBudget(ctx, r.ws, r.id, now)
		total += n
		if err != nil {
			return total, err
		}
	}
	return total, nil
}
