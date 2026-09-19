package work

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
The activity feed. Mahaam writes its own entries rather than using togo's audit plugin:
that plugin takes the causer from the X-User-Id header, which any client can set, has no
tenant column, and writes through the pool outside any transaction. Here the actor is the
tenant.Scope of the request (session user, or the user an MCP token acts for, with the token
id recorded), and the entry is inserted on the same transaction as the change it describes.
*/

type entry struct {
	ProjectID, TaskID              string
	Action, SubjectType, SubjectID string
	Changes                        map[string]any
}

func record(ctx context.Context, q querier, s *tenant.Scope, e entry) error {
	if e.Changes == nil {
		e.Changes = map[string]any{}
	}
	if s.Via == "mcp" && s.TokenID != "" {
		e.Changes["mcp_token_id"] = s.TokenID
	}
	body, err := json.Marshal(e.Changes)
	if err != nil {
		return err
	}
	via := s.Via
	switch via {
	case "session", "mcp", "system":
	default:
		via = "session"
	}
	m := MetaFrom(ctx)
	_, err = q.ExecContext(ctx, `
		INSERT INTO activity_logs (workspace_id, project_id, task_id, actor_id, actor_via, action,
		                           subject_type, subject_id, changes, ip, user_agent)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5, $6, $7, $8, $9, $10, $11)`,
		s.WorkspaceID, e.ProjectID, e.TaskID, s.UserID, via, e.Action,
		e.SubjectType, e.SubjectID, string(body), m.IP, truncate(m.UserAgent, 400))
	if err != nil {
		return fmt.Errorf("activity: %w", err)
	}
	if err := fanout(ctx, q, s, e); err != nil {
		return fmt.Errorf("notifications: %w", err)
	}
	return nil
}

// Activity is one feed entry.
type Activity struct {
	ID          string         `json:"id"`
	ProjectID   *string        `json:"project_id"`
	TaskID      *string        `json:"task_id"`
	ActorID     string         `json:"actor_id"`
	Via         string         `json:"via" doc:"session, mcp or system"`
	Action      string         `json:"action"`
	SubjectType string         `json:"subject_type"`
	SubjectID   string         `json:"subject_id"`
	Changes     map[string]any `json:"changes"`
	CreatedAt   time.Time      `json:"created_at"`
}

func (sv *Service) listActivity(ctx context.Context, s *tenant.Scope, where string, args []any, limit int) ([]Activity, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	all := append([]any{s.WorkspaceID}, args...)
	all = append(all, limit)
	rows, err := sv.DB.QueryContext(ctx, `
		SELECT id, project_id, task_id, actor_id, actor_via, action, subject_type, subject_id, changes, created_at
		FROM activity_logs WHERE workspace_id = $1 `+where+`
		ORDER BY created_at DESC, id DESC LIMIT $`+fmt.Sprint(len(all)), all...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var a Activity
		var raw string
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.TaskID, &a.ActorID, &a.Via, &a.Action, &a.SubjectType, &a.SubjectID, &raw, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Changes = map[string]any{}
		_ = json.Unmarshal([]byte(raw), &a.Changes)
		delete(a.Changes, "mcp_token_id") // provenance for the audit, not for the feed
		out = append(out, a)
	}
	return out, rows.Err()
}

// WorkspaceActivity is the workspace-wide feed (managers and up).
func (sv *Service) WorkspaceActivity(ctx context.Context, limit int) ([]Activity, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ActivityRead); err != nil {
		return nil, err
	}
	return sv.listActivity(ctx, s, "", nil, limit)
}

// ProjectActivity is one project's feed, including its tasks' entries.
func (sv *Service) ProjectActivity(ctx context.Context, projectID string, limit int) ([]Activity, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, projectID)
	if err != nil {
		return nil, err
	}
	return sv.listActivity(ctx, s, "AND project_id = $2", []any{p.ID}, limit)
}

// TaskActivity is one task's feed.
func (sv *Service) TaskActivity(ctx context.Context, ref string, limit int) ([]Activity, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return nil, err
	}
	return sv.listActivity(ctx, s, "AND task_id = $2", []any{t.ID}, limit)
}

// FormatActivity renders entries compactly for a model.
func FormatActivity(list []Activity, who func(string) string) string {
	if len(list) == 0 {
		return "No activity yet."
	}
	var b strings.Builder
	for _, a := range list {
		via := ""
		if a.Via == "mcp" {
			via = " (via MCP)"
		}
		ch, _ := json.Marshal(a.Changes)
		fmt.Fprintf(&b, "%s  %s%s  %s  %s\n", a.CreatedAt.UTC().Format("2006-01-02 15:04"), who(a.ActorID), via, a.Action, ch)
	}
	return b.String()
}
