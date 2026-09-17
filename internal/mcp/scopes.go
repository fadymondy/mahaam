package mcp

import "github.com/fadymondy/managy/internal/authz"

// ScopeDef is one grantable scope and the lowest workspace role that may hold it.
type ScopeDef struct {
	Scope       string     `json:"scope"`
	Description string     `json:"description"`
	MinRole     authz.Role `json:"min_role"`
}

/*
UserScopes is the closed list of user-MCP scopes (the plan's list). A token can
carry only these; a tool must declare one of these (scopes_test.go). There is
no "*": owners pick scopes like everyone else (owner decision 11 is still open;
explicit scopes are the safe default until it is decided).

Scopes for tools that do not exist yet are listed so tokens can be minted
ahead of P1–P6 — they grant nothing until a tool declares them.
*/
var UserScopes = []ScopeDef{
	{"members:read", "See the workspace, your role and its members (whoami, list_members)", authz.Member},
	{"projects:read", "Read projects", authz.Client},
	// Manager: creating and changing projects is a manager action in authz.Matrix
	// (project leads manage their own project in the UI; a token needs the role).
	{"projects:write", "Create, change and archive projects", authz.Manager},
	{"tasks:read", "Read tasks", authz.Member},
	{"tasks:write", "Create, move, assign and comment on tasks", authz.Member},
	{"time:read", "Read your own time entries and running timer", authz.Member},
	{"time:write", "Start/stop timers and log your own time", authz.Member},
	{"time:manage", "Change other members' time", authz.Manager},
	{"reports:read", "Time summaries, budgets and timesheets", authz.Member},
	{"reports:finance", "Profitability and rates", authz.Manager},
	{"clients:read", "Read clients", authz.Member},
	{"clients:write", "Create and change clients", authz.Manager},
	{"invoices:read", "Read invoices", authz.Manager},
	{"invoices:write", "Draft invoices from time", authz.Manager},
	{"feedback:read", "Read the workspace's feedback issues", authz.Member},
	{"feedback:write", "Comment on and update feedback issues", authz.Member},
	{"issues:read", "Read the workspace's own issues (its \"Report a problem\" intake)", authz.Member},
	{"issues:write", "Comment on and triage the workspace's own issues", authz.Member},
}

// AdminScopes is the closed list for the platform admin MCP. Admin tokens are
// held only by platform admins (users.roles contains "admin"); the scope still
// narrows what one token can do.
var AdminScopes = []ScopeDef{
	{"admin:issues:read", "List and read platform issues (reports)", authz.None},
	{"admin:issues:write", "Create, update, comment, start and finish platform issues", authz.None},
	{"admin:workspaces:read", "List and inspect workspaces", authz.None},
	{"admin:workspaces:write", "Rename workspaces, change plans, add/remove members and roles", authz.None},
	{"admin:users:read", "List and inspect users", authz.None},
}

func userScope(name string) (ScopeDef, bool) {
	for _, s := range UserScopes {
		if s.Scope == name {
			return s, true
		}
	}
	return ScopeDef{}, false
}

func adminScope(name string) bool {
	for _, s := range AdminScopes {
		if s.Scope == name {
			return true
		}
	}
	return false
}

// RoleMayHold reports whether a workspace role may hold a user scope.
func RoleMayHold(role, scope string) bool {
	def, ok := userScope(scope)
	return ok && authz.Role(role).AtLeast(def.MinRole)
}

// Effective narrows a token's stored scopes to what its user's CURRENT role
// allows. A demoted member's token shrinks with them — an agent never exceeds
// its human.
func Effective(role string, stored []string) []string {
	out := []string{}
	for _, s := range stored {
		if RoleMayHold(role, s) {
			out = append(out, s)
		}
	}
	return out
}
