// Package authz is the single authorization file: a fixed role × action
// matrix, plus the per-table policy for generated CRUD. Everything that asks
// "may this caller do X" asks Can — browser sessions and MCP tokens alike, so
// an agent can never exceed the human it acts for.
//
// togo-framework/authz was evaluated for P0 and not adopted: it is a
// permission-string checker over Identity.Permissions (the global users.roles /
// users.permissions CSV columns), with no notion of a per-workspace role, which
// is the only role Managy has.
package authz

import "net/http"

// Role is a workspace role. Order matters: each role holds everything below it.
type Role string

const (
	Owner   Role = "owner"
	Admin   Role = "admin"
	Manager Role = "manager"
	Member  Role = "member"
	Client  Role = "client"
	// None marks an action or table operation no role may perform.
	None Role = ""
)

var rank = map[Role]int{Client: 1, Member: 2, Manager: 3, Admin: 4, Owner: 5}

// Valid reports whether r is a real workspace role.
func Valid(r string) bool { _, ok := rank[Role(r)]; return ok }

// AtLeast reports whether r holds min or higher. Nothing is at least None.
func (r Role) AtLeast(min Role) bool {
	if min == None {
		return false
	}
	return rank[r] >= rank[min] && rank[r] > 0
}

// Action names. Adding one means adding it to Matrix below.
const (
	WorkspaceRead     = "workspace:read"
	WorkspaceUpdate   = "workspace:update"
	MembersRead       = "members:read"
	MembersInvite     = "members:invite"
	InvitationsManage = "invitations:manage"
	TokensManageOwn   = "tokens:manage"
	TokensRevokeAny   = "tokens:revoke_any"
	FeedbackFile      = "feedback:file"
	FeedbackRead      = "feedback:read"
	FeedbackWrite     = "feedback:write"
	GraphQL           = "graphql"

	// P1 — projects and tasks. Project visibility (workspace vs members-only, direct or
	// through a team) is applied on top of these in internal/work; project leads may also
	// manage their own project.
	ProjectsRead     = "projects:read"
	ProjectsCreate   = "projects:create"
	ProjectsManage   = "projects:manage"
	TasksRead        = "tasks:read"
	TasksWrite       = "tasks:write"
	ClientsRead      = "clients:read"
	ClientsWrite     = "clients:write"
	TeamsRead        = "teams:read"
	TeamsWrite       = "teams:write"
	LabelsCreate     = "labels:create"
	LabelsManage     = "labels:manage"
	ActivityRead     = "activity:read"
	CommentsModerate = "comments:moderate"

	// P2 — time tracking. Tracking is your own time; time:manage reaches other people's timers,
	// entries and timesheets. Rates are finance: managers read them, admins set them.
	TimeTrack   = "time:track"
	TimeManage  = "time:manage"
	RatesRead   = "rates:read"
	RatesManage = "rates:manage"

	// P5 — reports. Everyone who tracks time reads reports, but a member's reports cover only their
	// own time; managers see everyone's. Finance (money columns, profitability, budget money) is
	// manager+. Sharing a saved view with the workspace is manager+.
	ReportsRead    = "reports:read"
	ReportsFinance = "reports:finance"
	ReportsShare   = "reports:share"
	ReportsAll     = "reports:all"
)

// Matrix is the minimum role per action.
var Matrix = map[string]Role{
	WorkspaceRead:     Client,
	WorkspaceUpdate:   Admin,
	MembersRead:       Member,
	MembersInvite:     Admin,
	InvitationsManage: Admin,
	TokensManageOwn:   Client,
	TokensRevokeAny:   Admin,
	FeedbackFile:      Client,
	FeedbackRead:      Member,
	FeedbackWrite:     Member,
	// The generic GraphQL endpoint exposes generated resolvers, which carry no
	// per-field authorization of their own; RLS isolates tenants, and this keeps
	// it to people who could make the same changes in the UI.
	GraphQL: Admin,

	ProjectsRead:     Client, // clients: only projects they are a member of (internal/work)
	ProjectsCreate:   Manager,
	ProjectsManage:   Manager, // or the project's lead
	TasksRead:        Client,
	TasksWrite:       Member,
	ClientsRead:      Member,
	ClientsWrite:     Manager,
	TeamsRead:        Member,
	TeamsWrite:       Manager,
	LabelsCreate:     Member,
	LabelsManage:     Manager,
	ActivityRead:     Manager, // the workspace-wide feed; project/task feeds follow project access
	CommentsModerate: Manager,

	TimeTrack:   Member, // clients never track time
	TimeManage:  Manager,
	RatesRead:   Manager,
	RatesManage: Admin,

	ReportsRead:    Member,
	ReportsAll:     Manager,
	ReportsFinance: Manager,
	ReportsShare:   Manager,
}

// Can reports whether role may perform action. Unknown actions are denied.
func Can(role string, action string) bool {
	min, ok := Matrix[action]
	if !ok {
		return false
	}
	return Role(role).AtLeast(min)
}

// Allowed lists every action role may perform (for the UI's `can`).
func Allowed(role string) []string {
	out := []string{}
	for action := range Matrix {
		if Can(role, action) {
			out = append(out, action)
		}
	}
	return out
}

// TablePolicy is who may read and who may write a generated resource.
type TablePolicy struct{ Read, Write Role }

/*
Generated maps each generated REST resource (the /api/<table> tree registered
by rest/registry.gen.go) to its policy. It is default-deny: a resource added by
`togo make:resource` is unreachable over the generic API until it is listed
here — so a new table is closed until someone decides otherwise, rather than
open until someone notices.

Membership itself is enforced before this (tenant.Require, 404), and RLS
confines every row to the caller's workspace after it.

Writes to the tenancy tables are None on purpose: the generic handlers take
workspace_id / user_id / role / token_hash straight from the request body. Those
changes go through the hand-written /api/w/* and /api/me/* endpoints, which
derive them from the session.
*/
var Generated = map[string]TablePolicy{
	"workspaces":        {Read: Member, Write: None},
	"workspace_members": {Read: Member, Write: None},
	"invitations":       {Read: Admin, Write: None},
	"mcp_tokens":        {Read: None, Write: None},
	"reports":           {Read: Member, Write: Admin},
	"report_comments":   {Read: Member, Write: Admin},

	// P1. Generated CRUD is read-only and manager+ (managers see every project anyway): the
	// generic list handlers know nothing of project visibility, and the generic writes would
	// neither check references nor record activity. Every write goes through /api/w/*
	// (internal/work), which derives the actor from the session and logs it.
	"clients":              {Read: Manager, Write: None},
	"projects":             {Read: Manager, Write: None},
	"project_members":      {Read: Manager, Write: None},
	"teams":                {Read: Manager, Write: None},
	"team_members":         {Read: Manager, Write: None},
	"project_teams":        {Read: Manager, Write: None},
	"task_statuses":        {Read: Manager, Write: None},
	"tasks":                {Read: Manager, Write: None},
	"task_assignees":       {Read: Manager, Write: None},
	"task_checklist_items": {Read: Manager, Write: None},
	"labels":               {Read: Manager, Write: None},
	"task_labels":          {Read: Manager, Write: None},
	"task_comments":        {Read: Manager, Write: None},
	"attachments":          {Read: Manager, Write: None},
	"activity_logs":        {Read: Admin, Write: None},

	// P2. Every write goes through /api/w/time* (internal/work/time.go), which enforces the
	// invariants' application half (own entries, locks, rate snapshots) and records activity.
	// Time entries carry rates, so the generic read is manager+ (managers see every timesheet).
	// Rates are finance: admin+. Notifications are one person's inbox: no generic read at all.
	"time_entries":  {Read: Manager, Write: None},
	"member_rates":  {Read: Admin, Write: None},
	"notifications": {Read: None, Write: None},

	// P5. A saved view is its owner's unless shared, and a person's notification settings are
	// theirs alone — neither rule is expressible in the generic handlers. Both go through
	// /api/w/saved-reports and /api/w/notification-settings.
	"saved_reports":      {Read: None, Write: None},
	"notification_prefs": {Read: None, Write: None},
}

// CanTable reports whether role may perform an HTTP method on a generated table.
func CanTable(role, table, method string) bool {
	p, ok := Generated[table]
	if !ok {
		return false
	}
	switch method {
	case http.MethodGet, http.MethodHead:
		return Role(role).AtLeast(p.Read)
	default:
		return Role(role).AtLeast(p.Write)
	}
}
