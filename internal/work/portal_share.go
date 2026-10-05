package work

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
The customer's full project view (P8.5, owner feedback). On top of the aggregates in
portal_panel.go, a project's customer sees — per the project's "Share with customer" settings
(projects.share_board / share_team / share_money, 19c_portal_share.sql):

	share_team   the people on the project: display name + initials + lead/member (no ids, no
	             e-mails, never rates)
	share_board  the status columns with counts, and the board read-only through dedicated
	             endpoints (PortalBoard, PortalTask) with EXPLICIT field whitelists: key, title,
	             column, due date, priority, assignee names, labels, checklist progress; the task
	             detail adds the description and the checklist item titles. Task comments,
	             attachments, estimates, rates and time entries are never returned.
	             Time by task (PortalTime) and task lines in the activity feed need it too.
	share_money  the money budget

Since MH-1176 a customer also works the app's own project pages (board, tasks, issues) on
the projects they can see; these portal reads stay for the portal dashboard, the MCP portal
tools and the mobile client app. Access is authz.PortalRead AND a visible project (404
otherwise); a setting that is off answers 404 for its endpoint.
*/

// PortalShare is a project's "Share with customer" settings.
type PortalShare struct {
	Board bool `json:"board"`
	Team  bool `json:"team"`
	Money bool `json:"money"`
}

// PortalPerson is someone on the project as the customer sees them.
type PortalPerson struct {
	Name     string `json:"name"`
	Initials string `json:"initials"`
	Role     string `json:"role,omitempty" doc:"lead or member (team list only)"`
}

// PortalColumn is a status column with its task count.
type PortalColumn struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Category  string `json:"category" doc:"todo, doing or done"`
	TaskCount int    `json:"task_count"`
}

// PortalLabel is a task label (name + colour).
type PortalLabel struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// PortalTask is a task as its customer sees it (whitelisted fields only).
type PortalTask struct {
	Key            string         `json:"key"`
	Title          string         `json:"title"`
	StatusID       string         `json:"status_id"`
	StatusName     string         `json:"status_name"`
	Category       string         `json:"category"`
	Priority       string         `json:"priority"`
	DueAt          *time.Time     `json:"due_at"`
	CompletedAt    *time.Time     `json:"completed_at"`
	Assignees      []PortalPerson `json:"assignees"`
	Labels         []PortalLabel  `json:"labels"`
	ChecklistDone  int            `json:"checklist_done"`
	ChecklistTotal int            `json:"checklist_total"`
	Position       float64        `json:"position"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

// PortalChecklistItem is one checklist line (title and done only).
type PortalChecklistItem struct {
	Title string `json:"title"`
	Done  bool   `json:"done"`
}

// PortalTaskDetail is one task read-only: the card plus description and checklist.
type PortalTaskDetail struct {
	PortalTask
	Description *string               `json:"description"`
	Checklist   []PortalChecklistItem `json:"checklist"`
	CreatedAt   time.Time             `json:"created_at"`
}

// PortalBoard is a project's board read-only.
type PortalBoard struct {
	Columns []PortalColumn `json:"columns"`
	Tasks   []PortalTask   `json:"tasks"`
}

// PortalTaskTime is tracked time on one task (totals only, no people, no money).
type PortalTaskTime struct {
	Key     *string `json:"key" doc:"null = time not on a task"`
	Title   *string `json:"title"`
	Minutes int64   `json:"minutes"`
}

// PortalTimeReport is a project's tracked time as the customer sees it.
type PortalTimeReport struct {
	UsedMinutes   int64            `json:"used_minutes"`
	BudgetMinutes *int64           `json:"budget_minutes"`
	Weeks         []PortalWeek     `json:"weeks"`
	ByTask        []PortalTaskTime `json:"by_task" doc:"Empty unless the board is shared"`
}

// PortalActivityItem is one customer-safe line of the project's activity.
type PortalActivityItem struct {
	Kind  string    `json:"kind" doc:"task.created, task.moved, task.completed, issue.created, issue.closed, request.filed"`
	Key   string    `json:"key"`
	Title string    `json:"title"`
	From  string    `json:"from,omitempty"`
	To    string    `json:"to,omitempty"`
	At    time.Time `json:"at"`
	// Project is set on the portal dashboard's feed, which spans projects.
	Project   string `json:"project,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
}

// portalProject loads a visible project for a portal read (authz.PortalRead), or 404.
func (sv *Service) portalProject(ctx context.Context, ref string) (*tenant.Scope, *Project, error) {
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
	p, err := loadProject(ctx, sv.DB, s, strings.TrimSpace(ref))
	if err != nil {
		return nil, nil, err
	}
	return s, p, nil
}

func shareOf(p *Project) PortalShare {
	return PortalShare{Board: p.ShareBoard, Team: p.ShareTeam, Money: p.ShareMoney}
}

// displayName turns an e-mail into a name a customer sees ("sara.ali@x.com" → "Sara Ali").
func displayName(email string) (string, string) {
	local := email
	if i := strings.IndexByte(local, '@'); i >= 0 {
		local = local[:i]
	}
	parts := strings.FieldsFunc(local, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r > 127)
	})
	if len(parts) == 0 {
		return "Team member", "?"
	}
	ini := ""
	for i, p := range parts {
		rs := []rune(p)
		parts[i] = strings.ToUpper(string(rs[0])) + string(rs[1:])
		if len(ini) < 2 {
			ini += strings.ToUpper(string(rs[0]))
		}
	}
	if len([]rune(ini)) < 2 && len([]rune(parts[0])) > 1 {
		ini += strings.ToUpper(string([]rune(parts[0])[1]))
	}
	return strings.Join(parts, " "), ini
}

// people resolves user ids to customer-facing names (owner pool: the app role cannot read users).
func (sv *Service) people(ctx context.Context, ids []string) map[string]PortalPerson {
	out := map[string]PortalPerson{}
	ids = dedupe(ids)
	if len(ids) == 0 || sv.Sys == nil {
		return out
	}
	rows, err := sv.Sys.QueryContext(ctx, `SELECT id, email FROM users WHERE id = ANY($1)`, ids)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, email string
		if rows.Scan(&id, &email) == nil {
			n, i := displayName(email)
			out[id] = PortalPerson{Name: n, Initials: i}
		}
	}
	return out
}

// portalTeam lists the project's people: direct members (leads first) and attached teams' members.
func (sv *Service) portalTeam(ctx context.Context, ws, projectID string) ([]PortalPerson, error) {
	rows, err := sv.DB.QueryContext(ctx, `
		SELECT user_id, role FROM project_members WHERE workspace_id = $1 AND project_id = $2
		UNION ALL
		SELECT tm.user_id, 'member' FROM project_teams pt JOIN team_members tm
			ON tm.workspace_id = pt.workspace_id AND tm.team_id = pt.team_id
		WHERE pt.workspace_id = $1 AND pt.project_id = $2`, ws, projectID)
	if err != nil {
		return nil, err
	}
	type row struct{ id, role string }
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.role); err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Staff only: a client on the project (their own contact) is not "the team".
	staff := map[string]bool{}
	ids := make([]string, 0, len(list))
	for _, r := range list {
		ids = append(ids, r.id)
	}
	if len(ids) > 0 {
		srows, err := sv.DB.QueryContext(ctx, `SELECT user_id FROM workspace_members WHERE workspace_id = $1
			AND user_id = ANY($2) AND status = 'active' AND role <> 'client'`, ws, ids)
		if err != nil {
			return nil, err
		}
		for srows.Next() {
			var id string
			if srows.Scan(&id) == nil {
				staff[id] = true
			}
		}
		srows.Close()
	}
	names := sv.people(ctx, ids)
	seen := map[string]int{}
	out := []PortalPerson{}
	for _, r := range list {
		if !staff[r.id] {
			continue
		}
		if i, ok := seen[r.id]; ok {
			if r.role == "lead" {
				out[i].Role = "lead"
			}
			continue
		}
		p := names[r.id]
		if p.Name == "" {
			p = PortalPerson{Name: "Team member", Initials: "?"}
		}
		p.Role = r.role
		seen[r.id] = len(out)
		out = append(out, p)
	}
	// Leads first, stable otherwise.
	leads, rest := []PortalPerson{}, []PortalPerson{}
	for _, p := range out {
		if p.Role == "lead" {
			leads = append(leads, p)
		} else {
			rest = append(rest, p)
		}
	}
	return append(leads, rest...), nil
}

func (sv *Service) portalColumns(ctx context.Context, ws, projectID string) ([]PortalColumn, error) {
	list, err := listStatuses(ctx, sv.DB, ws, projectID)
	if err != nil {
		return nil, err
	}
	out := make([]PortalColumn, 0, len(list))
	for _, st := range list {
		out = append(out, PortalColumn{ID: st.ID, Name: st.Name, Color: st.Color, Category: st.Category, TaskCount: st.TaskCount})
	}
	return out, nil
}

// fillShared adds the share-dependent parts to a project's customer panel.
func (sv *Service) fillShared(ctx context.Context, s *tenant.Scope, p *Project, d *PortalProjectDetail) error {
	d.Share = shareOf(p)
	d.Team, d.Columns = []PortalPerson{}, []PortalColumn{}
	if p.ShareTeam {
		team, err := sv.portalTeam(ctx, s.WorkspaceID, p.ID)
		if err != nil {
			return err
		}
		d.Team = team
	}
	if p.ShareBoard {
		cols, err := sv.portalColumns(ctx, s.WorkspaceID, p.ID)
		if err != nil {
			return err
		}
		d.Columns = cols
	}
	if p.ShareMoney && p.BudgetMinor != nil {
		d.BudgetAmount, d.BudgetCurrency = p.BudgetMinor, p.Currency
	}
	return nil
}

const portalTaskCols = `t.key, t.title, t.status_id, st.name, st.category, t.priority, t.due_at, t.completed_at,
	COALESCE((SELECT string_agg(a.user_id, ',' ORDER BY a.created_at) FROM task_assignees a
	          WHERE a.workspace_id = t.workspace_id AND a.task_id = t.id), ''),
	COALESCE((SELECT json_agg(json_build_object('name', lb.name, 'color', lb.color) ORDER BY lower(lb.name))
	          FROM task_labels tl JOIN labels lb ON lb.workspace_id = tl.workspace_id AND lb.id = tl.label_id
	          WHERE tl.workspace_id = t.workspace_id AND tl.task_id = t.id), '[]'),
	(SELECT count(*) FROM task_checklist_items c WHERE c.workspace_id = t.workspace_id AND c.task_id = t.id AND c.done),
	(SELECT count(*) FROM task_checklist_items c WHERE c.workspace_id = t.workspace_id AND c.task_id = t.id),
	t.position, t.updated_at, t.description, t.created_at, t.id`

type portalTaskRow struct {
	PortalTaskDetail
	assignees []string
	id        string
}

func scanPortalTask(r scanner) (*portalTaskRow, error) {
	x := &portalTaskRow{}
	var assignees, labels string
	err := r.Scan(&x.Key, &x.Title, &x.StatusID, &x.StatusName, &x.Category, &x.Priority, &x.DueAt, &x.CompletedAt,
		&assignees, &labels, &x.ChecklistDone, &x.ChecklistTotal, &x.Position, &x.UpdatedAt, &x.Description, &x.CreatedAt, &x.id)
	if err != nil {
		return nil, err
	}
	x.assignees = splitIDs(assignees)
	x.Labels = []PortalLabel{}
	_ = json.Unmarshal([]byte(labels), &x.Labels)
	return x, nil
}

func (sv *Service) boardProject(ctx context.Context, ref string) (*tenant.Scope, *Project, error) {
	s, p, err := sv.portalProject(ctx, ref)
	if err != nil {
		return nil, nil, err
	}
	if !p.ShareBoard {
		return nil, nil, notFound("board")
	}
	return s, p, nil
}

// PortalBoard returns a project's board read-only (404 unless the board is shared).
func (sv *Service) PortalBoard(ctx context.Context, ref string) (*PortalBoard, error) {
	s, p, err := sv.boardProject(ctx, ref)
	if err != nil {
		return nil, err
	}
	cols, err := sv.portalColumns(ctx, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+portalTaskCols+` FROM tasks t
		JOIN task_statuses st ON st.workspace_id = t.workspace_id AND st.id = t.status_id
		WHERE t.workspace_id = $1 AND t.project_id = $2 ORDER BY st.position, t.position LIMIT 1000`, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	var list []*portalTaskRow
	ids := []string{}
	for rows.Next() {
		x, err := scanPortalTask(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, x)
		ids = append(ids, x.assignees...)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	names := sv.people(ctx, ids)
	b := &PortalBoard{Columns: cols, Tasks: make([]PortalTask, 0, len(list))}
	for _, x := range list {
		t := x.PortalTask
		t.Assignees = personList(names, x.assignees)
		b.Tasks = append(b.Tasks, t)
	}
	return b, nil
}

func personList(names map[string]PortalPerson, ids []string) []PortalPerson {
	out := []PortalPerson{}
	for _, id := range ids {
		if p, ok := names[id]; ok {
			out = append(out, p)
		}
	}
	return out
}

// PortalTask returns one task of the project read-only: card, description, checklist. Never comments.
func (sv *Service) PortalTask(ctx context.Context, ref, taskRef string) (*PortalTaskDetail, error) {
	s, p, err := sv.boardProject(ctx, ref)
	if err != nil {
		return nil, err
	}
	id, number := parseRef(taskRef)
	if id == "" && number == 0 {
		return nil, notFound("task")
	}
	x, err := scanPortalTask(sv.DB.QueryRowContext(ctx, `SELECT `+portalTaskCols+` FROM tasks t
		JOIN task_statuses st ON st.workspace_id = t.workspace_id AND st.id = t.status_id
		WHERE t.workspace_id = $1 AND t.project_id = $2 AND (t.id = $3 OR t.number = $4)`, s.WorkspaceID, p.ID, id, number))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("task")
	}
	if err != nil {
		return nil, err
	}
	d := x.PortalTaskDetail
	d.Assignees = personList(sv.people(ctx, x.assignees), x.assignees)
	d.Checklist = []PortalChecklistItem{}
	rows, err := sv.DB.QueryContext(ctx, `SELECT title, done FROM task_checklist_items WHERE workspace_id = $1 AND task_id = $2
		ORDER BY position, created_at`, s.WorkspaceID, x.id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c PortalChecklistItem
		if err := rows.Scan(&c.Title, &c.Done); err != nil {
			return nil, err
		}
		d.Checklist = append(d.Checklist, c)
	}
	return &d, rows.Err()
}

// PortalTime returns the project's tracked time: total, 12 weeks, and by task when the board is shared.
func (sv *Service) PortalTime(ctx context.Context, ref string) (*PortalTimeReport, error) {
	s, p, err := sv.portalProject(ctx, ref)
	if err != nil {
		return nil, err
	}
	base := []PortalProject{toPortal(p)}
	if err := sv.fillPortalCounts(ctx, s.WorkspaceID, base); err != nil {
		return nil, err
	}
	weeks, err := sv.portalWeeks(ctx, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	out := &PortalTimeReport{UsedMinutes: base[0].UsedMinutes, BudgetMinutes: p.BudgetMinutes, Weeks: weeks, ByTask: []PortalTaskTime{}}
	if !p.ShareBoard {
		return out, nil
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT t.key, t.title, (sum(te.duration_s) / 60)::bigint
		FROM time_entries te LEFT JOIN tasks t ON t.workspace_id = te.workspace_id AND t.id = te.task_id
		WHERE te.workspace_id = $1 AND te.project_id = $2 AND te.duration_s IS NOT NULL
		GROUP BY t.key, t.title HAVING sum(te.duration_s) >= 60 ORDER BY 3 DESC LIMIT 200`, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r PortalTaskTime
		if err := rows.Scan(&r.Key, &r.Title, &r.Minutes); err != nil {
			return nil, err
		}
		out.ByTask = append(out.ByTask, r)
	}
	return out, rows.Err()
}

// portalWeeks is the tracked time per week, the last 12 weeks in the workspace's timezone.
func (sv *Service) portalWeeks(ctx context.Context, ws, projectID string) ([]PortalWeek, error) {
	rows, err := sv.DB.QueryContext(ctx, `
		WITH tz AS (SELECT COALESCE((SELECT timezone FROM workspaces WHERE id = $1), 'UTC') AS z),
		weeks AS (SELECT generate_series(
			date_trunc('week', now() AT TIME ZONE (SELECT z FROM tz)) - interval '11 weeks',
			date_trunc('week', now() AT TIME ZONE (SELECT z FROM tz)), interval '1 week') AS wk)
		SELECT to_char(w.wk, 'YYYY-MM-DD'), COALESCE((SELECT sum(te.duration_s) FROM time_entries te
			WHERE te.workspace_id = $1 AND te.project_id = $2 AND te.duration_s IS NOT NULL
			  AND date_trunc('week', te.started_at AT TIME ZONE (SELECT z FROM tz)) = w.wk), 0)::bigint / 60
		FROM weeks w ORDER BY w.wk`, ws, projectID)
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

// PortalActivity is the project's recent customer-safe activity: task created / moved / completed
// (when the board is shared) and issue + request lifecycle. Never comments, time or people.
func (sv *Service) PortalActivity(ctx context.Context, ref string) ([]PortalActivityItem, error) {
	s, p, err := sv.portalProject(ctx, ref)
	if err != nil {
		return nil, err
	}
	out := []PortalActivityItem{}
	if p.ShareBoard {
		rows, err := sv.DB.QueryContext(ctx, `SELECT action, changes, created_at FROM activity_logs
			WHERE workspace_id = $1 AND project_id = $2 AND action IN ('task.created', 'task.moved')
			ORDER BY created_at DESC LIMIT 60`, s.WorkspaceID, p.ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var action, raw string
			var at time.Time
			if err := rows.Scan(&action, &raw, &at); err != nil {
				rows.Close()
				return nil, err
			}
			var c map[string]any
			_ = json.Unmarshal([]byte(raw), &c)
			it := PortalActivityItem{Kind: action, Key: anyString(c["key"]), Title: anyString(c["title"]), At: at}
			if action == "task.moved" {
				it.From, it.To = anyString(c["from"]), anyString(c["to"])
				if done, _ := c["done"].(bool); done {
					it.Kind = "task.completed"
				}
			} else {
				it.To = anyString(c["status"])
			}
			out = append(out, it)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	rows, err := sv.DB.QueryContext(ctx, `
		SELECT CASE WHEN request_state IS NULL OR request_state = 'accepted' THEN 'issue.created' ELSE 'request.filed' END,
			key, title, created_at FROM reports WHERE workspace_id = $1 AND project_id = $2 AND NOT from_board
		UNION ALL
		SELECT 'issue.closed', key, title, closed_at FROM reports WHERE workspace_id = $1 AND project_id = $2 AND NOT from_board
			AND closed_at IS NOT NULL AND (request_state IS NULL OR request_state = 'accepted')
		ORDER BY 4 DESC LIMIT 60`, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var it PortalActivityItem
		if err := rows.Scan(&it.Kind, &it.Key, &it.Title, &it.At); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Newest first across both sources, capped.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].At.After(out[j-1].At); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	if len(out) > 80 {
		out = out[:80]
	}
	return out, nil
}

func anyString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
