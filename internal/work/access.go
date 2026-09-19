package work

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
Access beyond a project's own members: project labels and grants.

Roles are the workspace roles, shown as admin (owner/admin), project manager (manager),
employee (member) and customer (client). Managers and up see every project. An employee
sees a project when:

  - it is workspace-visible, or they are on it (project_members), or a team of theirs is
    attached (project_teams) — adding a team adds everyone in it, now and later;
  - they, or a team of theirs, hold a LABEL grant and the project carries that label
    (project_labels) — "everything for Client X", "all retainers";
  - they, or a team of theirs, hold a TASK grant on a task in it, or are assigned one — then
    they see the project but only those tasks, and cannot add tasks to it.

The SQL for all of this is in projects.go (visibleClause, fullAccessSQL, taskClause).
Managing labels on projects and grants is manager+ (authz.AccessManage).
*/

// Grant is one access grant.
type Grant struct {
	ID          string    `json:"id"`
	SubjectType string    `json:"subject_type" doc:"user or team"`
	SubjectID   string    `json:"subject_id"`
	SubjectName string    `json:"subject_name"`
	ScopeType   string    `json:"scope_type" doc:"label or task"`
	ScopeID     string    `json:"scope_id"`
	ScopeName   string    `json:"scope_name" doc:"the label's name, or the task's key and title"`
	CreatedAt   time.Time `json:"created_at"`
}

// GrantInput creates a grant. Subject and scope accept ids; a user also accepts an email,
// a label also its exact name, a task also its key (MG-12).
type GrantInput struct {
	SubjectType string `json:"subject_type" enum:"user,team"`
	Subject     string `json:"subject" doc:"User id or email, or team id or name"`
	ScopeType   string `json:"scope_type" enum:"label,task"`
	Scope       string `json:"scope" doc:"Label id or name, or task key or id"`
}

// GrantFilter narrows ListGrants.
type GrantFilter struct {
	SubjectType, SubjectID, ScopeType, ScopeID string
}

const grantSelect = `SELECT g.id, g.subject_type, g.subject_id,
	COALESCE(CASE g.subject_type WHEN 'team' THEN (SELECT tm.name FROM teams tm WHERE tm.workspace_id = g.workspace_id AND tm.id = g.subject_id)
		ELSE g.subject_id END, ''),
	g.scope_type, g.scope_id,
	COALESCE(CASE g.scope_type WHEN 'label' THEN (SELECT l.name FROM labels l WHERE l.workspace_id = g.workspace_id AND l.id = g.scope_id)
		ELSE (SELECT t.key || ' ' || t.title FROM tasks t WHERE t.workspace_id = g.workspace_id AND t.id = g.scope_id) END, ''),
	g.created_at
	FROM access_grants g`

// ListGrants lists grants (manager+), optionally for one subject or one scope.
func (sv *Service) ListGrants(ctx context.Context, f GrantFilter) ([]Grant, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.AccessManage); err != nil {
		return nil, err
	}
	q := grantSelect + ` WHERE g.workspace_id = $1`
	args := []any{s.WorkspaceID}
	for col, v := range map[string]string{"subject_type": f.SubjectType, "subject_id": f.SubjectID, "scope_type": f.ScopeType, "scope_id": f.ScopeID} {
		if v = strings.TrimSpace(v); v != "" {
			args = append(args, v)
			q += " AND g." + col + " = $" + itoa(len(args))
		}
	}
	rows, err := sv.DB.QueryContext(ctx, q+` ORDER BY g.scope_type, g.created_at`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Grant{}
	for rows.Next() {
		var g Grant
		if err := rows.Scan(&g.ID, &g.SubjectType, &g.SubjectID, &g.SubjectName, &g.ScopeType, &g.ScopeID, &g.ScopeName, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].SubjectType == "user" {
			if e := sv.userEmail(ctx, out[i].SubjectID); e != "" {
				out[i].SubjectName = e
			}
		}
	}
	return out, nil
}

func (sv *Service) resolveSubject(ctx context.Context, ws, typ, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	var id string
	var err error
	switch typ {
	case "user":
		// An email is looked up on the owner pool (the app role has no grant on users).
		uid := ref
		if strings.Contains(ref, "@") {
			if e := sv.Sys.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = lower($1)`, ref).Scan(&uid); e != nil {
				return "", invalid("%q is not an employee of this workspace", ref)
			}
		}
		err = sv.DB.QueryRowContext(ctx, `SELECT wm.user_id FROM workspace_members wm
			WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.status = 'active'
			  AND wm.role IN ('member', 'manager', 'admin', 'owner')`, ws, uid).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return "", invalid("%q is not an employee of this workspace (customers use the client portal)", ref)
		}
	case "team":
		err = sv.DB.QueryRowContext(ctx, `SELECT id FROM teams WHERE workspace_id = $1 AND (id = $2 OR lower(name) = lower($2))
			ORDER BY (id = $2) DESC LIMIT 1`, ws, ref).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return "", notFound("team")
		}
	default:
		return "", invalid("subject_type must be user or team")
	}
	return id, err
}

func (sv *Service) resolveScope(ctx context.Context, ws, typ, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	var id string
	var err error
	switch typ {
	case "label":
		err = sv.DB.QueryRowContext(ctx, `SELECT id FROM labels WHERE workspace_id = $1 AND (id = $2 OR lower(name) = lower($2))
			ORDER BY (id = $2) DESC LIMIT 1`, ws, ref).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return "", notFound("label")
		}
	case "task":
		tid, number := parseRef(ref)
		err = sv.DB.QueryRowContext(ctx, `SELECT id FROM tasks WHERE workspace_id = $1 AND ((id = $2 AND $2 <> '') OR number = $3)`,
			ws, tid, number).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return "", notFound("task")
		}
	default:
		return "", invalid("scope_type must be label or task")
	}
	return id, err
}

// CreateGrant gives a user or team access to a label's projects or to one task (manager+).
// Granting what already exists returns the existing grant.
func (sv *Service) CreateGrant(ctx context.Context, in GrantInput) (*Grant, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.AccessManage); err != nil {
		return nil, err
	}
	subj, err := sv.resolveSubject(ctx, s.WorkspaceID, in.SubjectType, in.Subject)
	if err != nil {
		return nil, err
	}
	scope, err := sv.resolveScope(ctx, s.WorkspaceID, in.ScopeType, in.Scope)
	if err != nil {
		return nil, err
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO access_grants (workspace_id, subject_type, subject_id, scope_type, scope_id, created_by)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (workspace_id, subject_type, subject_id, scope_type, scope_id) DO UPDATE SET subject_id = EXCLUDED.subject_id
			RETURNING id`, s.WorkspaceID, in.SubjectType, subj, in.ScopeType, scope, s.UserID).Scan(&id); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "access.granted", SubjectType: "access_grant", SubjectID: id,
			Changes: map[string]any{"subject": in.SubjectType + ":" + subj, "scope": in.ScopeType + ":" + scope}})
	})
	if err != nil {
		return nil, err
	}
	list, err := sv.ListGrants(ctx, GrantFilter{SubjectType: in.SubjectType, SubjectID: subj, ScopeType: in.ScopeType, ScopeID: scope})
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// DeleteGrant revokes a grant (manager+).
func (sv *Service) DeleteGrant(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.AccessManage); err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM access_grants WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, strings.TrimSpace(id))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return notFound("grant")
		}
		return record(ctx, tx, s, entry{Action: "access.revoked", SubjectType: "access_grant", SubjectID: strings.TrimSpace(id)})
	})
}

// ProjectLabel is a label a project carries.
type ProjectLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// ProjectLabels lists the labels on a visible project.
func (sv *Service) ProjectLabels(ctx context.Context, projectRef string) ([]ProjectLabel, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT l.id, l.name, l.color FROM project_labels pl
		JOIN labels l ON l.workspace_id = pl.workspace_id AND l.id = pl.label_id
		WHERE pl.workspace_id = $1 AND pl.project_id = $2 ORDER BY lower(l.name)`, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProjectLabel{}
	for rows.Next() {
		var l ProjectLabel
		if err := rows.Scan(&l.ID, &l.Name, &l.Color); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// SetProjectLabels replaces a project's labels (manager+). Labels are ids or exact names.
func (sv *Service) SetProjectLabels(ctx context.Context, projectRef string, labels []string) ([]ProjectLabel, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.AccessManage); err != nil {
		return nil, err
	}
	p, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, ref := range labels {
		if strings.TrimSpace(ref) == "" {
			continue
		}
		id, err := sv.resolveScope(ctx, s.WorkspaceID, "label", ref)
		if err != nil {
			return nil, err
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM project_labels WHERE workspace_id = $1 AND project_id = $2`, s.WorkspaceID, p.ID); err != nil {
			return err
		}
		for _, id := range ids {
			if _, err := tx.ExecContext(ctx, `INSERT INTO project_labels (workspace_id, project_id, label_id) VALUES ($1, $2, $3)`,
				s.WorkspaceID, p.ID, id); err != nil {
				return err
			}
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "project.labels_set", SubjectType: "project", SubjectID: p.ID,
			Changes: map[string]any{"labels": ids}})
	})
	if err != nil {
		return nil, err
	}
	return sv.ProjectLabels(ctx, p.ID)
}
