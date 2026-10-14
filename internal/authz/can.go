// Package authz is the single authorization file: a fixed role × action
// matrix, plus the per-table policy for generated CRUD. Everything that asks
// "may this caller do X" asks Can — browser sessions and MCP tokens alike, so
// an agent can never exceed the human it acts for.
//
// togo-framework/authz was evaluated for P0 and not adopted: it is a
// permission-string checker over Identity.Permissions (the global users.roles /
// users.permissions CSV columns), with no notion of a per-workspace role, which
// is the only role Mahaam has.
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

	// P6 — invoices. Invoices are finance documents (money in minor units, rate snapshots), so both
	// reading and writing them are manager+ (matches the invoices:read/write MCP scopes' MinRole).
	InvoicesRead  = "invoices:read"
	InvoicesWrite = "invoices:write"

	// P7 — client portal & feedback widget. Linking a portal contact to a client, and minting /
	// rotating / revoking a project's public feedback keys, are workspace-configuration actions:
	// manager+ (the same tier that manages clients and projects). Reading a project's keys is
	// manager+ too — they carry no secret a client should see, but they are settings.
	ClientContactsManage = "client_contacts:manage"
	FeedbackKeysRead     = "feedback_keys:read"
	FeedbackKeysManage   = "feedback_keys:manage"

	// Integrations (GitHub App, Jira import, Linear import) per project. Connecting,
	// disconnecting and syncing are project configuration: manager+. Reading the status and the
	// linked repository's commits / pull requests / runs is for anyone working on the project
	// (members+, on a project they can see). Filing a GitHub issue from a Mahaam issue is an
	// issue write (member+); triggering a deploy (workflow_dispatch) is manager+.
	IntegrationsRead   = "integrations:read"
	IntegrationsManage = "integrations:manage"
	GitHubIssueWrite   = "github:issues"
	GitHubDeploy       = "github:deploy"

	// Project vault. Memory (notes about the project) is read and written by anyone working
	// on it (members+, on a project they can see). Secrets: members see that a secret exists
	// (title + hint), but only managers+ (or the project lead) store, change or reveal one,
	// and every reveal is recorded. A customer works the vault of their own projects like a
	// member (MH-1190): memory and secret titles, never a secret's value.
	VaultRead    = "vault:read"
	VaultWrite   = "vault:write"
	VaultSecrets = "vault:secrets"

	// Access grants (label / task, to a user or a team) and the labels a project carries:
	// who sees what is a workspace-configuration decision, manager+.
	AccessManage = "access:manage"

	// Customer portal (roadmap 5). PortalRead: a project's customer panel (aggregates only —
	// never task rows, rates or people) on a project the caller can see; clients included.
	// PortalWrite: file requests and accept/reopen/re-prioritise/comment on the issues of
	// their own projects. RequestsManage: the staff Requests inbox (accept, decline, convert).
	PortalRead     = "portal:read"
	PortalWrite    = "portal:write"
	RequestsManage = "requests:manage"

	// AI consumption and project subscriptions (billed on invoices). Anyone working on a project
	// records their agents' usage; costs, markup and subscriptions are finance: manager+.
	AIUsageRecord       = "ai_usage:record"
	AIUsageRead         = "ai_usage:read"
	SubscriptionsManage = "subscriptions:manage"
	// BillingRead: a project's Billing tab as its customer sees it (MH-1190) — AI usage at the
	// billed price and the billable subscriptions' prices, on a project the caller can see; never
	// our cost, the markup or notes.
	BillingRead = "billing:read"

	// Employee KPI (internal/work/kpi.go). KPIRead: your own KPI dossier and GitHub account
	// (member+); KPIAll: anyone's, the team table, and mapping a member's GitHub account;
	// KPIReview: write reviews of employees. Employees read their own reviews via KPIRead.
	KPIRead   = "kpi:read"
	KPIAll    = "kpi:all"
	KPIReview = "kpi:review"
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
	// A customer works the issues of their own projects like a member (MH-1176); the issue
	// tracker (internal/reports.customer) keeps them to the projects they can see.
	FeedbackRead:  Client,
	FeedbackWrite: Client,
	// The generic GraphQL endpoint exposes generated resolvers, which carry no
	// per-field authorization of their own; RLS isolates tenants, and this keeps
	// it to people who could make the same changes in the UI.
	GraphQL: Admin,

	ProjectsRead:   Client, // clients: only the projects of the client they are a portal contact of (internal/work)
	ProjectsCreate: Manager,
	ProjectsManage: Manager, // or the project's lead
	// A customer (client) gets the full project — board, tasks, issues — with a member's
	// rights, on the projects they can see (visibleClause / taskClause) and nothing wider
	// (MH-1176), and every project tab but Settings: GitHub, Hosting, Vault and Billing read
	// (MH-1190). Rates, time tracking, members and the workspace areas stay member+.
	TasksRead:        Client,
	TasksWrite:       Client,
	ClientsRead:      Member,
	ClientsWrite:     Manager,
	TeamsRead:        Member,
	TeamsWrite:       Manager,
	LabelsCreate:     Client,
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

	InvoicesRead:  Manager,
	InvoicesWrite: Manager,

	ClientContactsManage: Manager,
	FeedbackKeysRead:     Manager,
	FeedbackKeysManage:   Manager,

	IntegrationsRead:   Client, // on a project they can see (integrations.project → FindProject)
	IntegrationsManage: Manager,
	GitHubIssueWrite:   Member,
	GitHubDeploy:       Manager,

	VaultRead:    Client, // on a project they can see (vaultProject → FindProject)
	VaultWrite:   Client,
	VaultSecrets: Manager, // or the project's lead (internal/work/vault.go)

	AccessManage: Manager,

	AIUsageRecord:       Member,
	AIUsageRead:         Manager,
	SubscriptionsManage: Manager,
	BillingRead:         Client,

	KPIRead:   Member,
	KPIAll:    Manager,
	KPIReview: Manager,

	PortalRead:     Client,
	PortalWrite:    Client,
	RequestsManage: Manager,
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

	// P6. Invoices, lines and payments are read-only and manager+ through the generic API; every
	// write (draft from time, status transitions, payments, delete) goes through /api/w/invoices*
	// (internal/work/invoices.go), which snapshots money, locks and releases time entries, guards
	// status transitions and records activity. The counter is internal only.
	"invoices":         {Read: Manager, Write: None},
	"invoice_lines":    {Read: Manager, Write: None},
	"invoice_payments": {Read: Manager, Write: None},
	"invoice_counters": {Read: None, Write: None},

	// P7. The client-portal link table and the per-project feedback keys are read-only and
	// manager+ through the generic API; every write goes through /api/w/* (internal/work), which
	// derives the actor from the session, validates references and records activity. The public
	// key is not a secret, but the generic list handler knows nothing of project visibility.
	"client_contacts":       {Read: Manager, Write: None},
	"project_feedback_keys": {Read: Manager, Write: None},

	// Integrations. The config rows carry sealed credentials and the event log is per project;
	// the generic handlers can protect neither: closed. Everything goes through
	// /api/w/projects/{project}/integrations* and /github/* (internal/integrations).
	"project_integrations": {Read: None, Write: None},
	"github_events":        {Read: None, Write: None},
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
