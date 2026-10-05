package work

import (
	"context"
	"sort"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
The customer's portal home and time page (MH-1167): the same aggregates as one project's panel,
across every project the caller can see (visibleClause). Same rules as portal_panel.go and
portal_share.go: counts and totals only; task titles only from projects that share their board;
people only from projects that share their team; never a time entry, a rate or a comment.
*/

// PortalDueTask is an open task with a due date, from a project that shares its board.
type PortalDueTask struct {
	Key       string    `json:"key"`
	Title     string    `json:"title"`
	ProjectID string    `json:"project_id"`
	Project   string    `json:"project"`
	DueAt     time.Time `json:"due_at"`
	Overdue   bool      `json:"overdue"`
}

// PortalOverview is the customer's dashboard.
type PortalOverview struct {
	Projects          []PortalProject      `json:"projects"`
	ActiveProjects    int                  `json:"active_projects"`
	CompletedProjects int                  `json:"completed_projects"`
	OpenTasks         int                  `json:"open_tasks"`
	OverdueTasks      int                  `json:"overdue_tasks"`
	Completed7d       int                  `json:"completed_7d"`
	OpenIssues        int                  `json:"open_issues"`
	PendingRequests   int                  `json:"pending_requests"`
	MonthMinutes      int64                `json:"month_minutes" doc:"Tracked this calendar month (workspace timezone)"`
	Weeks             []PortalWeek         `json:"weeks" doc:"The last 12 weeks across your projects"`
	DueTasks          []PortalDueTask      `json:"due_tasks" doc:"Overdue and due in 14 days (projects that share their board)"`
	Activity          []PortalActivityItem `json:"activity" doc:"Recent activity across your projects"`
	UnpaidInvoices    int                  `json:"unpaid_invoices"`
}

// PortalProjectTime is one project's tracked time.
type PortalProjectTime struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Color         string `json:"color"`
	Status        string `json:"status"`
	UsedMinutes   int64  `json:"used_minutes"`
	MonthMinutes  int64  `json:"month_minutes"`
	BudgetMinutes *int64 `json:"budget_minutes"`
}

// PortalPersonTime is one team member's tracked time (projects that share their team only).
type PortalPersonTime struct {
	Name     string `json:"name"`
	Initials string `json:"initials"`
	Minutes  int64  `json:"minutes"`
}

// PortalTimeOverview is the team's time across the customer's projects.
type PortalTimeOverview struct {
	TotalMinutes int64               `json:"total_minutes"`
	MonthMinutes int64               `json:"month_minutes"`
	Weeks        []PortalWeek        `json:"weeks"`
	Projects     []PortalProjectTime `json:"projects"`
	People       []PortalPersonTime  `json:"people" doc:"Only projects that share their team"`
}

// wsZone is the workspace's timezone, for a query whose $1 is the workspace id.
const wsZone = `COALESCE((SELECT timezone FROM workspaces WHERE id = $1), 'UTC')`

// portalVisible loads the caller's visible projects for a portal read.
func (sv *Service) portalVisible(ctx context.Context) (*tenant.Scope, []*Project, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, nil, err
	}
	if err := require(s, authz.PortalRead); err != nil {
		return nil, nil, err
	}
	if err := feature(ctx, s, limits.FeaturePortal); err != nil {
		return nil, nil, err
	}
	args := []any{s.WorkspaceID}
	clause := visibleClause(s, &args)
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+projectCols+` FROM projects p WHERE p.workspace_id = $1 AND `+clause+`
		ORDER BY (p.archived_at IS NOT NULL), lower(p.name) LIMIT 500`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var out []*Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, p)
	}
	return s, out, rows.Err()
}

func projectIDs(ps []*Project) []string {
	ids := make([]string, len(ps))
	for i, p := range ps {
		ids[i] = p.ID
	}
	return ids
}

// PortalOverview is the customer's dashboard across their projects.
func (sv *Service) PortalOverview(ctx context.Context) (*PortalOverview, error) {
	s, ps, err := sv.portalVisible(ctx)
	if err != nil {
		return nil, err
	}
	o := &PortalOverview{Projects: make([]PortalProject, 0, len(ps)), DueTasks: []PortalDueTask{}, Activity: []PortalActivityItem{}}
	for _, p := range ps {
		o.Projects = append(o.Projects, toPortal(p))
	}
	if err := sv.fillPortalCounts(ctx, s.WorkspaceID, o.Projects); err != nil {
		return nil, err
	}
	ids := projectIDs(ps)
	var boards []string
	for i, p := range o.Projects {
		switch {
		case p.Archived:
		case p.Status == "completed":
			o.CompletedProjects++
		case p.Status != "cancelled":
			o.ActiveProjects++
		}
		o.OpenIssues += p.OpenIssues
		o.PendingRequests += p.PendingRequests
		if ps[i].ShareBoard {
			boards = append(boards, p.ID)
		}
	}
	if o.Weeks, err = sv.portalWeeksOf(ctx, s.WorkspaceID, ids); err != nil {
		return nil, err
	}
	if len(ids) > 0 {
		if err := sv.DB.QueryRowContext(ctx, `SELECT
				count(*) FILTER (WHERE st.category <> 'done'),
				count(*) FILTER (WHERE st.category <> 'done' AND t.due_at < now()),
				count(*) FILTER (WHERE t.completed_at >= now() - interval '7 days')
			FROM tasks t JOIN task_statuses st ON st.workspace_id = t.workspace_id AND st.id = t.status_id
			WHERE t.workspace_id = $1 AND t.project_id = ANY($2)`, s.WorkspaceID, ids).
			Scan(&o.OpenTasks, &o.OverdueTasks, &o.Completed7d); err != nil {
			return nil, err
		}
		if err := sv.DB.QueryRowContext(ctx, `SELECT (COALESCE(sum(te.duration_s), 0) / 60)::bigint FROM time_entries te
			WHERE te.workspace_id = $1 AND te.project_id = ANY($2) AND te.duration_s IS NOT NULL
			  AND te.started_at AT TIME ZONE `+wsZone+` >= date_trunc('month', now() AT TIME ZONE `+wsZone+`)`,
			s.WorkspaceID, ids).Scan(&o.MonthMinutes); err != nil {
			return nil, err
		}
	}
	if len(boards) > 0 {
		rows, err := sv.DB.QueryContext(ctx, `SELECT t.key, t.title, p.id, p.name, t.due_at, t.due_at < now()
			FROM tasks t JOIN task_statuses st ON st.workspace_id = t.workspace_id AND st.id = t.status_id
			JOIN projects p ON p.workspace_id = t.workspace_id AND p.id = t.project_id
			WHERE t.workspace_id = $1 AND t.project_id = ANY($2) AND st.category <> 'done'
			  AND t.due_at IS NOT NULL AND t.due_at < now() + interval '14 days'
			ORDER BY t.due_at LIMIT 10`, s.WorkspaceID, boards)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var d PortalDueTask
			if err := rows.Scan(&d.Key, &d.Title, &d.ProjectID, &d.Project, &d.DueAt, &d.Overdue); err != nil {
				rows.Close()
				return nil, err
			}
			o.DueTasks = append(o.DueTasks, d)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	// Activity: the newest across the open projects (a dozen at most, a query or two each).
	n := 0
	for _, p := range ps {
		if p.ArchivedAt != nil || n >= 12 {
			continue
		}
		n++
		items, err := sv.PortalActivity(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		for _, it := range items {
			it.Project, it.ProjectID = p.Name, p.ID
			o.Activity = append(o.Activity, it)
		}
	}
	sort.SliceStable(o.Activity, func(i, j int) bool { return o.Activity[i].At.After(o.Activity[j].At) })
	if len(o.Activity) > 15 {
		o.Activity = o.Activity[:15]
	}
	// Unpaid: the caller's own client's sent invoices (none when the caller isn't a portal contact).
	if clientID, err := sv.portalClientID(ctx, s); err == nil && clientID != "" {
		if err := sv.DB.QueryRowContext(ctx, `SELECT count(*) FROM invoices WHERE workspace_id = $1 AND client_id = $2
			AND status = 'sent'`, s.WorkspaceID, clientID).Scan(&o.UnpaidInvoices); err != nil {
			return nil, err
		}
	}
	return o, nil
}

// PortalTimeAll is the team's tracked time across the customer's projects.
func (sv *Service) PortalTimeAll(ctx context.Context) (*PortalTimeOverview, error) {
	s, ps, err := sv.portalVisible(ctx)
	if err != nil {
		return nil, err
	}
	ids := projectIDs(ps)
	out := &PortalTimeOverview{Projects: make([]PortalProjectTime, 0, len(ps)), People: []PortalPersonTime{}}
	if out.Weeks, err = sv.portalWeeksOf(ctx, s.WorkspaceID, ids); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return out, nil
	}
	at := map[string]int{}
	var teams []string
	for _, p := range ps {
		at[p.ID] = len(out.Projects)
		out.Projects = append(out.Projects, PortalProjectTime{ID: p.ID, Name: p.Name, Color: p.Color, Status: p.Status, BudgetMinutes: p.BudgetMinutes})
		if p.ShareTeam {
			teams = append(teams, p.ID)
		}
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT te.project_id,
			(COALESCE(sum(te.duration_s), 0) / 60)::bigint,
			(COALESCE(sum(te.duration_s) FILTER (WHERE te.started_at AT TIME ZONE `+wsZone+`
				>= date_trunc('month', now() AT TIME ZONE `+wsZone+`)), 0) / 60)::bigint
		FROM time_entries te WHERE te.workspace_id = $1 AND te.project_id = ANY($2) AND te.duration_s IS NOT NULL
		GROUP BY te.project_id`, s.WorkspaceID, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var used, month int64
		if err := rows.Scan(&id, &used, &month); err != nil {
			rows.Close()
			return nil, err
		}
		out.Projects[at[id]].UsedMinutes, out.Projects[at[id]].MonthMinutes = used, month
		out.TotalMinutes += used
		out.MonthMinutes += month
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out.Projects, func(i, j int) bool { return out.Projects[i].UsedMinutes > out.Projects[j].UsedMinutes })
	if len(teams) == 0 {
		return out, nil
	}
	prows, err := sv.DB.QueryContext(ctx, `SELECT te.user_id, (sum(te.duration_s) / 60)::bigint FROM time_entries te
		WHERE te.workspace_id = $1 AND te.project_id = ANY($2) AND te.duration_s IS NOT NULL
		GROUP BY te.user_id HAVING sum(te.duration_s) >= 60 ORDER BY 2 DESC LIMIT 100`, s.WorkspaceID, teams)
	if err != nil {
		return nil, err
	}
	type row struct {
		id string
		m  int64
	}
	var list []row
	var uids []string
	for prows.Next() {
		var r row
		if err := prows.Scan(&r.id, &r.m); err != nil {
			prows.Close()
			return nil, err
		}
		list = append(list, r)
		uids = append(uids, r.id)
	}
	prows.Close()
	if err := prows.Err(); err != nil {
		return nil, err
	}
	names := sv.people(ctx, uids)
	for _, r := range list {
		p := names[r.id]
		if p.Name == "" {
			p = PortalPerson{Name: "Team member", Initials: "?"}
		}
		out.People = append(out.People, PortalPersonTime{Name: p.Name, Initials: p.Initials, Minutes: r.m})
	}
	return out, nil
}

// portalWeeksOf is portalWeeks across several projects.
func (sv *Service) portalWeeksOf(ctx context.Context, ws string, ids []string) ([]PortalWeek, error) {
	if ids == nil {
		ids = []string{}
	}
	rows, err := sv.DB.QueryContext(ctx, `
		WITH tz AS (SELECT `+wsZone+` AS z),
		weeks AS (SELECT generate_series(
			date_trunc('week', now() AT TIME ZONE (SELECT z FROM tz)) - interval '11 weeks',
			date_trunc('week', now() AT TIME ZONE (SELECT z FROM tz)), interval '1 week') AS wk)
		SELECT to_char(w.wk, 'YYYY-MM-DD'), COALESCE((SELECT sum(te.duration_s) FROM time_entries te
			WHERE te.workspace_id = $1 AND te.project_id = ANY($2) AND te.duration_s IS NOT NULL
			  AND date_trunc('week', te.started_at AT TIME ZONE (SELECT z FROM tz)) = w.wk), 0)::bigint / 60
		FROM weeks w ORDER BY w.wk`, ws, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PortalWeek{}
	for rows.Next() {
		var w PortalWeek
		if err := rows.Scan(&w.Week, &w.Minutes); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}
