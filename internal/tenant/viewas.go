package tenant

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/fadymondy/mahaam/internal/authz"
)

// ViewAsHeader names the team member an owner or admin is looking through (MH-1159): the web app
// sends it beside X-Workspace-ID while "Viewing as" is on. The request then runs with that
// member's user and role, so every list, permission and portal answers exactly what they see.
// It is read-only: anything but GET/HEAD is refused, so no change is ever attributed to someone
// who did not make it. MCP never reads it (its scope comes from the token, not tenant.Require).
const ViewAsHeader = "X-View-As"

// ErrViewAsDenied covers "not an owner/admin", "no such member" and "a higher role" alike.
var ErrViewAsDenied = errors.New("you cannot view the workspace as this member")

// CanViewAs reports whether a caller with role may look through a member with target: owners and
// admins only, and never as someone above themselves (an admin cannot view as the owner).
func CanViewAs(role, target string) bool {
	r := authz.Role(role)
	return r.AtLeast(authz.Admin) && authz.Valid(target) && r.AtLeast(authz.Role(target))
}

// ViewAs returns the scope of member targetID inside caller's workspace, with ImpersonatorID set
// to the caller. The member must be active and not above the caller; viewing as yourself is
// refused (there is nothing to see).
func ViewAs(ctx context.Context, sys *sql.DB, caller *Scope, targetID string) (*Scope, error) {
	targetID = strings.TrimSpace(targetID)
	if caller == nil || targetID == "" || targetID == caller.UserID || caller.ImpersonatorID != "" {
		return nil, ErrViewAsDenied
	}
	var email, role string
	err := sys.QueryRowContext(ctx, `
		SELECT u.email, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
		caller.WorkspaceID, targetID,
	).Scan(&email, &role)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrViewAsDenied
	}
	if err != nil {
		return nil, err
	}
	if !CanViewAs(caller.Role, role) {
		return nil, ErrViewAsDenied
	}
	s := *caller
	s.UserID, s.Email, s.Role = targetID, email, role
	s.ImpersonatorID, s.ImpersonatorEmail = caller.UserID, caller.Email
	return &s, nil
}

// viewAs applies X-View-As to the resolved session scope. It answers the scope to continue with,
// or writes the refusal and answers nil.
func viewAs(w http.ResponseWriter, r *http.Request, sys *sql.DB, s *Scope) *Scope {
	target := r.Header.Get(ViewAsHeader)
	if target == "" {
		return s
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeCode(w, http.StatusForbidden, "You are viewing as another member. Exit view-as to make changes.", "view_as_read_only")
		return nil
	}
	v, err := ViewAs(r.Context(), sys, s, target)
	if errors.Is(err, ErrViewAsDenied) {
		writeCode(w, http.StatusForbidden, ErrViewAsDenied.Error(), "view_as_denied")
		return nil
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not resolve the member")
		return nil
	}
	return v
}
