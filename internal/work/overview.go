package work

import (
	"context"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
)

// AttentionTask is a task the home dashboard flags: open and either past its due date or
// high/urgent priority.
type AttentionTask struct {
	ID           string     `json:"id"`
	Key          string     `json:"key"`
	Title        string     `json:"title"`
	ProjectID    string     `json:"project_id"`
	ProjectName  string     `json:"project_name"`
	ProjectColor string     `json:"project_color"`
	Priority     string     `json:"priority"`
	DueAt        *time.Time `json:"due_at"`
	Overdue      bool       `json:"overdue"`
}

// Overview is the body of GET /api/w/overview: the aggregates the home dashboard needs that no
// list endpoint yields cheaply. Everything respects project visibility like ListTasks does.
type Overview struct {
	CompletedTotal int                 `json:"completed_total" doc:"Tasks completed, in non-archived projects I can see"`
	CompletedWeek  int                 `json:"completed_week" doc:"Of those, completed in the last 7 days"`
	Overdue        int                 `json:"overdue" doc:"Open tasks past their due date"`
	Attention      []AttentionTask     `json:"attention" doc:"Overdue first, then high and urgent open tasks (at most 6)"`
	ProjectMembers map[string][]string `json:"project_members" doc:"Direct member user ids per visible project (at most 5 each)"`
}

const overviewMembersPerProject = 5

// Overview computes the home dashboard aggregates for the caller.
func (sv *Service) Overview(ctx context.Context) (*Overview, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TasksRead); err != nil {
		return nil, err
	}
	out := &Overview{Attention: []AttentionTask{}, ProjectMembers: map[string][]string{}}

	args := []any{s.WorkspaceID}
	tc := taskClause(s, &args)
	from := ` FROM tasks t JOIN projects p ON p.workspace_id = t.workspace_id AND p.id = t.project_id
		WHERE t.workspace_id = $1 AND p.archived_at IS NULL AND ` + tc
	if err := sv.DB.QueryRowContext(ctx, `SELECT
		count(*) FILTER (WHERE t.completed_at IS NOT NULL),
		count(*) FILTER (WHERE t.completed_at >= now() - interval '7 days'),
		count(*) FILTER (WHERE t.completed_at IS NULL AND t.due_at < now())`+from, args...).
		Scan(&out.CompletedTotal, &out.CompletedWeek, &out.Overdue); err != nil {
		return nil, err
	}

	rows, err := sv.DB.QueryContext(ctx, `SELECT t.id, t.key, t.title, p.id, p.name, p.color, t.priority, t.due_at,
		(t.due_at IS NOT NULL AND t.due_at < now())`+from+`
		AND t.completed_at IS NULL AND ((t.due_at IS NOT NULL AND t.due_at < now()) OR t.priority IN ('urgent','high'))
		ORDER BY (t.due_at IS NOT NULL AND t.due_at < now()) DESC,
			CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.due_at NULLS LAST, t.created_at
		LIMIT 6`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a AttentionTask
		if err := rows.Scan(&a.ID, &a.Key, &a.Title, &a.ProjectID, &a.ProjectName, &a.ProjectColor, &a.Priority, &a.DueAt, &a.Overdue); err != nil {
			return nil, err
		}
		out.Attention = append(out.Attention, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	pargs := []any{s.WorkspaceID}
	vc := visibleClause(s, &pargs)
	mrows, err := sv.DB.QueryContext(ctx, `SELECT pm.project_id, pm.user_id FROM project_members pm
		JOIN projects p ON p.workspace_id = pm.workspace_id AND p.id = pm.project_id
		WHERE pm.workspace_id = $1 AND p.archived_at IS NULL AND `+vc+` ORDER BY pm.project_id, pm.role, pm.user_id`, pargs...)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var pid, uid string
		if err := mrows.Scan(&pid, &uid); err != nil {
			return nil, err
		}
		if len(out.ProjectMembers[pid]) < overviewMembersPerProject {
			out.ProjectMembers[pid] = append(out.ProjectMembers[pid], uid)
		}
	}
	return out, mrows.Err()
}
