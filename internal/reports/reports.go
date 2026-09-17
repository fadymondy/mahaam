// Package reports is Managy's own issue tracker: the reports + report_comments
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
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/fadymondy/managy/internal/app"
	"github.com/fadymondy/managy/internal/work"
)

// KeyPrefix is Managy's issue/task key prefix: MG-123.
const KeyPrefix = "MG-"

// PlatformSlug is the workspace that holds Managy's OWN bug reports (owner
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
		INSERT INTO workspaces (slug, name, created_by) VALUES ($1, 'Managy platform', 'system')
		ON CONFLICT (slug) DO NOTHING`, PlatformSlug); err != nil {
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
	ID, WorkspaceID, Key, Title                  string
	Number, SortOrder, AgentSeconds              int64
	IssueType, Status, State, Priority           string
	Body, Resolution, Route, PageURL, Selector   *string
	Screenshot, ConsoleLog, NetworkLog           *string
	Viewport, UserAgent, ReporterID              *string
	ProjectID                                    *string
	Source                                       string
	ClosedAt, StartedAt, FinishedAt              *time.Time
	HumanOnly                                    bool
	CreatedAt, UpdatedAt                         time.Time
}

const reportCols = `id, workspace_id, key, title, number, sort_order, agent_seconds, issue_type, status, state, priority,
	body, resolution, route, page_url, selector, screenshot, console_log, network_log, viewport, user_agent, reporter_id,
	project_id, source,
	closed_at, started_at, finished_at, human_only, created_at, updated_at`

func scanReport(row interface{ Scan(...any) error }) (*Report, error) {
	r := &Report{}
	err := row.Scan(&r.ID, &r.WorkspaceID, &r.Key, &r.Title, &r.Number, &r.SortOrder, &r.AgentSeconds,
		&r.IssueType, &r.Status, &r.State, &r.Priority,
		&r.Body, &r.Resolution, &r.Route, &r.PageURL, &r.Selector, &r.Screenshot, &r.ConsoleLog, &r.NetworkLog,
		&r.Viewport, &r.UserAgent, &r.ReporterID,
		&r.ProjectID, &r.Source,
		&r.ClosedAt, &r.StartedAt, &r.FinishedAt, &r.HumanOnly, &r.CreatedAt, &r.UpdatedAt)
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
	Status, State, IssueType, Q string
	// ProjectID limits to one project's issues; ReporterID to one reporter's
	// (both used by the client portal, which never sees other people's issues).
	ProjectID, ReporterID string
	Limit                 int
}

// List returns a workspace's reports, board order first.
func List(ctx context.Context, db *sql.DB, workspaceID string, f Filter) ([]*Report, error) {
	q := `SELECT ` + reportCols + ` FROM reports WHERE workspace_id = $1`
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
	if f.Q != "" {
		add("title ILIKE $%d", "%"+f.Q+"%")
	}
	if f.ProjectID != "" {
		add("project_id = $%d", f.ProjectID)
	}
	if f.ReporterID != "" {
		add("reporter_id = $%d", f.ReporterID)
	}
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 50
	}
	args = append(args, f.Limit)
	q += fmt.Sprintf(" ORDER BY sort_order ASC, created_at DESC LIMIT $%d", len(args))

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

// Find accepts the key (MG-12, case-insensitive) or the row id.
func Find(ctx context.Context, db *sql.DB, workspaceID, ref string) (*Report, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, sql.ErrNoRows
	}
	return scanReport(db.QueryRowContext(ctx,
		`SELECT `+reportCols+` FROM reports WHERE workspace_id = $1 AND (key = $2 OR id = $3)`,
		workspaceID, strings.ToUpper(ref), ref))
}

// NewReport is what an intake or tool supplies; the server allocates the key.
type NewReport struct {
	Title, IssueType, Status, Priority                       string
	Body, Route, PageURL, Selector, Screenshot               string
	ConsoleLog, NetworkLog, UserAgent, Viewport, ReporterID  string
	// ProjectID scopes the issue to a project (client portal / embed); empty for a
	// workspace-level report. Source is app | portal | embed.
	ProjectID, Source string
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
			                     viewport, reporter_id, project_id, source, closed_at, sort_order, agent_seconds, human_only)
			SELECT $1, $20::bigint, '`+KeyPrefix+`' || $20::bigint, $2, $3, $4, $5, $6, $7,
			       $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 0, 0, false
			RETURNING `+reportCols,
			workspaceID, strings.TrimSpace(n.Title), nullable(n.Body),
			firstNonEmpty(n.IssueType, "bug"), status, state, firstNonEmpty(n.Priority, "medium"),
			nullable(n.Route), nullable(n.PageURL), nullable(n.Selector), nullable(n.Screenshot),
			nullable(n.ConsoleLog), nullable(n.NetworkLog), nullable(n.UserAgent), nullable(n.Viewport),
			nullable(n.ReporterID), nullable(n.ProjectID), firstNonEmpty(n.Source, "app"), closed, num,
		))
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			continue // someone took this number between MAX and INSERT; recount
		}
		return r, err
	}
	return nil, errors.New("could not allocate an issue number")
}

// updatable is the column allowlist for Update — names are interpolated, so
// they must never come from input.
var updatable = map[string]bool{
	"status": true, "state": true, "priority": true, "issue_type": true, "resolution": true, "title": true,
	"body": true, "closed_at": true, "started_at": true, "finished_at": true, "agent_seconds": true, "sort_order": true,
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
	return c, nil
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
