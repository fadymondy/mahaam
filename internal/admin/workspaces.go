package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
)

// Workspace is a workspace as the admin panel lists it.
type Workspace struct {
	ID              string        `json:"id"`
	Slug            string        `json:"slug"`
	Name            string        `json:"name"`
	Plan            string        `json:"plan"`
	Status          string        `json:"status"`
	SuspendedReason *string       `json:"suspended_reason"`
	CreatedAt       time.Time     `json:"created_at"`
	OwnerEmail      *string       `json:"owner_email"`
	Members         int           `json:"members"`
	Projects        int           `json:"projects"`
	Usage           []limits.Item `json:"usage"`
}

// WorkspaceFilter narrows ListWorkspaces.
type WorkspaceFilter struct {
	Q, Plan, Status string
	Page
}

const wsSelect = `SELECT w.id, w.slug, w.name, w.plan, w.status, w.suspended_reason, w.created_at,
	(SELECT u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
	  WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1),
	(SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id AND m.status = 'active'),
	(SELECT count(*) FROM projects p WHERE p.workspace_id = w.id AND p.archived_at IS NULL)
	FROM workspaces w`

func scanWorkspace(row rowScanner) (*Workspace, error) {
	w := &Workspace{Usage: []limits.Item{}}
	err := row.Scan(&w.ID, &w.Slug, &w.Name, &w.Plan, &w.Status, &w.SuspendedReason, &w.CreatedAt, &w.OwnerEmail, &w.Members, &w.Projects)
	return w, err
}

// ListWorkspaces pages through workspaces, newest first, each with its usage this month.
func (sv *Service) ListWorkspaces(ctx context.Context, f WorkspaceFilter) ([]Workspace, int, error) {
	where := ` WHERE ($1 = '' OR w.name ILIKE $2 OR w.slug ILIKE $2 OR w.id = $1) AND ($3 = '' OR w.plan = $3) AND ($4 = '' OR w.status = $4)`
	q := strings.TrimSpace(f.Q)
	args := []any{q, like(q), strings.TrimSpace(f.Plan), strings.TrimSpace(f.Status)}
	var total int
	if err := sv.DB.QueryRowContext(ctx, `SELECT count(*) FROM workspaces w`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	limit, offset := f.norm(25)
	rows, err := sv.DB.QueryContext(ctx, wsSelect+where+` ORDER BY w.created_at DESC, w.id LIMIT $5 OFFSET $6`, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	out := []Workspace{}
	for rows.Next() {
		w, err := scanWorkspace(rows)
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		out = append(out, *w)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	now := time.Now()
	for i := range out {
		r, err := limits.BuildReport(ctx, sv.DB, out[i].ID, now)
		if err != nil {
			return nil, 0, err
		}
		out[i].Usage = r.Items
	}
	return out, total, nil
}

// Member is one membership row in a workspace detail.
type Member struct {
	UserID   string    `json:"user_id"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	Status   string    `json:"status"`
	JoinedAt time.Time `json:"joined_at"`
}

// WorkspaceDetail is one workspace with members, usage and overrides.
type WorkspaceDetail struct {
	Workspace Workspace        `json:"workspace"`
	Members   []Member         `json:"members"`
	Usage     *limits.Report   `json:"usage"`
	Overrides limits.Overrides `json:"overrides"`
	Billing   *Billing         `json:"billing"`
}

func (sv *Service) findWorkspace(ctx context.Context, ref string) (*Workspace, error) {
	w, err := scanWorkspace(sv.DB.QueryRowContext(ctx, wsSelect+` WHERE w.id = $1 OR w.slug = $1`, strings.TrimSpace(ref)))
	if isNoRows(err) {
		return nil, notFound("workspace")
	}
	return w, err
}

// GetWorkspace reads one workspace (id or slug) in full.
func (sv *Service) GetWorkspace(ctx context.Context, ref string) (*WorkspaceDetail, error) {
	w, err := sv.findWorkspace(ctx, ref)
	if err != nil {
		return nil, err
	}
	d := &WorkspaceDetail{Workspace: *w, Members: []Member{}}
	rows, err := sv.DB.QueryContext(ctx, `
		SELECT m.user_id, u.email, m.role, m.status, m.created_at
		FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1
		ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'member' THEN 3 ELSE 4 END, lower(u.email)`, w.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Email, &m.Role, &m.Status, &m.JoinedAt); err != nil {
			rows.Close()
			return nil, err
		}
		d.Members = append(d.Members, m)
	}
	rows.Close()
	if d.Usage, err = limits.BuildReport(ctx, sv.DB, w.ID, time.Now()); err != nil {
		return nil, err
	}
	d.Workspace.Usage = d.Usage.Items
	if d.Overrides, err = sv.overrides(ctx, w.ID); err != nil {
		return nil, err
	}
	if d.Billing, err = BillingOf(ctx, sv.DB, w.ID); err != nil {
		return nil, err
	}
	return d, nil
}

func (sv *Service) overrides(ctx context.Context, ws string) (limits.Overrides, error) {
	var raw []byte
	o := limits.Overrides{}
	if err := sv.DB.QueryRowContext(ctx, `SELECT plan_overrides FROM workspaces WHERE id = $1`, ws).Scan(&raw); err != nil {
		return o, err
	}
	_ = json.Unmarshal(raw, &o)
	if o.Limits == nil {
		o.Limits = map[string]limits.Rule{}
	}
	if o.Features == nil {
		o.Features = map[string]json.RawMessage{}
	}
	return o, nil
}

// Usage is a workspace's usage report for the month containing at.
func (sv *Service) Usage(ctx context.Context, ref string, at time.Time) (*limits.Report, error) {
	w, err := sv.findWorkspace(ctx, ref)
	if err != nil {
		return nil, err
	}
	return limits.BuildReport(ctx, sv.DB, w.ID, at)
}

// SetPlan moves a workspace to another (active) plan.
func (sv *Service) SetPlan(ctx context.Context, a Actor, ref, plan string) (*limits.Report, error) {
	w, err := sv.findWorkspace(ctx, ref)
	if err != nil {
		return nil, err
	}
	plan = strings.ToLower(strings.TrimSpace(plan))
	var active bool
	if err := sv.DB.QueryRowContext(ctx, `SELECT active FROM plans WHERE key = $1`, plan).Scan(&active); err != nil {
		return nil, invalid("unknown plan " + plan)
	}
	if !active && plan != w.Plan {
		return nil, invalid("plan " + plan + " is deactivated")
	}
	err = sv.tx(ctx, func(tx txExec) error {
		if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET plan = $2, updated_at = now() WHERE id = $1`, w.ID, plan); err != nil {
			return err
		}
		return sv.audit(ctx, tx, a, "workspace.plan_changed", "workspace", w.ID, w.Slug, map[string]any{"from": w.Plan, "to": plan})
	})
	if err != nil {
		return nil, err
	}
	limits.Invalidate(w.ID)
	return limits.BuildReport(ctx, sv.DB, w.ID, time.Now())
}

// SetOverrides replaces a workspace's overrides (limits: key → rule; features: key → value). An
// empty object clears them.
func (sv *Service) SetOverrides(ctx context.Context, a Actor, ref string, o limits.Overrides) (*limits.Report, error) {
	w, err := sv.findWorkspace(ctx, ref)
	if err != nil {
		return nil, err
	}
	if o.Limits == nil {
		o.Limits = map[string]limits.Rule{}
	}
	if err := limits.ValidateRules(o.Limits); err != nil {
		return nil, invalid(err.Error())
	}
	for k, r := range o.Limits {
		o.Limits[k] = r.Normalize(k)
	}
	for k := range o.Features {
		if k != "integrations" && !limits.ValidFeature(k) {
			return nil, invalid("unknown feature " + k)
		}
	}
	if _, err := limits.Merge(limits.Plan{}, o); err != nil {
		return nil, invalid(err.Error())
	}
	before, _ := sv.overrides(ctx, w.ID)
	raw, _ := json.Marshal(o)
	err = sv.tx(ctx, func(tx txExec) error {
		if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET plan_overrides = $2::jsonb, updated_at = now() WHERE id = $1`, w.ID, string(raw)); err != nil {
			return err
		}
		return sv.audit(ctx, tx, a, "workspace.overrides_changed", "workspace", w.ID, w.Slug, map[string]any{"from": before, "to": o})
	})
	if err != nil {
		return nil, err
	}
	limits.Invalidate(w.ID)
	return limits.BuildReport(ctx, sv.DB, w.ID, time.Now())
}

// SuspendWorkspace blocks a workspace for everyone but platform admins (403 with the reason).
func (sv *Service) SuspendWorkspace(ctx context.Context, a Actor, ref, reason string) (*Workspace, error) {
	return sv.setWorkspaceStatus(ctx, a, ref, "suspended", strings.TrimSpace(reason))
}

// ReactivateWorkspace lifts a suspension.
func (sv *Service) ReactivateWorkspace(ctx context.Context, a Actor, ref string) (*Workspace, error) {
	return sv.setWorkspaceStatus(ctx, a, ref, "active", "")
}

func (sv *Service) setWorkspaceStatus(ctx context.Context, a Actor, ref, status, reason string) (*Workspace, error) {
	w, err := sv.findWorkspace(ctx, ref)
	if err != nil {
		return nil, err
	}
	if w.Slug == tenant.PlatformSlug && status != "active" {
		return nil, errStatus(http.StatusConflict, "the platform workspace cannot be suspended")
	}
	err = sv.tx(ctx, func(tx txExec) error {
		if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET status = $2, suspended_reason = NULLIF($3, ''),
			suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`, w.ID, status, reason); err != nil {
			return err
		}
		action := "workspace.reactivated"
		var changes any
		if status == "suspended" {
			action, changes = "workspace.suspended", map[string]any{"reason": reason}
		}
		return sv.audit(ctx, tx, a, action, "workspace", w.ID, w.Slug, changes)
	})
	if err != nil {
		return nil, err
	}
	limits.Invalidate(w.ID)
	return sv.findWorkspace(ctx, w.ID)
}

// DeleteWorkspace deletes a workspace and (by cascade) everything in it, then removes its stored
// files (attachments in togo storage, feedback screenshots under STORAGE_DIR). confirm must be its
// slug. The files are collected before the delete and removed only after it commits, so a failed
// delete never loses a file; a file that cannot be removed is logged, never fatal.
func (sv *Service) DeleteWorkspace(ctx context.Context, a Actor, ref, confirm string) error {
	w, err := sv.findWorkspace(ctx, ref)
	if err != nil {
		return err
	}
	if w.Slug == tenant.PlatformSlug {
		return errStatus(http.StatusConflict, "the platform workspace cannot be deleted")
	}
	if strings.TrimSpace(confirm) != w.Slug {
		return invalid("type the workspace's slug (" + w.Slug + ") to confirm")
	}
	attachments, screenshots := sv.workspaceFiles(ctx, w.ID)
	err = sv.tx(ctx, func(tx txExec) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, w.ID); err != nil {
			return err
		}
		action := "workspace.deleted"
		if a.Via == "owner" {
			action = "workspace.deleted_by_owner"
		}
		return sv.audit(ctx, tx, a, action, "workspace", w.ID, w.Slug,
			map[string]any{"name": w.Name, "plan": w.Plan, "owner": w.OwnerEmail, "members": w.Members, "projects": w.Projects})
	})
	if err != nil {
		return err
	}
	limits.Invalidate(w.ID)
	sv.removeFiles(attachments, screenshots)
	return nil
}

// workspaceFiles lists a workspace's stored files: attachment storage paths and the feedback
// screenshots its issues point at (relative "feedback/<name>" paths only).
func (sv *Service) workspaceFiles(ctx context.Context, wsID string) (attachments, screenshots []string) {
	if rows, err := sv.DB.QueryContext(ctx, `SELECT storage_path FROM attachments WHERE workspace_id = $1`, wsID); err == nil {
		for rows.Next() {
			var p string
			if rows.Scan(&p) == nil && p != "" {
				attachments = append(attachments, p)
			}
		}
		rows.Close()
	}
	if rows, err := sv.DB.QueryContext(ctx, `SELECT screenshot FROM reports WHERE workspace_id = $1 AND screenshot LIKE 'feedback/%'`, wsID); err == nil {
		for rows.Next() {
			var p string
			if rows.Scan(&p) == nil {
				screenshots = append(screenshots, p)
			}
		}
		rows.Close()
	}
	return attachments, screenshots
}

func (sv *Service) removeFiles(attachments, screenshots []string) {
	if sv.Store != nil {
		for _, p := range attachments {
			if err := sv.Store.Delete(p); err != nil {
				slog.Warn("workspace delete: attachment not removed", "path", p, "err", err)
			}
		}
	}
	base := os.Getenv("STORAGE_DIR")
	if base == "" {
		base = "storage"
	}
	for _, p := range screenshots {
		clean := filepath.Clean(p)
		if !strings.HasPrefix(clean, "feedback"+string(filepath.Separator)) && !strings.HasPrefix(clean, "feedback/") {
			continue // never outside storage/feedback
		}
		if err := os.Remove(filepath.Join(base, clean)); err != nil && !os.IsNotExist(err) {
			slog.Warn("workspace delete: screenshot not removed", "path", p, "err", err)
		}
	}
}

var _ = sql.ErrNoRows
