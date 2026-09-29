// Package reports is Mahaam's own issue tracker: the reports + report_comments
// tables (same columns as fadymondy.com-v2's, plus workspace_id), fed by the
// "Report a problem" intake and worked through the MCP servers.
//
// Every function takes the database handle AND the workspace explicitly and
// puts `workspace_id = $n` in every query. Called with the RLS app pool (user
// MCP) the policy enforces the same thing a second time; called with the owner
// pool (admin MCP, intake) the explicit predicate is the only fence, which is
// why it is never omitted.
package reports

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/fadymondy/mahaam/internal/tenant"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/work"
)

// KeyPrefix is Mahaam's issue/task key prefix: MH-123. MG-123 keys minted before the
// rename still resolve (internal/work keyRe accepts both).
const KeyPrefix = "MH-"

// PlatformSlug is the workspace that holds Mahaam's OWN bug reports (owner
// decision 3: an own platform workspace rather than forwarding to
// fadymondy.com). No user is a member of it; the admin MCP reads it.
const PlatformSlug = "platform"

var (
	platformOnce sync.Mutex
	platformID   string
)

// EnsurePlatform creates the platform workspace if missing and returns its id.
func EnsurePlatform(ctx context.Context, a *app.App) (string, error) {
	platformOnce.Lock()
	defer platformOnce.Unlock()
	if platformID != "" {
		return platformID, nil
	}
	if _, err := a.SysDB.ExecContext(ctx, `
		INSERT INTO workspaces (slug, name, created_by, plan) VALUES ($1, 'Mahaam platform', 'system', 'unlimited')
		ON CONFLICT (slug) DO UPDATE SET plan = 'unlimited', status = 'active'
		WHERE workspaces.plan <> 'unlimited' OR workspaces.status <> 'active'`, PlatformSlug); err != nil {
		return "", err
	}
	if err := a.SysDB.QueryRowContext(ctx, `SELECT id FROM workspaces WHERE slug = $1`, PlatformSlug).Scan(&platformID); err != nil {
		return "", err
	}
	return platformID, nil
}

// PlatformID returns the platform workspace id (after EnsurePlatform).
func PlatformID(ctx context.Context, a *app.App) (string, error) { return EnsurePlatform(ctx, a) }

// Report is the subset of a reports row the tools and intake use.
type Report struct {
	// RequestState is set on a customer request (pending, accepted, declined, converted); nil on an issue.
	RequestState                               *string
	ID, WorkspaceID, Key, Title                string
	Number, SortOrder, AgentSeconds            int64
	AIInputTokens, AIOutputTokens, AICacheTokens, AICostMinor int64
	AICurrency                                 string
	IssueType, Status, State, Priority         string
	Body, Resolution, Route, PageURL, Selector *string
	Screenshot, ConsoleLog, NetworkLog         *string
	Viewport, UserAgent, ReporterID            *string
	ProjectID                                  *string
	// The issue's own agent strategy (fadymondy's issue-agent-settings): which
	// subagent / skill runs it, at which model and effort. Empty = the loop's default.
	AIModel, AIEffort, Agent, Skill *string
	Source                          string
	ClosedAt, StartedAt, FinishedAt *time.Time
	HumanOnly                       bool
	CreatedAt, UpdatedAt            time.Time
}

const reportCols = `id, workspace_id, key, title, number, sort_order, agent_seconds, issue_type, status, state, priority,
	body, resolution, route, page_url, selector, screenshot, console_log, network_log, viewport, user_agent, reporter_id,
	project_id, ai_model, ai_effort, agent, skill, source,
	closed_at, started_at, finished_at, human_only, created_at, updated_at, request_state,
	ai_input_tokens, ai_output_tokens, ai_cache_tokens, ai_cost_minor, ai_currency`

func scanReport(row interface{ Scan(...any) error }) (*Report, error) {
	r := &Report{}
	err := row.Scan(&r.ID, &r.WorkspaceID, &r.Key, &r.Title, &r.Number, &r.SortOrder, &r.AgentSeconds,
		&r.IssueType, &r.Status, &r.State, &r.Priority,
		&r.Body, &r.Resolution, &r.Route, &r.PageURL, &r.Selector, &r.Screenshot, &r.ConsoleLog, &r.NetworkLog,
		&r.Viewport, &r.UserAgent, &r.ReporterID,
		&r.ProjectID, &r.AIModel, &r.AIEffort, &r.Agent, &r.Skill, &r.Source,
		&r.ClosedAt, &r.StartedAt, &r.FinishedAt, &r.HumanOnly, &r.CreatedAt, &r.UpdatedAt, &r.RequestState,
		&r.AIInputTokens, &r.AIOutputTokens, &r.AICacheTokens, &r.AICostMinor, &r.AICurrency)
	return r, err
}

// Statuses mirrors fadymondy.com's board allowlist.
var Statuses = []string{"backlog", "todo", "in_progress", "waiting_approval", "in_review", "done"}

// ValidStatus reports whether s is a board status.
func ValidStatus(s string) bool {
	for _, v := range Statuses {
		if v == s {
			return true
		}
	}
	return false
}

// Filter narrows List.
type Filter struct {
	Status, State, IssueType, Q, Priority string
	// ProjectID limits to one project's issues; ReporterID to one reporter's
	// (both used by the client portal, which never sees other people's issues).
	ProjectID, ReporterID string
	// HideHumanOnly drops issues marked human_only (the agent queue's default).
	HideHumanOnly bool
	// IncludeRequests also lists customer requests that are not (yet) on the board —
	// pending, declined or converted. Off by default: the board and list_issues show
	// normal issues and ACCEPTED requests only (requests.go).
	IncludeRequests bool
	// CustomerView: the portal and the customer MCP (kept for clarity; board-born mirrors are
	// never listed anyway unless IncludeBoard).
	CustomerView bool
	// IncludeBoard also lists the issue rows that only mirror a board card (from_board). Off
	// everywhere by default: the issue tracker shows issues (SDK, portal, MCP, in-app, imports),
	// the board shows cards.
	IncludeBoard bool
	Limit        int
}

// List returns a workspace's reports, board order first.
func List(ctx context.Context, db *sql.DB, workspaceID string, f Filter) ([]*Report, error) {
	where, args := filterSQL(ctx, workspaceID, f)
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 50
	}
	args = append(args, f.Limit)
	q := `SELECT ` + reportCols + ` FROM reports WHERE ` + where + fmt.Sprintf(" ORDER BY sort_order ASC, created_at DESC LIMIT $%d", len(args))

	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("could not list issues: %w", err)
	}
	defer rows.Close()
	var out []*Report
	for rows.Next() {
		r, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// BoardPage is one page of a project board: the first N items of every column.
type BoardPage struct {
	Reports []*Report
	Column  map[string]string // issue key → column id
	Totals  map[string]int    // column id → items in it (all of them, not just this page)
}

// ListBoard returns the first perColumn items of each board column, board order, plus how many
// each column holds, so the board can load more as a column scrolls. An item sits in its card's
// column; one without a card sits in the first column of its stage (or the project's first).
func ListBoard(ctx context.Context, db *sql.DB, workspaceID string, f Filter, perColumn int) (*BoardPage, error) {
	where, args := filterSQL(ctx, workspaceID, f)
	args = append(args, perColumn)
	q := `SELECT ` + reportCols + `, board_col, col_total FROM (
		SELECT *, row_number() OVER (PARTITION BY board_col ORDER BY sort_order ASC, created_at DESC) AS rn,
			count(*) OVER (PARTITION BY board_col) AS col_total
		FROM (SELECT reports.*, COALESCE(
				(SELECT t.status_id FROM tasks t WHERE t.workspace_id = reports.workspace_id AND t.id = reports.task_id),
				(SELECT s.id FROM task_statuses s WHERE s.workspace_id = reports.workspace_id AND s.project_id = reports.project_id
					ORDER BY (s.stage = reports.status) DESC, s.position LIMIT 1), '') AS board_col
			FROM reports WHERE ` + where + `) cols
	) ranked WHERE rn <= $` + fmt.Sprint(len(args)) + ` ORDER BY sort_order ASC, created_at DESC`

	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("could not list the board: %w", err)
	}
	defer rows.Close()
	page := &BoardPage{Column: map[string]string{}, Totals: map[string]int{}}
	for rows.Next() {
		var col string
		var total int
		r, err := scanReport(extraScan{rows, []any{&col, &total}})
		if err != nil {
			return nil, err
		}
		page.Reports = append(page.Reports, r)
		page.Column[r.Key] = col
		page.Totals[col] = total
	}
	return page, rows.Err()
}

// extraScan appends trailing destinations to a scan, for queries that add columns after reportCols.
type extraScan struct {
	rows  *sql.Rows
	extra []any
}

func (e extraScan) Scan(dest ...any) error { return e.rows.Scan(append(dest, e.extra...)...) }

// filterSQL is the WHERE clause (without the keyword) and its args for a Filter.
func filterSQL(ctx context.Context, workspaceID string, f Filter) (string, []any) {
	q := `workspace_id = $1`
	args := []any{workspaceID}
	add := func(cond string, v any) {
		args = append(args, v)
		q += fmt.Sprintf(" AND "+cond, len(args))
	}
	if f.Status != "" {
		add("status = $%d", f.Status)
	}
	if f.State != "" {
		add("state = $%d", f.State)
	}
	if f.IssueType != "" {
		add("issue_type = $%d", f.IssueType)
	}
	if f.Priority != "" {
		add("priority = $%d", f.Priority)
	}
	if f.Q != "" {
		add("title ILIKE $%d", "%"+f.Q+"%")
	}
	if f.ProjectID != "" {
		add("project_id = $%d", f.ProjectID)
	}
	if f.ReporterID != "" {
		add("reporter_id = $%d", f.ReporterID)
	}
	if ids := scopedProjects(ctx); len(ids) > 0 {
		add("project_id = ANY($%d::text[])", ids)
	}
	if f.CustomerView || !f.IncludeBoard {
		q += " AND NOT from_board"
	}
	if f.HideHumanOnly {
		q += " AND NOT human_only"
	}
	if !f.IncludeRequests {
		q += " AND (request_state IS NULL OR request_state = 'accepted')"
	}
	return q, args
}

// Find accepts the key (MG-12, case-insensitive) or the row id.
func Find(ctx context.Context, db *sql.DB, workspaceID, ref string) (*Report, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, sql.ErrNoRows
	}
	r, err := scanReport(db.QueryRowContext(ctx,
		`SELECT `+reportCols+` FROM reports WHERE workspace_id = $1 AND (key = $2 OR id = $3)`,
		workspaceID, strings.ToUpper(ref), ref))
	if err == nil && !inScope(ctx, r.ProjectID) {
		return nil, sql.ErrNoRows
	}
	return r, err
}

// scopedProjects is the project limit of a project-scoped MCP token (tenant.Scope.ProjectIDs).
func scopedProjects(ctx context.Context) []string {
	if s, ok := tenant.From(ctx); ok {
		return s.ProjectIDs
	}
	return nil
}

// inScope reports whether an issue in project (nil = workspace-level) is reachable by the caller:
// always, unless a project-scoped token is calling and the issue is outside its projects.
func inScope(ctx context.Context, project *string) bool {
	ids := scopedProjects(ctx)
	if len(ids) == 0 {
		return true
	}
	if project == nil {
		return false
	}
	for _, id := range ids {
		if id == *project {
			return true
		}
	}
	return false
}

// NewReport is what an intake or tool supplies; the server allocates the key.
type NewReport struct {
	Title, IssueType, Status, Priority                      string
	Body, Route, PageURL, Selector, Screenshot              string
	ConsoleLog, NetworkLog, UserAgent, Viewport, ReporterID string
	// ProjectID scopes the issue to a project (client portal / embed); empty for a
	// workspace-level report. Source is app | portal | embed.
	ProjectID, Source string
	// RequestKind + DesiredOn file a customer REQUEST (request_state 'pending', off the
	// board) in the same INSERT, so it is never briefly an ordinary issue.
	RequestKind, DesiredOn string
}

func nullable(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// Create inserts a report and allocates MG-<n> as MAX+1 within the workspace,
// in the same statement, retrying on the unique (workspace_id, number) index —
// correct without a lock, and the client never chooses its own number
// (fadymondy.com FM-39).
func Create(ctx context.Context, db *sql.DB, workspaceID string, n NewReport) (*Report, error) {
	// Plan quotas (internal/limits): every issue — app, portal, embed, MCP, integration import —
	// is created here, so this is the one place they are enforced.
	if err := limits.Check(ctx, workspaceID, limits.Issues, 1); err != nil {
		return nil, err
	}
	if err := limits.Check(ctx, workspaceID, limits.IssuesMonth, 1); err != nil {
		return nil, err
	}
	// A project-scoped token files only into its projects.
	if ids := scopedProjects(ctx); len(ids) > 0 {
		if n.ProjectID == "" && len(ids) == 1 {
			n.ProjectID = ids[0]
		}
		pid := n.ProjectID
		if !inScope(ctx, &pid) || pid == "" {
			return nil, fmt.Errorf("this token is limited to its projects: pass one of them as project")
		}
	}
	status := firstNonEmpty(n.Status, "backlog")
	if !ValidStatus(status) {
		return nil, fmt.Errorf("unknown status %q", status)
	}
	state := "open"
	var closed any
	if status == "done" {
		state, closed = "closed", time.Now().UTC()
	}
	for attempt := 0; attempt < 5; attempt++ {
		// MG-<n> comes from the workspace's shared key counter (work.NextNumber), so a
		// report and a task never share a key.
		num, err := work.NextNumber(ctx, db, workspaceID)
		if err != nil {
			return nil, fmt.Errorf("could not allocate an issue number: %w", err)
		}
		r, err := scanReport(db.QueryRowContext(ctx, `
			INSERT INTO reports (workspace_id, number, key, title, body, issue_type, status, state, priority,
			                     route, page_url, selector, screenshot, console_log, network_log, user_agent,
			                     viewport, reporter_id, project_id, source, closed_at, sort_order, agent_seconds, human_only,
			                     request_state, request_kind, desired_on)
			SELECT $1, $20::bigint, '`+KeyPrefix+`' || $20::bigint, $2, $3, $4, $5, $6, $7,
			       $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 0, 0, false,
			       CASE WHEN $21::text IS NULL THEN NULL ELSE 'pending' END, $21::text, $22::date
			RETURNING `+reportCols,
			workspaceID, strings.TrimSpace(n.Title), nullable(n.Body),
			firstNonEmpty(n.IssueType, "bug"), status, state, firstNonEmpty(n.Priority, "medium"),
			nullable(n.Route), nullable(n.PageURL), nullable(n.Selector), nullable(n.Screenshot),
			nullable(n.ConsoleLog), nullable(n.NetworkLog), nullable(n.UserAgent), nullable(n.Viewport),
			nullable(n.ReporterID), nullable(n.ProjectID), firstNonEmpty(n.Source, "app"), closed, num,
			nullable(n.RequestKind), nullable(n.DesiredOn),
		))
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			continue // someone took this number between MAX and INSERT; recount
		}
		if err == nil {
			changed(ctx, r, "issue.created", nil)
		}
		return r, err
	}
	return nil, errors.New("could not allocate an issue number")
}

// updatable is the column allowlist for Update — names are interpolated, so
// they must never come from input.
var updatable = map[string]bool{
	"status": true, "state": true, "priority": true, "issue_type": true, "resolution": true, "title": true,
	"body": true, "human_only": true, "ai_model": true, "ai_effort": true, "agent": true, "skill": true, "closed_at": true, "started_at": true, "finished_at": true, "agent_seconds": true, "sort_order": true,
}

// Update sets fields (allowlisted columns) on one report in its workspace.
func Update(ctx context.Context, db *sql.DB, r *Report, fields map[string]any) error {
	set := []string{}
	args := []any{r.WorkspaceID, r.ID}
	for col, v := range fields {
		if !updatable[col] {
			return fmt.Errorf("reports: %q is not updatable", col)
		}
		args = append(args, v)
		set = append(set, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if len(set) == 0 {
		return nil
	}
	_, err := db.ExecContext(ctx,
		`UPDATE reports SET `+strings.Join(set, ", ")+`, updated_at = now() WHERE workspace_id = $1 AND id = $2`, args...)
	if err == nil {
		// A column change is "moved" when it changes where the issue sits on a board.
		event, extra := "issue.updated", map[string]any{}
		if st, ok := fields["status"].(string); ok {
			event, extra["status"] = "issue.moved", st
		} else if _, ok := fields["sort_order"]; ok {
			event = "issue.moved"
		}
		changed(ctx, r, event, extra)
	}
	return err
}

// Comment is one entry on a report's thread.
type Comment struct {
	ID         string
	AuthorKind string
	AuthorID   *string
	Body       string
	CreatedAt  time.Time
}

// Comments returns a report's thread, oldest first.
func Comments(ctx context.Context, db *sql.DB, workspaceID, reportID string) ([]Comment, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, author_kind, author_id, body, created_at FROM report_comments
		WHERE workspace_id = $1 AND report_id = $2 ORDER BY created_at ASC`, workspaceID, reportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Comment
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.AuthorKind, &c.AuthorID, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// AddComment appends to a report's thread and touches the report.
func AddComment(ctx context.Context, db *sql.DB, r *Report, authorID, kind, body string) error {
	_, err := AddCommentReturning(ctx, db, r, authorID, kind, body)
	return err
}

// AddCommentReturning appends to a report's thread, touches the report and
// returns the inserted comment (for the REST handler, which echoes it back).
func AddCommentReturning(ctx context.Context, db *sql.DB, r *Report, authorID, kind, body string) (*Comment, error) {
	c := &Comment{}
	if err := db.QueryRowContext(ctx, `
		INSERT INTO report_comments (workspace_id, report_id, author_id, author_kind, body)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, author_kind, author_id, body, created_at`,
		r.WorkspaceID, r.ID, nullable(authorID), kind, body,
	).Scan(&c.ID, &c.AuthorKind, &c.AuthorID, &c.Body, &c.CreatedAt); err != nil {
		return nil, fmt.Errorf("could not comment: %w", err)
	}
	_, _ = db.ExecContext(ctx, `UPDATE reports SET updated_at = now() WHERE workspace_id = $1 AND id = $2`, r.WorkspaceID, r.ID)
	changed(ctx, r, "issue.commented", nil)
	return c, nil
}

// OnChange hears about every issue that was created, changed or commented on, after the write has
// happened. server.Boot points it at the realtime broadcaster (work.Service.Broadcast, MH-351).
// nil means off, as in the OpenAPI export and tests that boot nothing.
var OnChange func(ctx context.Context, workspaceID string, projectID *string, event string, data map[string]any)

// changed reports one change to OnChange: the key and who did it, never the content (see
// internal/work/broadcast.go for why events carry ids only).
func changed(ctx context.Context, r *Report, event string, extra map[string]any) {
	if OnChange == nil || r == nil {
		return
	}
	data := map[string]any{"key": r.Key}
	for k, v := range extra {
		data[k] = v
	}
	if s, ok := tenant.From(ctx); ok && s.UserID != "" {
		data["actor_id"] = s.UserID
	}
	OnChange(ctx, r.WorkspaceID, r.ProjectID, event, data)
}

// FormatList renders reports compactly for a model.
func FormatList(rows []*Report) string {
	if len(rows) == 0 {
		return "No issues matched."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%d issue(s):\n\n", len(rows))
	for _, r := range rows {
		marker := ""
		if r.HumanOnly {
			marker = "  [HUMAN ONLY — do not work this]"
		}
		fmt.Fprintf(&b, "%s  [%s/%s/%s]  %s%s\n", r.Key, r.IssueType, r.Status, r.Priority, r.Title, marker)
		if r.Route != nil && *r.Route != "" {
			fmt.Fprintf(&b, "    route: %s\n", *r.Route)
		}
	}
	return b.String()
}

// FormatOne renders one report with its thread.
func FormatOne(r *Report, comments []Comment) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s — %s\n", r.Key, r.Title)
	fmt.Fprintf(&b, "type=%s status=%s state=%s priority=%s\n", r.IssueType, r.Status, r.State, r.Priority)
	for _, kv := range []struct {
		label string
		v     *string
	}{{"route", r.Route}, {"url", r.PageURL}, {"selector", r.Selector}, {"screenshot", r.Screenshot},
		{"viewport", r.Viewport}, {"user agent", r.UserAgent}, {"reporter", r.ReporterID}, {"resolution", r.Resolution}} {
		if kv.v != nil && *kv.v != "" {
			fmt.Fprintf(&b, "%s: %s\n", kv.label, *kv.v)
		}
	}
	if r.Body != nil && *r.Body != "" {
		fmt.Fprintf(&b, "\n%s\n", *r.Body)
	}
	fmt.Fprintf(&b, "\n%d comment(s):\n", len(comments))
	for _, c := range comments {
		fmt.Fprintf(&b, "  [%s %s] %s\n", c.AuthorKind, c.CreatedAt.Format(time.RFC3339), c.Body)
	}
	return b.String()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
