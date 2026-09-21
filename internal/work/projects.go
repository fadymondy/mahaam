package work

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
)

// ---- project access ----------------------------------------------------------

/*
visibleClause is THE project-visibility rule, as SQL over `projects p`:

	managers and up     every project
	members             projects with visibility = 'workspace', and any they belong to
	clients             ONLY projects whose client_id is the client they are a portal
	                    contact of (client_contacts) — their whole book of shared work

"Belong to" is a project_members row, or membership of a team attached to the project.
A client never gains access through project_members or a team (they are external), only
through the client their portal account is linked to. Everything that reads a project or
anything inside one goes through this, and a project the caller cannot see answers 404 —
never 403 — so its existence is not revealed.
*/
func visibleClause(s *tenant.Scope, args *[]any) string {
	// A project-scoped MCP token narrows whatever the role would see to its projects.
	if len(s.ProjectIDs) > 0 {
		*args = append(*args, s.ProjectIDs)
		n := len(*args)
		return fmt.Sprintf("(p.id = ANY($%d::text[]) AND %s)", n, roleVisibleClause(s, args))
	}
	return roleVisibleClause(s, args)
}

func roleVisibleClause(s *tenant.Scope, args *[]any) string {
	if atLeast(s, authz.Manager) {
		return "TRUE"
	}
	*args = append(*args, s.UserID)
	u := len(*args)
	// A client sees exactly the projects belonging to the client record their portal
	// account is a contact of — nothing wider, and project_members/teams never apply.
	// A customer (client role) sees the projects of the client record they are a portal
	// contact of, plus any project they were added to directly or through a team — the
	// way a manager naturally "gives the customer access to the project". Tasks stay
	// hidden either way (authz.TasksRead is member+); the portal shows aggregates only.
	if !atLeast(s, authz.Member) {
		return fmt.Sprintf(`((p.client_id IS NOT NULL AND EXISTS (
			SELECT 1 FROM client_contacts cc
			WHERE cc.workspace_id = p.workspace_id AND cc.user_id = $%[1]d AND cc.client_id = p.client_id))
		OR EXISTS (SELECT 1 FROM project_members pm
			WHERE pm.workspace_id = p.workspace_id AND pm.project_id = p.id AND pm.user_id = $%[1]d)
		OR EXISTS (SELECT 1 FROM project_teams pt JOIN team_members tmm
			ON tmm.workspace_id = pt.workspace_id AND tmm.team_id = pt.team_id
			WHERE pt.workspace_id = p.workspace_id AND pt.project_id = p.id AND tmm.user_id = $%[1]d))`, u)
	}
	// Full access, or a task grant / assignment inside the project (which shows the project
	// but only those tasks — taskClause).
	return "(" + fullAccessSQL(u) + " OR " + fmt.Sprintf(`EXISTS (SELECT 1 FROM tasks gt
		WHERE gt.workspace_id = p.workspace_id AND gt.project_id = p.id AND (%s))`, taskGrantSQL("gt", u)) + ")"
}

// fullAccessSQL: a member sees the whole project when it is workspace-visible, they are on
// it (project_members), a team they are in is attached (project_teams), or they — or a
// team of theirs — hold a grant on a label the project carries (project_labels). $u is the
// user id.
func fullAccessSQL(u int) string {
	return fmt.Sprintf(`(p.visibility = 'workspace' OR EXISTS (SELECT 1 FROM project_members pm
		WHERE pm.workspace_id = p.workspace_id AND pm.project_id = p.id AND pm.user_id = $%[1]d)
	OR EXISTS (SELECT 1 FROM project_teams pt JOIN team_members tmm
		ON tmm.workspace_id = pt.workspace_id AND tmm.team_id = pt.team_id
		WHERE pt.workspace_id = p.workspace_id AND pt.project_id = p.id AND tmm.user_id = $%[1]d)
	OR EXISTS (SELECT 1 FROM project_labels pl JOIN access_grants g
		ON g.workspace_id = pl.workspace_id AND g.scope_type = 'label' AND g.scope_id = pl.label_id
		WHERE pl.workspace_id = p.workspace_id AND pl.project_id = p.id AND %[2]s))`, u, grantSubjectSQL("g", u))
}

// grantSubjectSQL matches a grant row g given to user $u directly or to a team they are in.
func grantSubjectSQL(g string, u int) string {
	return fmt.Sprintf(`((%[1]s.subject_type = 'user' AND %[1]s.subject_id = $%[2]d) OR (%[1]s.subject_type = 'team' AND EXISTS (
		SELECT 1 FROM team_members gtm WHERE gtm.workspace_id = %[1]s.workspace_id AND gtm.team_id = %[1]s.subject_id AND gtm.user_id = $%[2]d)))`, g, u)
}

// taskGrantSQL: task t (alias) is granted to $u (or a team of theirs), or assigned to them.
func taskGrantSQL(t string, u int) string {
	return fmt.Sprintf(`EXISTS (SELECT 1 FROM access_grants tg WHERE tg.workspace_id = %[1]s.workspace_id
		AND tg.scope_type = 'task' AND tg.scope_id = %[1]s.id AND %[3]s)
	OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.workspace_id = %[1]s.workspace_id AND ta.task_id = %[1]s.id AND ta.user_id = $%[2]d)`,
		t, u, grantSubjectSQL("tg", u))
}

// taskClause is visibleClause for a task row t joined to its project p: full access to the
// project, or this very task is granted to / assigned to the caller.
func taskClause(s *tenant.Scope, args *[]any) string {
	if atLeast(s, authz.Manager) {
		return "TRUE"
	}
	if !atLeast(s, authz.Member) {
		return visibleClause(s, args) // clients never read tasks (authz.TasksRead); kept for completeness
	}
	*args = append(*args, s.UserID)
	u := len(*args)
	return "(" + fullAccessSQL(u) + " OR " + taskGrantSQL("t", u) + ")"
}

// hasFullAccess reports whether the caller sees the whole project (not only granted tasks).
func hasFullAccess(ctx context.Context, q querier, s *tenant.Scope, projectID string) bool {
	if atLeast(s, authz.Manager) {
		return true
	}
	if !atLeast(s, authz.Member) {
		return false
	}
	var ok bool
	_ = q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM projects p WHERE p.workspace_id = $1 AND p.id = $2 AND `+fullAccessSQL(3)+`)`,
		s.WorkspaceID, projectID, s.UserID).Scan(&ok)
	return ok
}

// Project is a project as listed.
type Project struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Description   *string    `json:"description"`
	Color         string     `json:"color"`
	Status        string     `json:"status" enum:"planned,active,on_hold,completed,cancelled" doc:"planned, active, on_hold, completed, cancelled"`
	BillingMode   string     `json:"billing_mode" enum:"non_billable,hourly,fixed" doc:"non_billable, hourly, fixed"`
	BudgetMinutes *int64     `json:"budget_minutes"`
	BudgetMinor   *int64     `json:"budget_minor" doc:"Budget in minor units of currency"`
	Currency      *string    `json:"currency"`
	Visibility    string     `json:"visibility" doc:"workspace (every member) or members (only people on the project)"`
	StartsOn      *string    `json:"starts_on" doc:"YYYY-MM-DD"`
	EndsOn        *string    `json:"ends_on" doc:"YYYY-MM-DD"`
	ArchivedAt    *time.Time `json:"archived_at"`
	ClientID      *string    `json:"client_id"`
	ClientName    *string    `json:"client_name"`
	CreatedBy     string     `json:"created_by"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	Tasks         TaskCounts `json:"tasks"`
	MemberCount   int        `json:"member_count"`
	Avatar        *string    `json:"avatar" doc:"data: URL of the project's image; null = coloured initials"`
	// Issues counts the project's items by issue status (the board's columns); only in lists.
	Issues map[string]int `json:"issues,omitempty" doc:"Items per status: backlog, todo, in_progress, waiting_approval, in_review, done"`
	// What the project's customer sees in the portal (19c_portal_share.sql).
	ShareBoard bool `json:"share_board" doc:"Customers see the task board read-only (titles, columns, due dates, assignees, labels)"`
	ShareTeam  bool `json:"share_team" doc:"Customers see who works on the project (names only, never rates)"`
	ShareMoney bool `json:"share_money" doc:"Customers see the money budget"`
}

// TaskCounts are a project's tasks by status category.
type TaskCounts struct {
	Todo  int `json:"todo"`
	Doing int `json:"doing"`
	Done  int `json:"done"`
}

func countBy(cat string) string {
	return `(SELECT count(*) FROM tasks t JOIN task_statuses st ON st.workspace_id = t.workspace_id AND st.id = t.status_id
		WHERE t.workspace_id = p.workspace_id AND t.project_id = p.id AND st.category = '` + cat + `')`
}

var projectCols = `p.id, p.name, p.description, p.color, p.status, p.billing_mode, p.budget_minutes, p.budget_minor,
	p.currency, p.visibility, p.starts_on, p.ends_on, p.archived_at, p.client_id,
	(SELECT c.name FROM clients c WHERE c.workspace_id = p.workspace_id AND c.id = p.client_id),
	p.created_by, p.created_at, p.updated_at, ` + countBy("todo") + `, ` + countBy("doing") + `, ` + countBy("done") + `,
	(SELECT count(*) FROM project_members pm WHERE pm.workspace_id = p.workspace_id AND pm.project_id = p.id),
	p.share_board, p.share_team, p.share_money, p.avatar`

func scanProject(r scanner) (*Project, error) {
	p := &Project{}
	var starts, ends *time.Time
	err := r.Scan(&p.ID, &p.Name, &p.Description, &p.Color, &p.Status, &p.BillingMode, &p.BudgetMinutes, &p.BudgetMinor,
		&p.Currency, &p.Visibility, &starts, &ends, &p.ArchivedAt, &p.ClientID, &p.ClientName,
		&p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &p.Tasks.Todo, &p.Tasks.Doing, &p.Tasks.Done, &p.MemberCount,
		&p.ShareBoard, &p.ShareTeam, &p.ShareMoney, &p.Avatar)
	p.StartsOn, p.EndsOn = dayString(starts), dayString(ends)
	return p, err
}

// loadProject returns a project the caller can see, or 404.
func loadProject(ctx context.Context, q querier, s *tenant.Scope, id string) (*Project, error) {
	args := []any{s.WorkspaceID, strings.TrimSpace(id)}
	clause := visibleClause(s, &args)
	p, err := scanProject(q.QueryRowContext(ctx, `SELECT `+projectCols+` FROM projects p
		WHERE p.workspace_id = $1 AND p.id = $2 AND `+clause, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("project")
	}
	return p, err
}

// canManage: managers and up, or the project's lead.
func canManage(ctx context.Context, q querier, s *tenant.Scope, projectID string) bool {
	if authz.Can(s.Role, authz.ProjectsManage) {
		return true
	}
	var lead bool
	_ = q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM project_members WHERE workspace_id = $1
		AND project_id = $2 AND user_id = $3 AND role = 'lead')`, s.WorkspaceID, projectID, s.UserID).Scan(&lead)
	return lead && atLeast(s, authz.Member)
}

func requireManage(ctx context.Context, q querier, s *tenant.Scope, projectID string) error {
	if canManage(ctx, q, s, projectID) {
		return nil
	}
	return forbidden("only managers and the project's lead can change this project")
}

// requireWritable: the caller may write tasks, and the project is not archived.
func requireWritable(s *tenant.Scope, p *Project) error {
	if err := require(s, authz.TasksWrite); err != nil {
		return err
	}
	if p.ArchivedAt != nil {
		return invalid("the project is archived — restore it to change its tasks")
	}
	return nil
}

// ---- listing and reading ---------------------------------------------------------

// ProjectFilter narrows ListProjects.
type ProjectFilter struct {
	Archived bool   // archived projects instead of active ones
	Status   string // planned | active | on_hold | completed | cancelled
	ClientID string
	Q        string
}

// ListProjects lists the projects the caller can see.
func (sv *Service) ListProjects(ctx context.Context, f ProjectFilter) ([]Project, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ProjectsRead); err != nil {
		return nil, err
	}
	args := []any{s.WorkspaceID}
	where := "p.workspace_id = $1 AND " + visibleClause(s, &args)
	if f.Archived {
		where += " AND p.archived_at IS NOT NULL"
	} else {
		where += " AND p.archived_at IS NULL"
	}
	if f.Status != "" {
		args = append(args, f.Status)
		where += fmt.Sprintf(" AND p.status = $%d", len(args))
	}
	if f.ClientID != "" {
		args = append(args, f.ClientID)
		where += fmt.Sprintf(" AND p.client_id = $%d", len(args))
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		args = append(args, "%"+q+"%")
		where += fmt.Sprintf(" AND p.name ILIKE $%d", len(args))
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+projectCols+` FROM projects p WHERE `+where+`
		ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END, lower(p.name)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	// The issue track: items per status, for every listed project in one query.
	at := map[string]int{}
	ids := make([]string, len(out))
	for i := range out {
		at[out[i].ID], ids[i] = i, out[i].ID
		out[i].Issues = map[string]int{}
	}
	cr, err := sv.DB.QueryContext(ctx, `SELECT project_id, status, count(*) FROM reports
		WHERE workspace_id = $1 AND project_id = ANY($2) AND (request_state IS NULL OR request_state = 'accepted')
		GROUP BY project_id, status`, s.WorkspaceID, ids)
	if err != nil {
		return nil, err
	}
	defer cr.Close()
	for cr.Next() {
		var pid, st string
		var n int
		if err := cr.Scan(&pid, &st, &n); err != nil {
			return nil, err
		}
		out[at[pid]].Issues[st] = n
	}
	return out, cr.Err()
}

// FindProject resolves an id or an exact name (case-insensitive) — for MCP callers.
func (sv *Service) FindProject(ctx context.Context, ref string) (*Project, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, invalid("name a project (its id or its name)")
	}
	args := []any{s.WorkspaceID, ref}
	clause := visibleClause(s, &args)
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+projectCols+` FROM projects p WHERE p.workspace_id = $1
		AND (p.id = $2 OR lower(p.name) = lower($2)) AND `+clause+` ORDER BY p.archived_at NULLS FIRST, p.created_at`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var found []*Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		if p.ID == ref {
			return p, nil
		}
		found = append(found, p)
	}
	switch len(found) {
	case 0:
		return nil, notFound("project")
	case 1:
		return found[0], nil
	}
	return nil, invalid("%d projects are named %q — use the id", len(found), ref)
}

// ProjectMember is a direct member of a project.
type ProjectMember struct {
	UserID string `json:"user_id"`
	Role   string `json:"role" doc:"lead or member"`
}

// ProjectTeam is a team attached to a project.
type ProjectTeam struct {
	TeamID    string   `json:"team_id"`
	Name      string   `json:"name"`
	Color     string   `json:"color"`
	MemberIDs []string `json:"member_ids"`
}

// ProjectDetail is a project with its people, statuses and what the caller may do.
type ProjectDetail struct {
	Project
	Members   []ProjectMember `json:"members"`
	Teams     []ProjectTeam   `json:"teams"`
	Statuses  []Status        `json:"statuses"`
	CanManage bool            `json:"can_manage"`
	CanWrite  bool            `json:"can_write"`
}

// GetProject returns one project the caller can see.
func (sv *Service) GetProject(ctx context.Context, id string) (*ProjectDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ProjectsRead); err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, id)
	if err != nil {
		return nil, err
	}
	d := &ProjectDetail{Project: *p, Members: []ProjectMember{}, Teams: []ProjectTeam{}}
	rows, err := sv.DB.QueryContext(ctx, `SELECT user_id, role FROM project_members WHERE workspace_id = $1 AND project_id = $2
		ORDER BY role = 'lead' DESC, created_at`, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m ProjectMember
		if err := rows.Scan(&m.UserID, &m.Role); err != nil {
			rows.Close()
			return nil, err
		}
		d.Members = append(d.Members, m)
	}
	rows.Close()
	rows, err = sv.DB.QueryContext(ctx, `SELECT tm.id, tm.name, tm.color,
		COALESCE((SELECT string_agg(x.user_id, ',') FROM team_members x WHERE x.workspace_id = tm.workspace_id AND x.team_id = tm.id), '')
		FROM project_teams pt JOIN teams tm ON tm.workspace_id = pt.workspace_id AND tm.id = pt.team_id
		WHERE pt.workspace_id = $1 AND pt.project_id = $2 ORDER BY lower(tm.name)`, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t ProjectTeam
		var ids string
		if err := rows.Scan(&t.TeamID, &t.Name, &t.Color, &ids); err != nil {
			rows.Close()
			return nil, err
		}
		t.MemberIDs = splitIDs(ids)
		d.Teams = append(d.Teams, t)
	}
	rows.Close()
	if d.Statuses, err = listStatuses(ctx, sv.DB, s.WorkspaceID, p.ID); err != nil {
		return nil, err
	}
	d.CanManage = canManage(ctx, sv.DB, s, p.ID)
	d.CanWrite = authz.Can(s.Role, authz.TasksWrite) && p.ArchivedAt == nil
	return d, nil
}

// ---- writing ------------------------------------------------------------------------

// ProjectInput creates or patches a project. On a patch an omitted field is unchanged; an
// empty string clears a nullable text/date field and 0 clears a budget.
type ProjectInput struct {
	Name          *string `json:"name,omitempty" maxLength:"120"`
	Description   *string `json:"description,omitempty" maxLength:"10000"`
	Color         *string `json:"color,omitempty" doc:"Palette key: violet, blue, teal, green, amber, orange, red, pink, slate"`
	Status        *string `json:"status,omitempty" enum:"planned,active,on_hold,completed,cancelled"`
	BillingMode   *string `json:"billing_mode,omitempty" enum:"non_billable,hourly,fixed"`
	BudgetMinutes *int64  `json:"budget_minutes,omitempty" minimum:"0" doc:"0 clears"`
	BudgetMinor   *int64  `json:"budget_minor,omitempty" minimum:"0" doc:"Minor units; 0 clears"`
	Currency      *string `json:"currency,omitempty" doc:"ISO 4217; empty clears"`
	Visibility    *string `json:"visibility,omitempty" enum:"workspace,members"`
	ClientID      *string `json:"client_id,omitempty" doc:"Empty clears"`
	StartsOn      *string `json:"starts_on,omitempty" doc:"YYYY-MM-DD; empty clears"`
	EndsOn        *string `json:"ends_on,omitempty" doc:"YYYY-MM-DD; empty clears"`
	ShareBoard    *bool   `json:"share_board,omitempty" doc:"Customer portal: show the task board read-only"`
	ShareTeam     *bool   `json:"share_team,omitempty" doc:"Customer portal: show the team's names"`
	ShareMoney    *bool   `json:"share_money,omitempty" doc:"Customer portal: show the money budget"`
}

func projectValues(ctx context.Context, q querier, ws string, in ProjectInput, p *patch, current *Project) error {
	if v, ok := trimmed(in.Name); ok {
		if v == "" {
			return invalid("a project needs a name")
		}
		p.set("name", v)
	}
	if v, ok := trimmed(in.Description); ok {
		p.set("description", nullIfEmpty(v))
	}
	if in.Color != nil {
		def := "violet"
		if current != nil {
			def = current.Color
		}
		c, err := pickColor(in.Color, def)
		if err != nil {
			return err
		}
		p.set("color", c)
	}
	if v, ok := trimmed(in.Status); ok {
		if err := oneOf("status", v, "planned", "active", "on_hold", "completed", "cancelled"); err != nil {
			return err
		}
		p.set("status", v)
	}
	if v, ok := trimmed(in.BillingMode); ok {
		if err := oneOf("billing_mode", v, "non_billable", "hourly", "fixed"); err != nil {
			return err
		}
		p.set("billing_mode", v)
	}
	if in.BudgetMinutes != nil {
		if *in.BudgetMinutes < 0 {
			return invalid("budget_minutes cannot be negative")
		}
		if *in.BudgetMinutes == 0 {
			p.set("budget_minutes", nil)
		} else {
			p.set("budget_minutes", *in.BudgetMinutes)
		}
	}
	if in.BudgetMinor != nil {
		if *in.BudgetMinor < 0 {
			return invalid("budget_minor cannot be negative")
		}
		if *in.BudgetMinor == 0 {
			p.set("budget_minor", nil)
		} else {
			p.set("budget_minor", *in.BudgetMinor)
		}
	}
	if v, ok := trimmed(in.Currency); ok {
		v = strings.ToUpper(v)
		if v != "" && !currencyRe.MatchString(v) {
			return invalid("currency must be a three-letter ISO code, e.g. USD")
		}
		p.set("currency", nullIfEmpty(v))
	}
	if v, ok := trimmed(in.Visibility); ok {
		if err := oneOf("visibility", v, "workspace", "members"); err != nil {
			return err
		}
		p.set("visibility", v)
	}
	if v, ok := trimmed(in.ClientID); ok {
		if v != "" {
			c, err := findClient(ctx, q, ws, v)
			if err != nil {
				return invalid("unknown client %q", v)
			}
			v = c.ID
		}
		p.set("client_id", nullIfEmpty(v))
	}
	for _, b := range []struct {
		col string
		in  *bool
	}{{"share_board", in.ShareBoard}, {"share_team", in.ShareTeam}, {"share_money", in.ShareMoney}} {
		if b.in != nil {
			p.set(b.col, *b.in)
		}
	}
	for _, d := range []struct {
		col string
		in  *string
	}{{"starts_on", in.StartsOn}, {"ends_on", in.EndsOn}} {
		if v, ok := trimmed(d.in); ok {
			t, err := parseDay(v)
			if err != nil {
				return err
			}
			if t == nil {
				p.set(d.col, nil)
			} else {
				p.set(d.col, *t)
			}
		}
	}
	return nil
}

// The default workflow: one column per stage of the issue tracker / agent loop. A project's
// columns are its workflow (Settings → Board columns): {name, category, stage}.
var defaultStatuses = map[string][6][3]string{
	"en": {{"Backlog", "todo", "backlog"}, {"To do", "todo", "todo"}, {"In progress", "doing", "in_progress"},
		{"Waiting approval", "doing", "waiting_approval"}, {"In review", "doing", "in_review"}, {"Done", "done", "done"}},
	"ar": {{"قائمة الانتظار", "todo", "backlog"}, {"للتنفيذ", "todo", "todo"}, {"قيد التنفيذ", "doing", "in_progress"},
		{"بانتظار الموافقة", "doing", "waiting_approval"}, {"قيد المراجعة", "doing", "in_review"}, {"منجز", "done", "done"}},
}

var defaultStatusColors = [6]string{"slate", "blue", "violet", "orange", "amber", "green"}

// stageCategory is the coarse category (reports, progress) of a workflow stage.
func stageCategory(stage string) string {
	switch stage {
	case "in_progress", "waiting_approval", "in_review":
		return "doing"
	case "done":
		return "done"
	}
	return "todo"
}

var stages = []string{"backlog", "todo", "in_progress", "waiting_approval", "in_review", "done"}

// CreateProject creates a project with the four default statuses (in the workspace's
// language) and the creator as its lead.
func (sv *Service) CreateProject(ctx context.Context, in ProjectInput) (*ProjectDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ProjectsCreate); err != nil {
		return nil, err
	}
	if err := quota(ctx, s, limits.Projects, 1); err != nil {
		return nil, err
	}
	if v, _ := trimmed(in.Name); v == "" {
		return nil, invalid("a project needs a name")
	}
	p := newPatch()
	if err := projectValues(ctx, sv.DB, s.WorkspaceID, in, p, nil); err != nil {
		return nil, err
	}
	p.set("created_by", s.UserID)
	var locale string
	_ = sv.DB.QueryRowContext(ctx, `SELECT locale FROM workspaces WHERE id = $1`, s.WorkspaceID).Scan(&locale)
	names, ok := defaultStatuses[locale]
	if !ok {
		names = defaultStatuses["en"]
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		cols, marks, args := p.insert(s.WorkspaceID)
		if err := tx.QueryRowContext(ctx, `INSERT INTO projects (`+cols+`) VALUES (`+marks+`) RETURNING id`, args...).Scan(&id); err != nil {
			return err
		}
		for i, st := range names {
			if _, err := tx.ExecContext(ctx, `INSERT INTO task_statuses (workspace_id, project_id, name, color, category, position, stage)
				VALUES ($1, $2, $3, $4, $5, $6, $7)`, s.WorkspaceID, id, st[0], defaultStatusColors[i], st[1], float64(i+1)*1024, st[2]); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_members (workspace_id, project_id, user_id, role) VALUES ($1, $2, $3, 'lead')`,
			s.WorkspaceID, id, s.UserID); err != nil {
			return err
		}
		delete(p.changes, "created_by")
		return record(ctx, tx, s, entry{ProjectID: id, Action: "project.created", SubjectType: "project", SubjectID: id, Changes: p.changes})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetProject(ctx, id)
}

// UpdateProject patches a project (managers, or its lead).
func (sv *Service) UpdateProject(ctx context.Context, id string, in ProjectInput) (*ProjectDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	cur, err := loadProject(ctx, sv.DB, s, id)
	if err != nil {
		return nil, err
	}
	if err := requireManage(ctx, sv.DB, s, cur.ID); err != nil {
		return nil, err
	}
	p := newPatch()
	if err := projectValues(ctx, sv.DB, s.WorkspaceID, in, p, cur); err != nil {
		return nil, err
	}
	if !p.empty() {
		err = sv.tx(ctx, func(tx *sql.Tx) error {
			if err := p.update(ctx, tx, "projects", s.WorkspaceID, cur.ID); err != nil {
				return err
			}
			p.changes["name"] = firstString(p.changes["name"], cur.Name)
			return record(ctx, tx, s, entry{ProjectID: cur.ID, Action: "project.updated", SubjectType: "project", SubjectID: cur.ID, Changes: p.changes})
		})
		if err != nil {
			return nil, err
		}
	}
	return sv.GetProject(ctx, cur.ID)
}

// SetProjectArchived archives or restores a project. Archived projects are read-only.
func (sv *Service) SetProjectArchived(ctx context.Context, id string, archived bool) (*ProjectDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	cur, err := loadProject(ctx, sv.DB, s, id)
	if err != nil {
		return nil, err
	}
	if err := requireManage(ctx, sv.DB, s, cur.ID); err != nil {
		return nil, err
	}
	action, expr := "project.archived", "now()"
	if !archived {
		action, expr = "project.restored", "NULL"
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE projects SET archived_at = `+expr+`, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, cur.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: cur.ID, Action: action, SubjectType: "project", SubjectID: cur.ID,
			Changes: map[string]any{"name": cur.Name}})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetProject(ctx, cur.ID)
}

// AddProjectMember adds (or re-roles) a workspace member on a project.
func (sv *Service) AddProjectMember(ctx context.Context, projectID, userID, role string) (*ProjectDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, projectID)
	if err != nil {
		return nil, err
	}
	if err := requireManage(ctx, sv.DB, s, p.ID); err != nil {
		return nil, err
	}
	if role == "" {
		role = "member"
	}
	if err := oneOf("role", role, "lead", "member"); err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	if err := activeMembers(ctx, sv.DB, s.WorkspaceID, []string{userID}); err != nil {
		return nil, err
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_members (workspace_id, project_id, user_id, role) VALUES ($1, $2, $3, $4)
			ON CONFLICT (workspace_id, project_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
			s.WorkspaceID, p.ID, userID, role); err != nil {
			return err
		}
		// A customer added to a client's project also becomes that client's portal contact
		// (if they are not one already), so their invoices show in the portal too.
		if p.ClientID != nil {
			if _, err := tx.ExecContext(ctx, `INSERT INTO client_contacts (workspace_id, client_id, user_id)
				SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM workspace_members m
					WHERE m.workspace_id = $1 AND m.user_id = $3 AND m.role = 'client')
				ON CONFLICT (workspace_id, user_id) DO NOTHING`, s.WorkspaceID, *p.ClientID, userID); err != nil {
				return err
			}
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "project.member_added", SubjectType: "project", SubjectID: p.ID,
			Changes: map[string]any{"user_id": userID, "role": role}})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetProject(ctx, p.ID)
}

// RemoveProjectMember removes a direct member. Their task assignments stay.
func (sv *Service) RemoveProjectMember(ctx context.Context, projectID, userID string) (*ProjectDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, projectID)
	if err != nil {
		return nil, err
	}
	if err := requireManage(ctx, sv.DB, s, p.ID); err != nil {
		return nil, err
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM project_members WHERE workspace_id = $1 AND project_id = $2 AND user_id = $3`,
			s.WorkspaceID, p.ID, strings.TrimSpace(userID))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return notFound("project member")
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "project.member_removed", SubjectType: "project", SubjectID: p.ID,
			Changes: map[string]any{"user_id": userID}})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetProject(ctx, p.ID)
}

// AttachTeam gives a team's members access to a project.
func (sv *Service) AttachTeam(ctx context.Context, projectID, teamID string) (*ProjectDetail, error) {
	return sv.teamLink(ctx, projectID, teamID, true)
}

// DetachTeam removes a team's access path to a project.
func (sv *Service) DetachTeam(ctx context.Context, projectID, teamID string) (*ProjectDetail, error) {
	return sv.teamLink(ctx, projectID, teamID, false)
}

func (sv *Service) teamLink(ctx context.Context, projectID, teamID string, attach bool) (*ProjectDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, projectID)
	if err != nil {
		return nil, err
	}
	if err := requireManage(ctx, sv.DB, s, p.ID); err != nil {
		return nil, err
	}
	t, err := loadTeam(ctx, sv.DB, s.WorkspaceID, teamID)
	if err != nil {
		return nil, err
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		action := "project.team_attached"
		if attach {
			if _, err := tx.ExecContext(ctx, `INSERT INTO project_teams (workspace_id, project_id, team_id) VALUES ($1, $2, $3)
				ON CONFLICT (workspace_id, project_id, team_id) DO NOTHING`, s.WorkspaceID, p.ID, t.ID); err != nil {
				return err
			}
		} else {
			action = "project.team_detached"
			res, err := tx.ExecContext(ctx, `DELETE FROM project_teams WHERE workspace_id = $1 AND project_id = $2 AND team_id = $3`,
				s.WorkspaceID, p.ID, t.ID)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return notFound("attached team")
			}
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: action, SubjectType: "project", SubjectID: p.ID,
			Changes: map[string]any{"team": t.Name, "team_id": t.ID}})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetProject(ctx, p.ID)
}

// ---- statuses (kanban columns) ----------------------------------------------------------

// Status is a kanban column of a project.
type Status struct {
	ID        string  `json:"id"`
	ProjectID string  `json:"project_id"`
	Name      string  `json:"name"`
	Color     string  `json:"color"`
	Category  string  `json:"category" doc:"todo, doing or done"`
	Stage     string  `json:"stage" doc:"Workflow stage of the column: backlog, todo, in_progress, waiting_approval, in_review or done"`
	Position  float64 `json:"position"`
	TaskCount int     `json:"task_count"`
}

const statusCols = `st.id, st.project_id, st.name, st.color, st.category, COALESCE(st.stage, CASE st.category WHEN 'doing' THEN 'in_progress' WHEN 'done' THEN 'done' ELSE 'todo' END), st.position,
	(SELECT count(*) FROM tasks t WHERE t.workspace_id = st.workspace_id AND t.status_id = st.id)`

func scanStatus(r scanner) (*Status, error) {
	st := &Status{}
	err := r.Scan(&st.ID, &st.ProjectID, &st.Name, &st.Color, &st.Category, &st.Stage, &st.Position, &st.TaskCount)
	return st, err
}

func listStatuses(ctx context.Context, q querier, ws, projectID string) ([]Status, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+statusCols+` FROM task_statuses st
		WHERE st.workspace_id = $1 AND st.project_id = $2 ORDER BY st.position, st.created_at`, ws, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Status{}
	for rows.Next() {
		st, err := scanStatus(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *st)
	}
	return out, rows.Err()
}

// resolveStatus finds a status of a project by id or name (case-insensitive).
func resolveStatus(ctx context.Context, q querier, ws, projectID, ref string) (*Status, error) {
	list, err := listStatuses(ctx, q, ws, projectID)
	if err != nil {
		return nil, err
	}
	ref = strings.TrimSpace(ref)
	names := []string{}
	for i := range list {
		if list[i].ID == ref || strings.EqualFold(list[i].Name, ref) {
			return &list[i], nil
		}
		names = append(names, list[i].Name)
	}
	return nil, invalid("no status %q in this project (it has: %s)", ref, strings.Join(names, ", "))
}

// StatusInput creates or patches a status. Index moves it to that 0-based column position.
type StatusInput struct {
	Name     *string `json:"name,omitempty" maxLength:"60"`
	Color    *string `json:"color,omitempty"`
	Category *string `json:"category,omitempty" enum:"todo,doing,done"`
	Stage    *string `json:"stage,omitempty" enum:"backlog,todo,in_progress,waiting_approval,in_review,done" doc:"Workflow stage; sets the category too"`
	Index    *int    `json:"index,omitempty" minimum:"0"`
}

func loadStatus(ctx context.Context, q querier, s *tenant.Scope, id string) (*Status, *Project, error) {
	st, err := scanStatus(q.QueryRowContext(ctx, `SELECT `+statusCols+` FROM task_statuses st WHERE st.workspace_id = $1 AND st.id = $2`,
		s.WorkspaceID, strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, notFound("status")
	}
	if err != nil {
		return nil, nil, err
	}
	p, err := loadProject(ctx, q, s, st.ProjectID)
	if err != nil {
		return nil, nil, notFound("status")
	}
	return st, p, nil
}

// CreateStatus appends a column to a project's board.
func (sv *Service) CreateStatus(ctx context.Context, projectID string, in StatusInput) (*Status, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, projectID)
	if err != nil {
		return nil, err
	}
	if err := requireManage(ctx, sv.DB, s, p.ID); err != nil {
		return nil, err
	}
	name, _ := trimmed(in.Name)
	if name == "" {
		return nil, invalid("a status needs a name")
	}
	cat := "doing"
	if v, ok := trimmed(in.Category); ok && v != "" {
		if err := oneOf("category", v, "todo", "doing", "done"); err != nil {
			return nil, err
		}
		cat = v
	}
	stage := map[string]string{"todo": "todo", "doing": "in_progress", "done": "done"}[cat]
	if v, ok := trimmed(in.Stage); ok && v != "" {
		if err := oneOf("stage", v, stages...); err != nil {
			return nil, err
		}
		stage, cat = v, stageCategory(v)
	}
	color, err := pickColor(in.Color, "slate")
	if err != nil {
		return nil, err
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO task_statuses (workspace_id, project_id, name, color, category, position, stage)
			VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(position), 0) + 1024 FROM task_statuses WHERE workspace_id = $1 AND project_id = $2), $6)
			RETURNING id`, s.WorkspaceID, p.ID, name, color, cat, stage).Scan(&id); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "status.created", SubjectType: "status", SubjectID: id,
			Changes: map[string]any{"name": name, "category": cat}})
	})
	if err != nil {
		return nil, err
	}
	st, _, err := loadStatus(ctx, sv.DB, s, id)
	return st, err
}

// UpdateStatus renames, recolours, re-categorises or reorders a column. Changing the
// category to or from "done" updates its tasks' completed_at.
func (sv *Service) UpdateStatus(ctx context.Context, id string, in StatusInput) (*Status, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	st, p, err := loadStatus(ctx, sv.DB, s, id)
	if err != nil {
		return nil, err
	}
	if err := requireManage(ctx, sv.DB, s, p.ID); err != nil {
		return nil, err
	}
	pt := newPatch()
	if v, ok := trimmed(in.Name); ok {
		if v == "" {
			return nil, invalid("a status needs a name")
		}
		pt.set("name", v)
	}
	if in.Color != nil {
		c, err := pickColor(in.Color, st.Color)
		if err != nil {
			return nil, err
		}
		pt.set("color", c)
	}
	if v, ok := trimmed(in.Category); ok && v != st.Category {
		if err := oneOf("category", v, "todo", "doing", "done"); err != nil {
			return nil, err
		}
		pt.set("category", v)
	}
	if v, ok := trimmed(in.Stage); ok && v != "" && v != st.Stage {
		if err := oneOf("stage", v, stages...); err != nil {
			return nil, err
		}
		pt.set("stage", v)
		pt.set("category", stageCategory(v))
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if in.Index != nil {
			others, err := listStatuses(ctx, tx, s.WorkspaceID, p.ID)
			if err != nil {
				return err
			}
			pos := []float64{}
			for _, o := range others {
				if o.ID != st.ID {
					pos = append(pos, o.Position)
				}
			}
			next, ok := between(pos, *in.Index)
			if !ok { // exhausted gap: renumber, then insert
				if _, err := tx.ExecContext(ctx, `UPDATE task_statuses x SET position = r.rn * 1024
					FROM (SELECT id, row_number() OVER (ORDER BY position, created_at) AS rn FROM task_statuses
					      WHERE workspace_id = $1 AND project_id = $2 AND id <> $3) r
					WHERE x.workspace_id = $1 AND x.id = r.id`, s.WorkspaceID, p.ID, st.ID); err != nil {
					return err
				}
				for i := range pos {
					pos[i] = float64(i+1) * 1024
				}
				next, _ = between(pos, *in.Index)
			}
			pt.set("position", next)
		}
		if pt.empty() {
			return nil
		}
		if err := pt.update(ctx, tx, "task_statuses", s.WorkspaceID, st.ID); err != nil {
			return err
		}
		if cat, ok := pt.changes["category"].(string); ok {
			if err := syncCompleted(ctx, tx, s.WorkspaceID, "status_id = $2", st.ID, cat); err != nil {
				return err
			}
		}
		pt.changes["name"] = firstString(pt.changes["name"], st.Name)
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "status.updated", SubjectType: "status", SubjectID: st.ID, Changes: pt.changes})
	})
	if err != nil {
		return nil, err
	}
	out, _, err := loadStatus(ctx, sv.DB, s, st.ID)
	return out, err
}

// syncCompleted sets completed_at for the tasks matching where ($1 = workspace, $2 = arg).
func syncCompleted(ctx context.Context, q querier, ws, where, arg, category string) error {
	expr := "NULL"
	if category == "done" {
		expr = "COALESCE(completed_at, now())"
	}
	_, err := q.ExecContext(ctx, `UPDATE tasks SET completed_at = `+expr+`, updated_at = now() WHERE workspace_id = $1 AND `+where, ws, arg)
	return err
}

// DeleteStatus removes a column. Its tasks move to moveTo (required when it has any), at the
// end of that column. A project keeps at least one status.
func (sv *Service) DeleteStatus(ctx context.Context, id, moveTo string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	st, p, err := loadStatus(ctx, sv.DB, s, id)
	if err != nil {
		return err
	}
	if err := requireManage(ctx, sv.DB, s, p.ID); err != nil {
		return err
	}
	all, err := listStatuses(ctx, sv.DB, s.WorkspaceID, p.ID)
	if err != nil {
		return err
	}
	if len(all) <= 1 {
		return invalid("a project needs at least one status")
	}
	var target *Status
	if st.TaskCount > 0 {
		if strings.TrimSpace(moveTo) == "" {
			return invalid("this status has %d task(s) — choose a status to move them to", st.TaskCount)
		}
		if target, err = resolveStatus(ctx, sv.DB, s.WorkspaceID, p.ID, moveTo); err != nil {
			return err
		}
		if target.ID == st.ID {
			return invalid("choose a different status to move the tasks to")
		}
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		changes := map[string]any{"name": st.Name}
		if target != nil {
			if _, err := tx.ExecContext(ctx, `UPDATE tasks x SET status_id = $3,
				position = (SELECT COALESCE(MAX(position), 0) FROM tasks WHERE workspace_id = $1 AND status_id = $3) + r.rn * 1024,
				updated_at = now()
				FROM (SELECT id, row_number() OVER (ORDER BY position, created_at) AS rn FROM tasks
				      WHERE workspace_id = $1 AND status_id = $2) r
				WHERE x.workspace_id = $1 AND x.id = r.id`, s.WorkspaceID, st.ID, target.ID); err != nil {
				return err
			}
			if err := syncCompleted(ctx, tx, s.WorkspaceID, "status_id = $2", target.ID, target.Category); err != nil {
				return err
			}
			changes["moved_to"] = target.Name
			changes["tasks_moved"] = st.TaskCount
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_statuses WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, st.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "status.deleted", SubjectType: "status", SubjectID: st.ID, Changes: changes})
	})
}
