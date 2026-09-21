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

// Task is a task as shown on the board and in lists.
type Task struct {
	ID              string     `json:"id"`
	Key             string     `json:"key" doc:"MG-<n>, unique in the workspace"`
	Number          int64      `json:"number"`
	ProjectID       string     `json:"project_id"`
	StatusID        string     `json:"status_id"`
	Title           string     `json:"title"`
	Description     *string    `json:"description"`
	Position        float64    `json:"position"`
	DueAt           *time.Time `json:"due_at"`
	EstimateMinutes *int64     `json:"estimate_minutes"`
	Priority        string     `json:"priority" enum:"none,low,medium,high,urgent" doc:"none, low, medium, high, urgent"`
	ParentID        *string    `json:"parent_id"`
	CreatedBy       string     `json:"created_by"`
	CompletedAt     *time.Time `json:"completed_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	AssigneeIDs     []string   `json:"assignee_ids"`
	LabelIDs        []string   `json:"label_ids"`
	ChecklistDone   int        `json:"checklist_done"`
	ChecklistTotal  int        `json:"checklist_total"`
	CommentCount    int        `json:"comment_count"`
	AttachmentCount int        `json:"attachment_count"`
	SubtaskCount    int        `json:"subtask_count"`
	SubtaskDone     int        `json:"subtask_done"`
	// Issue is set when the card is an issue (SDK, portal, MCP, in-app or imported report): the
	// same item as /issues/{key}, kept in step by the database (post/19g_issues_on_board.sql).
	Issue *TaskIssue `json:"issue,omitempty"`
}

// TaskIssue is what a card that is an issue carries beyond a task.
type TaskIssue struct {
	FromBoard    bool    `json:"from_board" doc:"The issue only mirrors this card (made on the board); false = a real issue from the SDK, portal, MCP or an import"`
	Type         string  `json:"type" doc:"bug, feature, task, story or epic"`
	Source       string  `json:"source" doc:"app, embed (feedback SDK), portal, mcp, github, jira, linear"`
	Screenshot   bool    `json:"screenshot" doc:"A screenshot is attached"`
	Diagnostics  bool    `json:"diagnostics" doc:"Console or network logs were captured"`
	RequestState *string `json:"request_state" doc:"A customer request's state, if it is one"`
}

const taskCols = `t.id, t.key, t.number, t.project_id, t.status_id, t.title, t.description, t.position, t.due_at,
	t.estimate_minutes, t.priority, t.parent_id, t.created_by, t.completed_at, t.created_at, t.updated_at,
	COALESCE((SELECT string_agg(a.user_id, ',' ORDER BY a.created_at) FROM task_assignees a
	          WHERE a.workspace_id = t.workspace_id AND a.task_id = t.id), ''),
	COALESCE((SELECT string_agg(l.label_id, ',' ORDER BY l.created_at) FROM task_labels l
	          WHERE l.workspace_id = t.workspace_id AND l.task_id = t.id), ''),
	(SELECT count(*) FROM task_checklist_items c WHERE c.workspace_id = t.workspace_id AND c.task_id = t.id AND c.done),
	(SELECT count(*) FROM task_checklist_items c WHERE c.workspace_id = t.workspace_id AND c.task_id = t.id),
	(SELECT count(*) FROM task_comments c WHERE c.workspace_id = t.workspace_id AND c.task_id = t.id),
	(SELECT count(*) FROM attachments f WHERE f.workspace_id = t.workspace_id AND f.task_id = t.id),
	(SELECT count(*) FROM tasks x WHERE x.workspace_id = t.workspace_id AND x.parent_id = t.id),
	(SELECT count(*) FROM tasks x WHERE x.workspace_id = t.workspace_id AND x.parent_id = t.id AND x.completed_at IS NOT NULL),
	ri.issue_type, ri.source, COALESCE(ri.from_board, false), ri.screenshot IS NOT NULL AND ri.screenshot <> '',
	COALESCE(length(ri.console_log), 0) + COALESCE(length(ri.network_log), 0) > 0, ri.request_state`

func scanTask(r scanner) (*Task, error) {
	t := &Task{}
	var assignees, labels string
	var iType, iSource *string
	var iBoard bool
	var iShot, iDiag *bool
	var iReq *string
	err := r.Scan(&t.ID, &t.Key, &t.Number, &t.ProjectID, &t.StatusID, &t.Title, &t.Description, &t.Position, &t.DueAt,
		&t.EstimateMinutes, &t.Priority, &t.ParentID, &t.CreatedBy, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt,
		&assignees, &labels, &t.ChecklistDone, &t.ChecklistTotal, &t.CommentCount, &t.AttachmentCount, &t.SubtaskCount, &t.SubtaskDone,
		&iType, &iSource, &iBoard, &iShot, &iDiag, &iReq)
	if iType != nil {
		t.Issue = &TaskIssue{Type: *iType, RequestState: iReq, FromBoard: iBoard}
		if iSource != nil {
			t.Issue.Source = *iSource
		}
		t.Issue.Screenshot = iShot != nil && *iShot
		t.Issue.Diagnostics = iDiag != nil && *iDiag
	}
	t.AssigneeIDs, t.LabelIDs = splitIDs(assignees), splitIDs(labels)
	return t, err
}

// loadTask resolves MG-12 / 12 / id to a task in a project the caller can see, or 404.
func loadTask(ctx context.Context, q querier, s *tenant.Scope, ref string) (*Task, error) {
	id, number := parseRef(ref)
	if id == "" && number == 0 {
		return nil, notFound("task")
	}
	args := []any{s.WorkspaceID, id, number}
	clause := taskClause(s, &args)
	t, err := scanTask(q.QueryRowContext(ctx, `SELECT `+taskCols+` FROM tasks t
		LEFT JOIN reports ri ON ri.workspace_id = t.workspace_id AND ri.task_id = t.id
		JOIN projects p ON p.workspace_id = t.workspace_id AND p.id = t.project_id
		WHERE t.workspace_id = $1 AND ((t.id = $2 AND $2 <> '') OR t.number = $3) AND `+clause, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("task")
	}
	return t, err
}

// Board is a project's columns and every task in them, in board order.
type Board struct {
	Statuses []Status `json:"statuses"`
	Tasks    []Task   `json:"tasks"`
}

// TaskFilter narrows ListTasks. Every field is optional.
type TaskFilter struct {
	ProjectID  string // "" = every project the caller can see
	StatusID   string
	Category   string // todo | doing | done
	AssigneeID string
	LabelID    string
	Q          string
	Limit      int
}

// ListTasks lists tasks in board order (status position, then task position).
func (sv *Service) ListTasks(ctx context.Context, f TaskFilter) ([]Task, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TasksRead); err != nil {
		return nil, err
	}
	args := []any{s.WorkspaceID}
	where := "t.workspace_id = $1 AND " + taskClause(s, &args)
	add := func(cond string, v any) {
		args = append(args, v)
		where += fmt.Sprintf(" AND "+cond, len(args))
	}
	if f.ProjectID != "" {
		add("t.project_id = $%d", f.ProjectID)
	} else {
		where += " AND p.archived_at IS NULL"
	}
	if f.StatusID != "" {
		add("t.status_id = $%d", f.StatusID)
	}
	if f.Category != "" {
		add("st.category = $%d", f.Category)
	}
	if f.AssigneeID != "" {
		add("EXISTS (SELECT 1 FROM task_assignees a WHERE a.workspace_id = t.workspace_id AND a.task_id = t.id AND a.user_id = $%d)", f.AssigneeID)
	}
	if f.LabelID != "" {
		add("EXISTS (SELECT 1 FROM task_labels l WHERE l.workspace_id = t.workspace_id AND l.task_id = t.id AND l.label_id = $%d)", f.LabelID)
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		add("(t.title ILIKE $%d OR t.key ILIKE $%[1]d)", "%"+q+"%")
	}
	limit := f.Limit
	if limit <= 0 || limit > 2000 {
		limit = 2000
	}
	args = append(args, limit)
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+taskCols+` FROM tasks t
		LEFT JOIN reports ri ON ri.workspace_id = t.workspace_id AND ri.task_id = t.id
		JOIN projects p ON p.workspace_id = t.workspace_id AND p.id = t.project_id
		JOIN task_statuses st ON st.workspace_id = t.workspace_id AND st.id = t.status_id
		WHERE `+where+` ORDER BY p.name, st.position, t.position, t.created_at LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// ProjectBoard returns a project's statuses and all its tasks.
func (sv *Service) ProjectBoard(ctx context.Context, projectID string) (*Board, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, projectID)
	if err != nil {
		return nil, err
	}
	b := &Board{}
	if b.Statuses, err = listStatuses(ctx, sv.DB, s.WorkspaceID, p.ID); err != nil {
		return nil, err
	}
	if b.Tasks, err = sv.ListTasks(ctx, TaskFilter{ProjectID: p.ID}); err != nil {
		return nil, err
	}
	return b, nil
}

// TaskBrief names a related task.
type TaskBrief struct {
	ID       string `json:"id"`
	Key      string `json:"key"`
	Title    string `json:"title"`
	StatusID string `json:"status_id"`
	Done     bool   `json:"done"`
}

// ChecklistItem is one line of a task's checklist.
type ChecklistItem struct {
	ID       string     `json:"id"`
	Title    string     `json:"title"`
	Done     bool       `json:"done"`
	Position float64    `json:"position"`
	DoneAt   *time.Time `json:"done_at"`
	DoneBy   *string    `json:"done_by"`
}

// TaskProject is the project a task belongs to.
type TaskProject struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Archived bool   `json:"archived"`
}

// TaskDetail is a task with everything the side-over shows.
type TaskDetail struct {
	Task
	Project   TaskProject     `json:"project"`
	Status    Status          `json:"status"`
	Parent    *TaskBrief      `json:"parent"`
	Subtasks  []TaskBrief     `json:"subtasks"`
	Checklist []ChecklistItem `json:"checklist"`
	CanWrite  bool            `json:"can_write"`
	CanDelete bool            `json:"can_delete"`
}

func briefs(ctx context.Context, q querier, ws, where string, arg string) ([]TaskBrief, error) {
	rows, err := q.QueryContext(ctx, `SELECT t.id, t.key, t.title, t.status_id, t.completed_at IS NOT NULL FROM tasks t
		WHERE t.workspace_id = $1 AND `+where+` ORDER BY t.number`, ws, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TaskBrief{}
	for rows.Next() {
		var b TaskBrief
		if err := rows.Scan(&b.ID, &b.Key, &b.Title, &b.StatusID, &b.Done); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func checklist(ctx context.Context, q querier, ws, taskID string) ([]ChecklistItem, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, title, done, position, done_at, done_by FROM task_checklist_items
		WHERE workspace_id = $1 AND task_id = $2 ORDER BY position, created_at`, ws, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChecklistItem{}
	for rows.Next() {
		var c ChecklistItem
		if err := rows.Scan(&c.ID, &c.Title, &c.Done, &c.Position, &c.DoneAt, &c.DoneBy); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetTask returns one task in full. ref is MG-12, 12 or the id.
func (sv *Service) GetTask(ctx context.Context, ref string) (*TaskDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TasksRead); err != nil {
		return nil, err
	}
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, t.ProjectID)
	if err != nil {
		return nil, err
	}
	d := &TaskDetail{Task: *t, Project: TaskProject{ID: p.ID, Name: p.Name, Color: p.Color, Archived: p.ArchivedAt != nil}}
	st, err := scanStatus(sv.DB.QueryRowContext(ctx, `SELECT `+statusCols+` FROM task_statuses st WHERE st.workspace_id = $1 AND st.id = $2`, s.WorkspaceID, t.StatusID))
	if err != nil {
		return nil, err
	}
	d.Status = *st
	if t.ParentID != nil {
		ps, err := briefs(ctx, sv.DB, s.WorkspaceID, "t.id = $2", *t.ParentID)
		if err != nil {
			return nil, err
		}
		if len(ps) == 1 {
			d.Parent = &ps[0]
		}
	}
	if d.Subtasks, err = briefs(ctx, sv.DB, s.WorkspaceID, "t.parent_id = $2", t.ID); err != nil {
		return nil, err
	}
	if d.Checklist, err = checklist(ctx, sv.DB, s.WorkspaceID, t.ID); err != nil {
		return nil, err
	}
	d.CanWrite = requireWritable(s, p) == nil
	d.CanDelete = d.CanWrite && (t.CreatedBy == s.UserID || canManage(ctx, sv.DB, s, p.ID))
	return d, nil
}

// ---- create / update / move / delete ------------------------------------------------------

// TaskInput creates a task (Title required) or patches one. On a patch an omitted field is
// unchanged; "" clears description, due_at and parent_id; 0 clears estimate_minutes.
type TaskInput struct {
	Title           *string   `json:"title,omitempty" maxLength:"300"`
	Description     *string   `json:"description,omitempty" maxLength:"20000"`
	Status          *string   `json:"status,omitempty" doc:"Status id or name in the task's project"`
	Priority        *string   `json:"priority,omitempty" enum:"none,low,medium,high,urgent"`
	DueAt           *string   `json:"due_at,omitempty" doc:"YYYY-MM-DD or RFC 3339; empty clears"`
	EstimateMinutes *int64    `json:"estimate_minutes,omitempty" minimum:"0" doc:"0 clears"`
	Parent          *string   `json:"parent,omitempty" doc:"Parent task (MG-12 or id), same project, one level; empty clears"`
	AssigneeIDs     *[]string `json:"assignee_ids,omitempty" doc:"Create only; use the assignees endpoint afterwards"`
	LabelIDs        *[]string `json:"label_ids,omitempty" doc:"Create only; use the labels endpoint afterwards"`
}

func taskValues(ctx context.Context, q querier, s *tenant.Scope, projectID string, self string, in TaskInput, p *patch) error {
	if v, ok := trimmed(in.Title); ok {
		if v == "" {
			return invalid("a task needs a title")
		}
		p.set("title", v)
	}
	if in.Description != nil {
		p.set("description", nullIfEmpty(strings.TrimRight(*in.Description, " \n\t")))
	}
	if v, ok := trimmed(in.Priority); ok {
		if err := oneOf("priority", v, "none", "low", "medium", "high", "urgent"); err != nil {
			return err
		}
		p.set("priority", v)
	}
	if v, ok := trimmed(in.DueAt); ok {
		t, err := parseWhen(v)
		if err != nil {
			return err
		}
		if t == nil {
			p.set("due_at", nil)
		} else {
			p.set("due_at", *t)
		}
	}
	if in.EstimateMinutes != nil {
		switch {
		case *in.EstimateMinutes < 0:
			return invalid("estimate_minutes cannot be negative")
		case *in.EstimateMinutes == 0:
			p.set("estimate_minutes", nil)
		default:
			p.set("estimate_minutes", *in.EstimateMinutes)
		}
	}
	if v, ok := trimmed(in.Parent); ok {
		if v == "" {
			p.set("parent_id", nil)
		} else {
			parent, err := loadTask(ctx, q, s, v)
			if err != nil {
				return invalid("parent task %q not found", v)
			}
			switch {
			case parent.ProjectID != projectID:
				return invalid("a subtask must be in the same project as its parent")
			case parent.ParentID != nil:
				return invalid("%s is itself a subtask — subtasks are one level deep", parent.Key)
			case parent.ID == self:
				return invalid("a task cannot be its own parent")
			}
			if self != "" {
				var kids int
				_ = q.QueryRowContext(ctx, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND parent_id = $2`, s.WorkspaceID, self).Scan(&kids)
				if kids > 0 {
					return invalid("this task has subtasks, so it cannot become a subtask")
				}
			}
			p.set("parent_id", parent.ID)
		}
	}
	return nil
}

// assignable checks that every id is an active member who can see the project.
func assignable(ctx context.Context, q querier, ws, projectID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	rows, err := q.QueryContext(ctx, `SELECT user_id, role FROM workspace_members WHERE workspace_id = $1 AND status = 'active'
		AND user_id = ANY(string_to_array($2, ','))`, ws, strings.Join(ids, ","))
	if err != nil {
		return err
	}
	roles := map[string]string{}
	for rows.Next() {
		var id, role string
		if err := rows.Scan(&id, &role); err != nil {
			rows.Close()
			return err
		}
		roles[id] = role
	}
	rows.Close()
	for _, id := range ids {
		role, ok := roles[id]
		if !ok {
			return invalid("%s is not an active member of this workspace", id)
		}
		sc := &tenant.Scope{WorkspaceID: ws, UserID: id, Role: role}
		args := []any{ws, projectID}
		clause := visibleClause(sc, &args)
		var one int
		err := q.QueryRowContext(ctx, `SELECT 1 FROM projects p WHERE p.workspace_id = $1 AND p.id = $2 AND `+clause, args...).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			return invalid("%s cannot see this project — add them to it first", id)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func knownLabels(ctx context.Context, q querier, ws string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	var n int
	if err := q.QueryRowContext(ctx, `SELECT count(*) FROM labels WHERE workspace_id = $1 AND id = ANY(string_to_array($2, ','))`,
		ws, strings.Join(ids, ",")).Scan(&n); err != nil {
		return err
	}
	if n != len(ids) {
		return invalid("unknown label")
	}
	return nil
}

// columnEnd is the position after the last task of a status.
func columnEnd(ctx context.Context, q querier, ws, statusID string) (float64, error) {
	var pos float64
	err := q.QueryRowContext(ctx, `SELECT COALESCE(MAX(position), 0) + 1024 FROM tasks WHERE workspace_id = $1 AND status_id = $2`, ws, statusID).Scan(&pos)
	return pos, err
}

// CreateTask adds a task to a project. Without a status it lands in the first "todo" column.
func (sv *Service) CreateTask(ctx context.Context, projectID string, in TaskInput) (*TaskDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, projectID)
	if err != nil {
		return nil, err
	}
	if err := requireWritable(s, p); err != nil {
		return nil, err
	}
	// Someone who sees the project only through task grants cannot add tasks to it.
	if !hasFullAccess(ctx, sv.DB, s, p.ID) {
		return nil, forbidden("you only have access to specific tasks in this project")
	}
	if v, _ := trimmed(in.Title); v == "" {
		return nil, invalid("a task needs a title")
	}
	pt := newPatch()
	if err := quota(ctx, s, limits.Tasks, 1); err != nil {
		return nil, err
	}
	if err := quota(ctx, s, limits.TasksMonth, 1); err != nil {
		return nil, err
	}
	if err := taskValues(ctx, sv.DB, s, p.ID, "", in, pt); err != nil {
		return nil, err
	}
	var st *Status
	if v, ok := trimmed(in.Status); ok && v != "" {
		if st, err = resolveStatus(ctx, sv.DB, s.WorkspaceID, p.ID, v); err != nil {
			return nil, err
		}
	} else {
		list, err := listStatuses(ctx, sv.DB, s.WorkspaceID, p.ID)
		if err != nil {
			return nil, err
		}
		if len(list) == 0 {
			return nil, invalid("the project has no statuses")
		}
		st = &list[0]
		for i := range list {
			if list[i].Category == "todo" {
				st = &list[i]
				break
			}
		}
	}
	var assignees, labels []string
	if in.AssigneeIDs != nil {
		assignees = dedupe(*in.AssigneeIDs)
	}
	if in.LabelIDs != nil {
		labels = dedupe(*in.LabelIDs)
	}
	if err := assignable(ctx, sv.DB, s.WorkspaceID, p.ID, assignees); err != nil {
		return nil, err
	}
	if err := knownLabels(ctx, sv.DB, s.WorkspaceID, labels); err != nil {
		return nil, err
	}
	var key string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		n, err := NextNumber(ctx, tx, s.WorkspaceID)
		if err != nil {
			return err
		}
		key = fmt.Sprintf("%s%d", KeyPrefix, n)
		pos, err := columnEnd(ctx, tx, s.WorkspaceID, st.ID)
		if err != nil {
			return err
		}
		pt.set("project_id", p.ID)
		pt.set("status_id", st.ID)
		pt.set("number", n)
		pt.set("key", key)
		pt.set("position", pos)
		pt.set("created_by", s.UserID)
		if st.Category == "done" {
			pt.set("completed_at", time.Now().UTC())
		}
		cols, marks, args := pt.insert(s.WorkspaceID)
		var id string
		if err := tx.QueryRowContext(ctx, `INSERT INTO tasks (`+cols+`) VALUES (`+marks+`) RETURNING id`, args...).Scan(&id); err != nil {
			return err
		}
		for _, u := range assignees {
			if _, err := tx.ExecContext(ctx, `INSERT INTO task_assignees (workspace_id, task_id, user_id) VALUES ($1, $2, $3)`, s.WorkspaceID, id, u); err != nil {
				return err
			}
		}
		for _, l := range labels {
			if _, err := tx.ExecContext(ctx, `INSERT INTO task_labels (workspace_id, task_id, label_id) VALUES ($1, $2, $3)`, s.WorkspaceID, id, l); err != nil {
				return err
			}
		}
		changes := map[string]any{"key": key, "title": pt.changes["title"], "status": st.Name}
		if len(assignees) > 0 {
			changes["assignees"] = assignees
		}
		if v, ok := pt.changes["parent_id"]; ok && v != nil {
			changes["parent_id"] = v
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: id, Action: "task.created", SubjectType: "task", SubjectID: id, Changes: changes})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetTask(ctx, key)
}

// UpdateTask patches a task. Changing its status moves it to the end of that column.
func (sv *Service) UpdateTask(ctx context.Context, ref string, in TaskInput) (*TaskDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, t.ProjectID)
	if err != nil {
		return nil, err
	}
	if err := requireWritable(s, p); err != nil {
		return nil, err
	}
	if in.AssigneeIDs != nil || in.LabelIDs != nil {
		return nil, invalid("change assignees and labels with their own endpoints")
	}
	pt := newPatch()
	if err := taskValues(ctx, sv.DB, s, p.ID, t.ID, in, pt); err != nil {
		return nil, err
	}
	var st *Status
	if v, ok := trimmed(in.Status); ok && v != "" {
		if st, err = resolveStatus(ctx, sv.DB, s.WorkspaceID, p.ID, v); err != nil {
			return nil, err
		}
		if st.ID == t.StatusID {
			st = nil
		}
	}
	if pt.empty() && st == nil {
		return sv.GetTask(ctx, t.ID)
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		changes := map[string]any{}
		for k, v := range pt.changes {
			if k == "description" {
				v = v != nil // the feed says "description changed", not the text
			}
			changes[k] = v
		}
		if st != nil {
			pos, err := columnEnd(ctx, tx, s.WorkspaceID, st.ID)
			if err != nil {
				return err
			}
			pt.set("status_id", st.ID)
			pt.set("position", pos)
			changes["status"] = st.Name
			var fromCat string
			_ = tx.QueryRowContext(ctx, `SELECT category FROM task_statuses WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, t.StatusID).Scan(&fromCat)
			if st.Category == "done" && fromCat != "done" {
				changes["done"] = true // notify.go: task.done
			}
		}
		if err := pt.update(ctx, tx, "tasks", s.WorkspaceID, t.ID); err != nil {
			return err
		}
		if st != nil {
			if err := syncCompleted(ctx, tx, s.WorkspaceID, "id = $2", t.ID, st.Category); err != nil {
				return err
			}
		}
		changes["key"], changes["title"] = t.Key, firstString(changes["title"], t.Title)
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "task.updated", SubjectType: "task", SubjectID: t.ID, Changes: changes})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetTask(ctx, t.ID)
}

// MoveTask puts a task into a status column at a 0-based index (nil = the end), giving it a
// fractional position between its new neighbours. When the gap between two neighbours is
// exhausted the column is renumbered in the same transaction.
func (sv *Service) MoveTask(ctx context.Context, ref, statusRef string, index *int) (*TaskDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, t.ProjectID)
	if err != nil {
		return nil, err
	}
	if err := requireWritable(s, p); err != nil {
		return nil, err
	}
	statusRef = strings.TrimSpace(statusRef)
	if statusRef == "" {
		statusRef = t.StatusID
	}
	st, err := resolveStatus(ctx, sv.DB, s.WorkspaceID, p.ID, statusRef)
	if err != nil {
		return nil, err
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		// Lock the column's rows so two concurrent moves into it serialise.
		rows, err := tx.QueryContext(ctx, `SELECT position FROM tasks WHERE workspace_id = $1 AND status_id = $2 AND id <> $3
			ORDER BY position, created_at FOR UPDATE`, s.WorkspaceID, st.ID, t.ID)
		if err != nil {
			return err
		}
		var pos []float64
		for rows.Next() {
			var f float64
			if err := rows.Scan(&f); err != nil {
				rows.Close()
				return err
			}
			pos = append(pos, f)
		}
		rows.Close()
		at := len(pos)
		if index != nil {
			at = *index
		}
		next, ok := between(pos, at)
		if !ok {
			if _, err := tx.ExecContext(ctx, `UPDATE tasks x SET position = r.rn * 1024
				FROM (SELECT id, row_number() OVER (ORDER BY position, created_at) AS rn FROM tasks
				      WHERE workspace_id = $1 AND status_id = $2 AND id <> $3) r
				WHERE x.workspace_id = $1 AND x.id = r.id`, s.WorkspaceID, st.ID, t.ID); err != nil {
				return err
			}
			for i := range pos {
				pos[i] = float64(i+1) * 1024
			}
			next, _ = between(pos, at)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE tasks SET status_id = $3, position = $4, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, t.ID, st.ID, next); err != nil {
			return err
		}
		if err := syncCompleted(ctx, tx, s.WorkspaceID, "id = $2", t.ID, st.Category); err != nil {
			return err
		}
		if st.ID == t.StatusID {
			return nil // a reorder inside one column is not worth a feed entry
		}
		var from, fromCat string
		_ = tx.QueryRowContext(ctx, `SELECT name, category FROM task_statuses WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, t.StatusID).Scan(&from, &fromCat)
		changes := map[string]any{"key": t.Key, "title": t.Title, "from": from, "to": st.Name}
		if st.Category == "done" && fromCat != "done" {
			changes["done"] = true // notify.go: task.done
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "task.moved", SubjectType: "task", SubjectID: t.ID, Changes: changes})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetTask(ctx, t.ID)
}

// DeleteTask removes a task (its creator, a manager or the project lead). Subtasks are kept
// and detached; checklist, comments and attachments go with it.
func (sv *Service) DeleteTask(ctx context.Context, ref string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return err
	}
	p, err := loadProject(ctx, sv.DB, s, t.ProjectID)
	if err != nil {
		return err
	}
	if err := requireWritable(s, p); err != nil {
		return err
	}
	if t.CreatedBy != s.UserID && !canManage(ctx, sv.DB, s, p.ID) {
		return forbidden("only the task's creator, a manager or the project lead can delete it")
	}
	var paths []string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT storage_path FROM attachments WHERE workspace_id = $1 AND task_id = $2`, s.WorkspaceID, t.ID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var path string
			if err := rows.Scan(&path); err != nil {
				rows.Close()
				return err
			}
			paths = append(paths, path)
		}
		rows.Close()
		if _, err := tx.ExecContext(ctx, `DELETE FROM tasks WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, t.ID); err != nil {
			return err
		}
		// task_id is kept on the entry even though the row is gone, so the task's history
		// still reads; the feed shows the key and title from changes.
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "task.deleted", SubjectType: "task", SubjectID: t.ID,
			Changes: map[string]any{"key": t.Key, "title": t.Title}})
	})
	if err != nil {
		return err
	}
	sv.removeFiles(paths)
	return nil
}

// SetAssignees replaces a task's assignees.
func (sv *Service) SetAssignees(ctx context.Context, ref string, userIDs []string) (*TaskDetail, error) {
	return sv.setLinks(ctx, ref, dedupe(userIDs), "task_assignees", "user_id", "task.assigned")
}

// SetLabels replaces a task's labels.
func (sv *Service) SetLabels(ctx context.Context, ref string, labelIDs []string) (*TaskDetail, error) {
	return sv.setLinks(ctx, ref, dedupe(labelIDs), "task_labels", "label_id", "task.labeled")
}

// setLinks diffs and rewrites one of the task's link tables (table/col are constants from
// the two callers above, never input).
func (sv *Service) setLinks(ctx context.Context, ref string, ids []string, table, col, action string) (*TaskDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, t.ProjectID)
	if err != nil {
		return nil, err
	}
	if err := requireWritable(s, p); err != nil {
		return nil, err
	}
	have := t.AssigneeIDs
	if table == "task_labels" {
		have = t.LabelIDs
		if err := knownLabels(ctx, sv.DB, s.WorkspaceID, ids); err != nil {
			return nil, err
		}
	} else if err := assignable(ctx, sv.DB, s.WorkspaceID, p.ID, ids); err != nil {
		return nil, err
	}
	want, had := map[string]bool{}, map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var added, removed []string
	for _, id := range have {
		had[id] = true
		if !want[id] {
			removed = append(removed, id)
		}
	}
	for _, id := range ids {
		if !had[id] {
			added = append(added, id)
		}
	}
	if len(added) == 0 && len(removed) == 0 {
		return sv.GetTask(ctx, t.ID)
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		for _, id := range added {
			if _, err := tx.ExecContext(ctx, `INSERT INTO `+table+` (workspace_id, task_id, `+col+`) VALUES ($1, $2, $3)
				ON CONFLICT DO NOTHING`, s.WorkspaceID, t.ID, id); err != nil {
				return err
			}
		}
		if len(removed) > 0 {
			if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE workspace_id = $1 AND task_id = $2
				AND `+col+` = ANY(string_to_array($3, ','))`, s.WorkspaceID, t.ID, strings.Join(removed, ",")); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE tasks SET updated_at = now() WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, t.ID); err != nil {
			return err
		}
		changes := map[string]any{"key": t.Key, "title": t.Title}
		if len(added) > 0 {
			changes["added"] = added
		}
		if len(removed) > 0 {
			changes["removed"] = removed
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: action, SubjectType: "task", SubjectID: t.ID, Changes: changes})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetTask(ctx, t.ID)
}

// ---- checklist ----------------------------------------------------------------------------

// AddChecklistItem appends a line to a task's checklist.
func (sv *Service) AddChecklistItem(ctx context.Context, ref, title string) (*ChecklistItem, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, p, err := sv.writableTask(ctx, s, ref)
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, invalid("a checklist item needs a title")
	}
	if len(title) > 500 {
		return nil, invalid("a checklist item is at most 500 characters")
	}
	c := &ChecklistItem{Title: title}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO task_checklist_items (workspace_id, task_id, title, position)
			VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), 0) + 1024 FROM task_checklist_items WHERE workspace_id = $1 AND task_id = $2))
			RETURNING id, position`, s.WorkspaceID, t.ID, title).Scan(&c.ID, &c.Position); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "checklist.added", SubjectType: "checklist_item", SubjectID: c.ID,
			Changes: map[string]any{"key": t.Key, "item": title}})
	})
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (sv *Service) writableTask(ctx context.Context, s *tenant.Scope, ref string) (*Task, *Project, error) {
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return nil, nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, t.ProjectID)
	if err != nil {
		return nil, nil, err
	}
	if err := requireWritable(s, p); err != nil {
		return nil, nil, err
	}
	return t, p, nil
}

func (sv *Service) checklistItem(ctx context.Context, s *tenant.Scope, id string) (*ChecklistItem, *Task, *Project, error) {
	var taskID string
	c := &ChecklistItem{}
	err := sv.DB.QueryRowContext(ctx, `SELECT id, task_id, title, done, position, done_at, done_by FROM task_checklist_items
		WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, strings.TrimSpace(id)).Scan(&c.ID, &taskID, &c.Title, &c.Done, &c.Position, &c.DoneAt, &c.DoneBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil, notFound("checklist item")
	}
	if err != nil {
		return nil, nil, nil, err
	}
	t, p, err := sv.writableTask(ctx, s, taskID)
	if err != nil {
		if e, ok := AsError(err); ok && e.Status == 404 {
			return nil, nil, nil, notFound("checklist item")
		}
		return nil, nil, nil, err
	}
	return c, t, p, nil
}

// UpdateChecklistItem renames or ticks a checklist line.
func (sv *Service) UpdateChecklistItem(ctx context.Context, id string, title *string, done *bool) (*ChecklistItem, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	c, t, p, err := sv.checklistItem(ctx, s, id)
	if err != nil {
		return nil, err
	}
	pt := newPatch()
	if v, ok := trimmed(title); ok {
		if v == "" {
			return nil, invalid("a checklist item needs a title")
		}
		pt.set("title", v)
	}
	if done != nil && *done != c.Done {
		pt.set("done", *done)
		if *done {
			pt.set("done_at", time.Now().UTC())
			pt.set("done_by", s.UserID)
		} else {
			pt.set("done_at", nil)
			pt.set("done_by", nil)
		}
	}
	if pt.empty() {
		return c, nil
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := pt.update(ctx, tx, "task_checklist_items", s.WorkspaceID, c.ID); err != nil {
			return err
		}
		action := "checklist.updated"
		if v, ok := pt.changes["done"].(bool); ok {
			action = map[bool]string{true: "checklist.checked", false: "checklist.unchecked"}[v]
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: action, SubjectType: "checklist_item", SubjectID: c.ID,
			Changes: map[string]any{"key": t.Key, "item": firstString(pt.changes["title"], c.Title)}})
	})
	if err != nil {
		return nil, err
	}
	c, _, _, err = sv.checklistItem(ctx, s, c.ID)
	return c, err
}

// DeleteChecklistItem removes a checklist line.
func (sv *Service) DeleteChecklistItem(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	c, t, p, err := sv.checklistItem(ctx, s, id)
	if err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_checklist_items WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, c.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "checklist.removed", SubjectType: "checklist_item", SubjectID: c.ID,
			Changes: map[string]any{"key": t.Key, "item": c.Title}})
	})
}
