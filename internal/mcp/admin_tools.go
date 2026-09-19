package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/admin"
	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/work"
	"github.com/fadymondy/mahaam/internal/workspaces"
)

/*
AdminTools is the platform admin MCP registry (/api/admin/mcp).

Issues: the triage set of fadymondy.com-v2's internal/mcp/tools.go
(list/get/create/update/comment/start/finish), over Mahaam's own reports table
in the platform workspace. Workspaces and users: inspection and membership
management.

All of these run on the owner pool (they are cross-tenant by definition), so
every query names its workspace or user explicitly.
*/
func adminCoreTools() []Tool {
	statusEnum := map[string]any{"type": "string", "enum": reports.Statuses}
	priorityEnum := map[string]any{"type": "string", "enum": []string{"lowest", "low", "medium", "high", "highest"}}
	typeEnum := map[string]any{"type": "string", "enum": []string{"bug", "task", "story", "epic", "feature"}}
	roleEnum := map[string]any{"type": "string", "enum": []string{"owner", "admin", "manager", "member", "client"}}

	platform := func(ctx context.Context, a *app.App) (string, error) { return reports.PlatformID(ctx, a) }
	find := func(ctx context.Context, a *app.App, key string) (*reports.Report, error) {
		p, err := platform(ctx, a)
		if err != nil {
			return nil, err
		}
		r, err := reports.Find(ctx, a.SysDB, p, key)
		if err != nil {
			return nil, errors.New("issue not found")
		}
		return r, nil
	}

	return []Tool{
		// ---- issues --------------------------------------------------------
		{
			Name:        "list_issues",
			Description: "List Mahaam's own issues (bug reports and tasks filed in the platform workspace). Filter by status, state, issue_type or a title search.",
			Scope:       "admin:issues:read",
			InputSchema: schema(nil, map[string]any{
				"status": statusEnum, "state": prop("string", "open or closed"), "issue_type": typeEnum,
				"q": prop("string", "Title contains"), "limit": prop("integer", "Default 50"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				p, err := platform(ctx, a)
				if err != nil {
					return "", err
				}
				rows, err := reports.List(ctx, a.SysDB, p, reports.Filter{
					Status: str(args, "status"), State: str(args, "state"), IssueType: str(args, "issue_type"),
					Q: str(args, "q"), Limit: intArg(args, "limit", 50),
				})
				if err != nil {
					return "", err
				}
				return reports.FormatList(rows), nil
			},
		},
		{
			Name:        "get_issue",
			Description: "Read one issue in full — body, capture context and comment thread. Accepts the key (MG-12) or the id.",
			Scope:       "admin:issues:read",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "MG-12 or id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				r, err := find(ctx, a, str(decodeArgs(raw), "key"))
				if err != nil {
					return "", err
				}
				comments, _ := reports.Comments(ctx, a.SysDB, r.WorkspaceID, r.ID)
				return reports.FormatOne(r, comments), nil
			},
		},
		{
			Name:        "create_issue",
			Description: "Open an issue on Mahaam's own tracker. Returns the assigned key (MG-n). Use it to file work discovered while building.",
			Scope:       "admin:issues:write",
			InputSchema: schema([]string{"title"}, map[string]any{
				"title": prop("string", ""), "body": prop("string", "Markdown"),
				"issue_type": typeEnum, "priority": priorityEnum, "status": statusEnum,
				"route": prop("string", "App route the issue concerns"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				if str(args, "title") == "" {
					return "", errors.New("title is required")
				}
				p, err := platform(ctx, a)
				if err != nil {
					return "", err
				}
				r, err := reports.Create(ctx, a.SysDB, p, reports.NewReport{
					Title: str(args, "title"), Body: str(args, "body"),
					IssueType: firstNonEmpty(str(args, "issue_type"), "task"),
					Priority:  str(args, "priority"), Status: str(args, "status"), Route: str(args, "route"),
					ReporterID: callerFrom(ctx).UserID,
				})
				if err != nil {
					return "", fmt.Errorf("could not create the issue: %w", err)
				}
				return fmt.Sprintf("Created %s — %s", r.Key, r.Title), nil
			},
		},
		{
			Name:        "update_issue",
			Description: "Change an issue's status, priority, type, title, body or resolution. status=done also closes it; moving out of done reopens it.",
			Scope:       "admin:issues:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key": prop("string", ""), "status": statusEnum, "priority": priorityEnum, "issue_type": typeEnum,
				"resolution": prop("string", ""), "title": prop("string", ""), "body": prop("string", ""),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := find(ctx, a, str(args, "key"))
				if err != nil {
					return "", err
				}
				fields := map[string]any{}
				if v := str(args, "status"); v != "" {
					if !reports.ValidStatus(v) {
						return "", fmt.Errorf("unknown status %q", v)
					}
					fields["status"] = v
					if v == "done" {
						fields["state"], fields["closed_at"] = "closed", time.Now().UTC()
					} else if r.Status == "done" {
						fields["state"], fields["closed_at"], fields["resolution"] = "open", nil, nil
					}
				}
				for _, f := range []string{"priority", "issue_type", "resolution", "title", "body"} {
					if v := str(args, f); v != "" {
						fields[f] = v
					}
				}
				if len(fields) == 0 {
					return "Nothing to change.", nil
				}
				if err := reports.Update(ctx, a.SysDB, r, fields); err != nil {
					return "", fmt.Errorf("could not update: %w", err)
				}
				return fmt.Sprintf("Updated %s.", r.Key), nil
			},
		},
		{
			Name:        "comment_issue",
			Description: "Reply on an issue. Recorded with author_kind=agent and the token's user, so it is distinguishable from the reporter.",
			Scope:       "admin:issues:write",
			InputSchema: schema([]string{"key", "body"}, map[string]any{"key": prop("string", ""), "body": prop("string", "Markdown")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := find(ctx, a, str(args, "key"))
				if err != nil {
					return "", err
				}
				if str(args, "body") == "" {
					return "", errors.New("body is required")
				}
				if err := reports.AddComment(ctx, a.SysDB, r, callerFrom(ctx).UserID, "agent", str(args, "body")); err != nil {
					return "", err
				}
				return fmt.Sprintf("Commented on %s.", r.Key), nil
			},
		},
		{
			Name:        "start_issue",
			Description: "Mark an issue in_progress and stamp started_at. Refuses issues marked human_only.",
			Scope:       "admin:issues:write",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				r, err := find(ctx, a, str(decodeArgs(raw), "key"))
				if err != nil {
					return "", err
				}
				if r.HumanOnly {
					return "", fmt.Errorf("%s is marked human_only — an agent may not start it", r.Key)
				}
				fields := map[string]any{"status": "in_progress", "state": "open"}
				if r.StartedAt == nil {
					fields["started_at"] = time.Now().UTC()
				}
				if err := reports.Update(ctx, a.SysDB, r, fields); err != nil {
					return "", fmt.Errorf("could not start: %w", err)
				}
				return fmt.Sprintf("Started %s.", r.Key), nil
			},
		},
		{
			Name:        "finish_issue",
			Description: "Mark an issue done, stamp finished_at/closed_at and accumulate agent_seconds from started_at. Optionally set a resolution.",
			Scope:       "admin:issues:write",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", ""), "resolution": prop("string", "")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := find(ctx, a, str(args, "key"))
				if err != nil {
					return "", err
				}
				now := time.Now().UTC()
				fields := map[string]any{"status": "done", "state": "closed", "closed_at": now, "finished_at": now}
				if r.StartedAt != nil {
					fields["agent_seconds"] = r.AgentSeconds + int64(now.Sub(*r.StartedAt).Seconds())
				}
				if v := str(args, "resolution"); v != "" {
					fields["resolution"] = v
				}
				if err := reports.Update(ctx, a.SysDB, r, fields); err != nil {
					return "", fmt.Errorf("could not finish: %w", err)
				}
				return fmt.Sprintf("Finished %s.", r.Key), nil
			},
		},

		// ---- workspaces ----------------------------------------------------
		{
			Name:        "list_workspaces",
			Description: "List workspaces with their member counts. Optional name/slug search.",
			Scope:       "admin:workspaces:read",
			InputSchema: schema(nil, map[string]any{"q": prop("string", "Name or slug contains"), "limit": prop("integer", "Default 50")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				rows, err := a.SysDB.QueryContext(ctx, `
					SELECT w.slug, w.name, w.plan, w.created_at,
					       (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id)
					FROM workspaces w
					WHERE ($1 = '' OR w.name ILIKE '%' || $1 || '%' OR w.slug ILIKE '%' || $1 || '%')
					ORDER BY w.created_at DESC LIMIT $2`, str(args, "q"), intArg(args, "limit", 50))
				if err != nil {
					return "", err
				}
				defer rows.Close()
				var b strings.Builder
				n := 0
				for rows.Next() {
					var slug, name, plan string
					var created time.Time
					var members int
					if err := rows.Scan(&slug, &name, &plan, &created, &members); err != nil {
						return "", err
					}
					n++
					fmt.Fprintf(&b, "%-24s %-30s plan=%s members=%d created=%s\n", slug, name, plan, members, created.Format("2006-01-02"))
				}
				if n == 0 {
					return "No workspaces matched.", nil
				}
				return fmt.Sprintf("%d workspace(s):\n\n%s", n, b.String()), nil
			},
		},
		{
			Name:        "get_workspace",
			Description: "One workspace (slug or id) with its members and pending invitations.",
			Scope:       "admin:workspaces:read",
			InputSchema: schema([]string{"workspace"}, map[string]any{"workspace": prop("string", "Slug or id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				w, err := adminWorkspace(ctx, a.SysDB, str(decodeArgs(raw), "workspace"))
				if err != nil {
					return "", err
				}
				members, err := workspaces.Members(ctx, a.SysDB, w.id)
				if err != nil {
					return "", err
				}
				var pending int
				_ = a.SysDB.QueryRowContext(ctx,
					`SELECT count(*) FROM invitations WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()`, w.id).Scan(&pending)
				var b strings.Builder
				fmt.Fprintf(&b, "%s — %s (id=%s, plan=%s)\n%d pending invitation(s)\n\n%d member(s):\n", w.slug, w.name, w.id, w.plan, pending, len(members))
				for _, m := range members {
					fmt.Fprintf(&b, "  %-8s %s (%s)\n", m.Role, m.Email, m.Status)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "update_workspace",
			Description: "Rename a workspace or change its plan.",
			Scope:       "admin:workspaces:write",
			InputSchema: schema([]string{"workspace"}, map[string]any{
				"workspace": prop("string", "Slug or id"), "name": prop("string", ""), "plan": prop("string", ""),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				w, err := adminWorkspace(ctx, a.SysDB, str(args, "workspace"))
				if err != nil {
					return "", err
				}
				name, plan := firstNonEmpty(str(args, "name"), w.name), firstNonEmpty(str(args, "plan"), w.plan)
				if _, err := a.SysDB.ExecContext(ctx,
					`UPDATE workspaces SET name = $2, updated_at = now() WHERE id = $1`, w.id, name); err != nil {
					return "", err
				}
				// A plan change goes through the admin domain: validated, cache invalidated, audited.
				if plan != w.plan {
					c := callerFrom(ctx)
					if _, err := (&admin.Service{DB: a.SysDB}).SetPlan(ctx, admin.Actor{ID: c.UserID, Email: c.Email, IP: work.MetaFrom(ctx).IP, Via: "mcp"}, w.id, plan); err != nil {
						return "", err
					}
				}
				return fmt.Sprintf("Updated %s: name=%q plan=%s.", w.slug, name, plan), nil
			},
		},
		{
			Name:        "add_member",
			Description: "Add an existing user (by email) to a workspace with a role, bypassing the invitation flow.",
			Scope:       "admin:workspaces:write",
			InputSchema: schema([]string{"workspace", "email", "role"}, map[string]any{
				"workspace": prop("string", "Slug or id"), "email": prop("string", ""), "role": roleEnum,
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				role := str(args, "role")
				if !authz.Valid(role) {
					return "", fmt.Errorf("unknown role %q", role)
				}
				w, err := adminWorkspace(ctx, a.SysDB, str(args, "workspace"))
				if err != nil {
					return "", err
				}
				uid, err := userIDByEmail(ctx, a.SysDB, str(args, "email"))
				if err != nil {
					return "", err
				}
				res, err := a.SysDB.ExecContext(ctx, `
					INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active')
					ON CONFLICT (workspace_id, user_id) DO NOTHING`, w.id, uid, role)
				if err != nil {
					return "", err
				}
				if n, _ := res.RowsAffected(); n == 0 {
					return "", errors.New("already a member — use set_member_role")
				}
				return fmt.Sprintf("Added %s to %s as %s.", str(args, "email"), w.slug, role), nil
			},
		},
		{
			Name:        "set_member_role",
			Description: "Change a member's role or suspend/reactivate them. Refuses to leave a workspace without an active owner.",
			Scope:       "admin:workspaces:write",
			InputSchema: schema([]string{"workspace", "email"}, map[string]any{
				"workspace": prop("string", "Slug or id"), "email": prop("string", ""), "role": roleEnum,
				"status": map[string]any{"type": "string", "enum": []string{"active", "suspended"}},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				w, err := adminWorkspace(ctx, a.SysDB, str(args, "workspace"))
				if err != nil {
					return "", err
				}
				uid, err := userIDByEmail(ctx, a.SysDB, str(args, "email"))
				if err != nil {
					return "", err
				}
				var role, status string
				if err := a.SysDB.QueryRowContext(ctx,
					`SELECT role, status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, w.id, uid,
				).Scan(&role, &status); err != nil {
					return "", errors.New("not a member of that workspace")
				}
				newRole, newStatus := firstNonEmpty(str(args, "role"), role), firstNonEmpty(str(args, "status"), status)
				if !authz.Valid(newRole) || (newStatus != "active" && newStatus != "suspended") {
					return "", errors.New("invalid role or status")
				}
				if role == "owner" && status == "active" && (newRole != "owner" || newStatus != "active") {
					if lastOwner(ctx, a.SysDB, w.id) {
						return "", errors.New("that is the last active owner — promote another owner first")
					}
				}
				if _, err := a.SysDB.ExecContext(ctx, `
					UPDATE workspace_members SET role = $3, status = $4, updated_at = now()
					WHERE workspace_id = $1 AND user_id = $2`, w.id, uid, newRole, newStatus); err != nil {
					return "", err
				}
				return fmt.Sprintf("%s in %s is now %s (%s).", str(args, "email"), w.slug, newRole, newStatus), nil
			},
		},
		{
			Name:        "remove_member",
			Description: "Remove a member from a workspace. Their MCP tokens there stop working at once. Refuses to remove the last active owner.",
			Scope:       "admin:workspaces:write",
			InputSchema: schema([]string{"workspace", "email"}, map[string]any{
				"workspace": prop("string", "Slug or id"), "email": prop("string", ""),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				w, err := adminWorkspace(ctx, a.SysDB, str(args, "workspace"))
				if err != nil {
					return "", err
				}
				uid, err := userIDByEmail(ctx, a.SysDB, str(args, "email"))
				if err != nil {
					return "", err
				}
				var role string
				if err := a.SysDB.QueryRowContext(ctx,
					`SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, w.id, uid,
				).Scan(&role); err == nil && role == "owner" && lastOwner(ctx, a.SysDB, w.id) {
					return "", errors.New("that is the last active owner — promote another owner first")
				}
				res, err := a.SysDB.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, w.id, uid)
				if err != nil {
					return "", err
				}
				if n, _ := res.RowsAffected(); n == 0 {
					return "", errors.New("not a member of that workspace")
				}
				return fmt.Sprintf("Removed %s from %s.", str(args, "email"), w.slug), nil
			},
		},

		// ---- users ---------------------------------------------------------
		{
			Name:        "list_users",
			Description: "List user accounts with their platform roles and workspace counts. Optional email search.",
			Scope:       "admin:users:read",
			InputSchema: schema(nil, map[string]any{"q": prop("string", "Email contains"), "limit": prop("integer", "Default 50")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				rows, err := a.SysDB.QueryContext(ctx, `
					SELECT u.email, u.roles, u.created_at,
					       (SELECT count(*) FROM workspace_members m WHERE m.user_id = u.id)
					FROM users u WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%')
					ORDER BY u.created_at DESC LIMIT $2`, str(args, "q"), intArg(args, "limit", 50))
				if err != nil {
					return "", err
				}
				defer rows.Close()
				var b strings.Builder
				n := 0
				for rows.Next() {
					var email, roles, created string
					var count int
					if err := rows.Scan(&email, &roles, &created, &count); err != nil {
						return "", err
					}
					n++
					fmt.Fprintf(&b, "%-40s roles=%-10s workspaces=%d created=%s\n", email, firstNonEmpty(roles, "-"), count, created)
				}
				if n == 0 {
					return "No users matched.", nil
				}
				return fmt.Sprintf("%d user(s):\n\n%s", n, b.String()), nil
			},
		},
		{
			Name:        "get_user",
			Description: "One user (email or id) with every workspace membership and their MCP token counts.",
			Scope:       "admin:users:read",
			InputSchema: schema([]string{"user"}, map[string]any{"user": prop("string", "Email or id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				ref := str(decodeArgs(raw), "user")
				var id, email, roles, created string
				if err := a.SysDB.QueryRowContext(ctx,
					`SELECT id, email, roles, created_at FROM users WHERE id = $1 OR lower(email) = lower($1)`, ref,
				).Scan(&id, &email, &roles, &created); err != nil {
					return "", errors.New("user not found")
				}
				list, err := workspaces.MyWorkspaces(ctx, a.SysDB, id)
				if err != nil {
					return "", err
				}
				var tokens int
				_ = a.SysDB.QueryRowContext(ctx,
					`SELECT count(*) FROM mcp_tokens WHERE user_id = $1 AND revoked_at IS NULL`, id).Scan(&tokens)
				var b strings.Builder
				fmt.Fprintf(&b, "%s (id=%s)\nplatform roles: %s\ncreated: %s\nlive user MCP tokens: %d\n\n%d workspace(s):\n",
					email, id, firstNonEmpty(roles, "-"), created, tokens, len(list))
				for _, w := range list {
					fmt.Fprintf(&b, "  %-8s %s (%s)\n", w.Role, w.Name, w.Slug)
				}
				return b.String(), nil
			},
		},
	}
}

type wsRow struct{ id, slug, name, plan string }

func adminWorkspace(ctx context.Context, db *sql.DB, ref string) (*wsRow, error) {
	w := &wsRow{}
	err := db.QueryRowContext(ctx, `SELECT id, slug, name, plan FROM workspaces WHERE id = $1 OR slug = $1`,
		strings.TrimSpace(ref)).Scan(&w.id, &w.slug, &w.name, &w.plan)
	if err != nil {
		return nil, errors.New("workspace not found")
	}
	return w, nil
}

func userIDByEmail(ctx context.Context, db *sql.DB, email string) (string, error) {
	var id string
	if err := db.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = lower($1)`, strings.TrimSpace(email)).Scan(&id); err != nil {
		return "", errors.New("no user with that email")
	}
	return id, nil
}

func lastOwner(ctx context.Context, db *sql.DB, workspaceID string) bool {
	var owners int
	_ = db.QueryRowContext(ctx,
		`SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'`, workspaceID).Scan(&owners)
	return owners <= 1
}

// AdminTools is the full admin MCP registry: issues, workspaces and users (above) plus plans,
// quotas, suspension and stats (admin_plan_tools.go).
func AdminTools() []Tool { return append(adminCoreTools(), adminPlanTools()...) }
