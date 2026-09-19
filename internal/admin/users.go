package admin

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/platform"
	"github.com/fadymondy/mahaam/internal/tenant"
)

// UserWorkspace is one membership of a user.
type UserWorkspace struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role string `json:"role"`
	Plan string `json:"plan"`
}

// User is an account as the admin panel sees it.
type User struct {
	ID              string          `json:"id"`
	Email           string          `json:"email"`
	CreatedAt       string          `json:"created_at"`
	IsAdmin         bool            `json:"is_admin"`
	Status          string          `json:"status"`
	SuspendedReason *string         `json:"suspended_reason"`
	LastSeenAt      *time.Time      `json:"last_seen_at"`
	Workspaces      []UserWorkspace `json:"workspaces"`
}

// UserFilter narrows ListUsers. Status: active | suspended | admin.
type UserFilter struct {
	Q, Status string
	Page
}

const userSelect = `SELECT u.id, u.email, u.created_at, u.roles, p.suspended_at IS NOT NULL, p.suspended_reason, p.last_seen_at
	FROM users u LEFT JOIN platform_users p ON p.user_id = u.id`

type rowScanner interface{ Scan(...any) error }

func scanUser(row rowScanner) (*User, error) {
	u := &User{Workspaces: []UserWorkspace{}}
	var roles string
	var suspended bool
	if err := row.Scan(&u.ID, &u.Email, &u.CreatedAt, &roles, &suspended, &u.SuspendedReason, &u.LastSeenAt); err != nil {
		return nil, err
	}
	u.IsAdmin = tenant.IsPlatformAdmin(roles)
	u.Status = "active"
	if suspended {
		u.Status = "suspended"
	} else {
		u.SuspendedReason = nil
	}
	return u, nil
}

// adminRoleSQL matches a CSV roles column containing "admin".
const adminRoleSQL = `(',' || replace(u.roles, ' ', '') || ',') LIKE '%,admin,%'`

// ListUsers pages through accounts, newest first, with their workspaces.
func (sv *Service) ListUsers(ctx context.Context, f UserFilter) ([]User, int, error) {
	where := ` WHERE ($1 = '' OR u.email ILIKE $2 OR u.id = $1)`
	switch f.Status {
	case "suspended":
		where += ` AND p.suspended_at IS NOT NULL`
	case "active":
		where += ` AND p.suspended_at IS NULL`
	case "admin":
		where += ` AND ` + adminRoleSQL
	}
	q := strings.TrimSpace(f.Q)
	var total int
	if err := sv.DB.QueryRowContext(ctx, `SELECT count(*) FROM users u LEFT JOIN platform_users p ON p.user_id = u.id`+where, q, like(q)).Scan(&total); err != nil {
		return nil, 0, err
	}
	limit, offset := f.norm(25)
	rows, err := sv.DB.QueryContext(ctx, userSelect+where+` ORDER BY u.created_at DESC, u.id LIMIT $3 OFFSET $4`, q, like(q), limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *u)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if err := sv.fillWorkspaces(ctx, out); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (sv *Service) fillWorkspaces(ctx context.Context, users []User) error {
	if len(users) == 0 {
		return nil
	}
	ids := make([]string, len(users))
	idx := map[string]int{}
	for i, u := range users {
		ids[i] = u.ID
		idx[u.ID] = i
	}
	rows, err := sv.DB.QueryContext(ctx, `
		SELECT m.user_id, w.id, w.slug, w.name, m.role, w.plan
		FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
		WHERE m.user_id = ANY($1) AND m.status = 'active' ORDER BY lower(w.name)`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var uid string
		var w UserWorkspace
		if err := rows.Scan(&uid, &w.ID, &w.Slug, &w.Name, &w.Role, &w.Plan); err != nil {
			return err
		}
		users[idx[uid]].Workspaces = append(users[idx[uid]].Workspaces, w)
	}
	return rows.Err()
}

// UserDetail is one account with its token counts.
type UserDetail struct {
	User        User `json:"user"`
	MCPTokens   int  `json:"mcp_tokens"`
	AdminTokens int  `json:"admin_tokens"`
}

// GetUser reads one account by id or email.
func (sv *Service) GetUser(ctx context.Context, ref string) (*UserDetail, error) {
	u, err := scanUser(sv.DB.QueryRowContext(ctx, userSelect+` WHERE u.id = $1 OR lower(u.email) = lower($1)`, strings.TrimSpace(ref)))
	if isNoRows(err) {
		return nil, notFound("user")
	}
	if err != nil {
		return nil, err
	}
	list := []User{*u}
	if err := sv.fillWorkspaces(ctx, list); err != nil {
		return nil, err
	}
	d := &UserDetail{User: list[0]}
	_ = sv.DB.QueryRowContext(ctx, `SELECT count(*) FROM mcp_tokens WHERE user_id = $1 AND revoked_at IS NULL`, u.ID).Scan(&d.MCPTokens)
	_ = sv.DB.QueryRowContext(ctx, `SELECT count(*) FROM admin_mcp_tokens WHERE user_id = $1 AND revoked_at IS NULL`, u.ID).Scan(&d.AdminTokens)
	return d, nil
}

func (sv *Service) userForChange(ctx context.Context, a Actor, ref string, self string) (*UserDetail, error) {
	d, err := sv.GetUser(ctx, ref)
	if err != nil {
		return nil, err
	}
	if self != "" && d.User.ID == a.ID {
		return nil, errStatus(http.StatusConflict, self)
	}
	return d, nil
}

// SuspendUser blocks an account: every session and token call answers 403, and sign-in is refused.
func (sv *Service) SuspendUser(ctx context.Context, a Actor, ref, reason string) (*UserDetail, error) {
	d, err := sv.userForChange(ctx, a, ref, "you cannot suspend yourself")
	if err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	err = sv.tx(ctx, func(tx txExec) error {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO platform_users (user_id, suspended_at, suspended_reason, updated_at) VALUES ($1, now(), NULLIF($2, ''), now())
			ON CONFLICT (user_id) DO UPDATE SET suspended_at = now(), suspended_reason = NULLIF($2, ''), updated_at = now()`, d.User.ID, reason); err != nil {
			return err
		}
		return sv.audit(ctx, tx, a, "user.suspended", "user", d.User.ID, d.User.Email, map[string]any{"reason": reason})
	})
	if err != nil {
		return nil, err
	}
	platform.Invalidate(d.User.ID)
	return sv.GetUser(ctx, d.User.ID)
}

// ReactivateUser lifts a suspension.
func (sv *Service) ReactivateUser(ctx context.Context, a Actor, ref string) (*UserDetail, error) {
	d, err := sv.GetUser(ctx, ref)
	if err != nil {
		return nil, err
	}
	err = sv.tx(ctx, func(tx txExec) error {
		if _, err := tx.ExecContext(ctx, `UPDATE platform_users SET suspended_at = NULL, suspended_reason = NULL, updated_at = now() WHERE user_id = $1`, d.User.ID); err != nil {
			return err
		}
		return sv.audit(ctx, tx, a, "user.reactivated", "user", d.User.ID, d.User.Email, nil)
	})
	if err != nil {
		return nil, err
	}
	platform.Invalidate(d.User.ID)
	return sv.GetUser(ctx, d.User.ID)
}

// SetAdmin grants or revokes platform admin (users.roles "admin"). Revoking it also kills the
// user's admin MCP tokens (they are re-checked per call).
func (sv *Service) SetAdmin(ctx context.Context, a Actor, ref string, admin bool) (*UserDetail, error) {
	msg := ""
	if !admin {
		msg = "you cannot revoke your own platform admin role"
	}
	d, err := sv.userForChange(ctx, a, ref, msg)
	if err != nil {
		return nil, err
	}
	var roles string
	if err := sv.DB.QueryRowContext(ctx, `SELECT roles FROM users WHERE id = $1`, d.User.ID).Scan(&roles); err != nil {
		return nil, err
	}
	next := []string{}
	for _, r := range strings.Split(roles, ",") {
		if r = strings.TrimSpace(r); r != "" && r != "admin" {
			next = append(next, r)
		}
	}
	if admin {
		next = append(next, "admin")
	}
	err = sv.tx(ctx, func(tx txExec) error {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET roles = $2 WHERE id = $1`, d.User.ID, strings.Join(next, ",")); err != nil {
			return err
		}
		action := "user.admin_revoked"
		if admin {
			action = "user.admin_granted"
		}
		return sv.audit(ctx, tx, a, action, "user", d.User.ID, d.User.Email, map[string]any{"roles": strings.Join(next, ",")})
	})
	if err != nil {
		return nil, err
	}
	platform.Invalidate(d.User.ID)
	return sv.GetUser(ctx, d.User.ID)
}

// SignOut ends every session the user holds now: tokens issued before this moment are refused by
// the guard (platform.SessionRevoked). MCP tokens are separate and stay valid; revoke those in
// the workspace or suspend the account to stop them.
func (sv *Service) SignOut(ctx context.Context, a Actor, ref string) (*UserDetail, error) {
	d, err := sv.GetUser(ctx, ref)
	if err != nil {
		return nil, err
	}
	err = sv.tx(ctx, func(tx txExec) error {
		// A JWT's iat has whole-second precision: a session issued within this same second survives.
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO platform_users (user_id, sessions_valid_after, updated_at) VALUES ($1, now(), now())
			ON CONFLICT (user_id) DO UPDATE SET sessions_valid_after = now(), updated_at = now()`, d.User.ID); err != nil {
			return err
		}
		return sv.audit(ctx, tx, a, "user.signed_out", "user", d.User.ID, d.User.Email, nil)
	})
	if err != nil {
		return nil, err
	}
	platform.Invalidate(d.User.ID)
	return sv.GetUser(ctx, d.User.ID)
}
