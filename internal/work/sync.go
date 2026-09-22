package work

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Delta sync: "what changed since X", for a client that was offline.

One endpoint for every entity rather than an `updated_since` on five list routes, because a client
needs ONE cursor. Five cursors means five ways to be half-synced, and the bug that produces —
a task referring to a project the client has not heard of — appears hours later on someone's phone
with no way to reproduce it.

The interesting part is the cursor, and it is interesting for a reason that is easy to miss.
*/

// cursorSafety is subtracted from the cursor this endpoint hands back, and it is the whole reason
// this file needs a comment.
//
// The obvious cursor is now(). It is wrong. `updated_at` is set when a row is written, but the row
// only becomes visible when its transaction COMMITS — and those are different moments. A
// transaction that starts at 12:00:00, writes a row stamped 12:00:00 and commits at 12:00:03 is
// invisible to a sync running at 12:00:01. Hand that client a cursor of 12:00:01 and the row is
// never seen again: its updated_at is behind the cursor for ever.
//
// So the cursor is deliberately rewound. A client re-reads a few seconds of changes it already
// has, which costs nothing because sync is an upsert by id, and it stops the one failure that
// cannot be recovered from without a full reload nobody knows to trigger.
//
// Five seconds is comfortably longer than any transaction here — the long ones are reports, which
// write nothing — and short enough that the overlap stays a handful of rows.
const cursorSafety = 5 * time.Second

// SyncPage is one delta: the rows that changed, and the ones that stopped existing.
type SyncPage struct {
	Projects    []SyncProject   `json:"projects"`
	Tasks       []SyncTask      `json:"tasks"`
	Issues      []SyncIssue     `json:"issues"`
	Comments    []SyncComment   `json:"comments"`
	TimeEntries []SyncTimeEntry `json:"time_entries"`
	Deletions   []Tombstone     `json:"deletions"`
	// NextSince is what to pass to the next call. Always use it rather than a local clock: the
	// client's clock is not the database's, and the rewind above is baked into this value.
	NextSince time.Time `json:"next_since"`
	// Truncated says the page hit its row cap and there is more. Call again with NextSince.
	Truncated bool `json:"truncated"`
}

// Tombstone is a row that was deleted. `entity` is the table name.
type Tombstone struct {
	Entity    string    `json:"entity"`
	ID        string    `json:"id"`
	DeletedAt time.Time `json:"deleted_at"`
}

// The sync shapes are deliberately leaner than the display ones, and deliberately NOT the same
// types. Reusing Project or TimeEntry here would couple a delta to whatever joins a detail view
// happens to need today, and would ship a 20 KB console log per issue row. A client syncs
// identity and state, then fetches detail for what it actually opens.
type SyncProject struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	Status    string    `json:"status"`
	ClientID  *string   `json:"client_id"`
	Archived  bool      `json:"archived"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SyncTask struct {
	ID        string     `json:"id"`
	Key       string     `json:"key"`
	ProjectID string     `json:"project_id"`
	StatusID  string     `json:"status_id"`
	Title     string     `json:"title"`
	Priority  string     `json:"priority"`
	DueAt     *time.Time `json:"due_at"`
	Completed *time.Time `json:"completed_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type SyncIssue struct {
	Key       string    `json:"key"`
	Title     string    `json:"title"`
	Status    string    `json:"status"`
	State     string    `json:"state"`
	Priority  string    `json:"priority"`
	IssueType string    `json:"issue_type"`
	ProjectID *string   `json:"project_id"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SyncComment struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"task_id"`
	AuthorID  *string   `json:"author_id"`
	Body      string    `json:"body"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SyncTimeEntry struct {
	ID          string     `json:"id"`
	ProjectID   *string    `json:"project_id"`
	TaskID      *string    `json:"task_id"`
	Description string     `json:"description"`
	StartedAt   time.Time  `json:"started_at"`
	EndedAt     *time.Time `json:"ended_at"`
	// Null while the timer is still running: the duration is generated when it stops. A client
	// that needs a live figure computes it from started_at, as the timer UI already does.
	DurationS *int64    `json:"duration_s"`
	Billable  bool      `json:"billable"`
	UpdatedAt time.Time `json:"updated_at"`
}

// syncLimit caps each collection in one page. A workspace that has been offline for a month
// should not try to arrive in a single response.
const syncLimit = 500

// Sync returns everything in the caller's workspace that changed after `since`, plus tombstones.
//
// A zero `since` means "everything", which is how a client bootstraps — same code path as a delta,
// so the first sync is exercised by every test of the second.
func (sv *Service) Sync(ctx context.Context, since time.Time) (*SyncPage, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}

	// Taken BEFORE reading, never after. A cursor sampled at the end would exclude rows committed
	// while this function was running, and those are exactly the rows most likely to matter.
	var nextSince time.Time
	if err := sv.DB.QueryRowContext(ctx, `SELECT now()`).Scan(&nextSince); err != nil {
		return nil, err
	}
	nextSince = nextSince.Add(-cursorSafety)

	page := &SyncPage{
		Projects:    []SyncProject{},
		Tasks:       []SyncTask{},
		Issues:      []SyncIssue{},
		Comments:    []SyncComment{},
		TimeEntries: []SyncTimeEntry{},
		Deletions:   []Tombstone{},
		NextSince:   nextSince,
	}

	for _, part := range []func(context.Context, *tenant.Scope, time.Time, *SyncPage) error{
		sv.syncProjects, sv.syncTasks, sv.syncIssues, sv.syncComments, sv.syncTimeEntries, sv.syncDeletions,
	} {
		if err := part(ctx, s, since, page); err != nil {
			return nil, err
		}
	}
	return page, nil
}

// sinceArgs: a zero time means "from the beginning". Saying so with a separate query, rather
// than comparing every row against year 1, keeps the planner on the (workspace_id, updated_at)
// index instead of a sequential scan of the table.
func sinceArgs(ws string, since time.Time) (string, []any) {
	if since.IsZero() {
		return "", []any{ws}
	}
	return " AND updated_at > $2", []any{ws, since.UTC()}
}

// ---- collectors ---------------------------------------------------------------------------
//
// One per entity, each a plain query against its own table. No joins: a delta is identity and
// state, and anything that needs a join belongs in the detail route the client calls for the one
// row it opened.

func (sv *Service) syncProjects(ctx context.Context, s *tenant.Scope, since time.Time, page *SyncPage) error {
	where, args := sinceArgs(s.WorkspaceID, since)
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, name, color, status, client_id, archived_at IS NOT NULL, updated_at
		FROM projects WHERE workspace_id = $1`+where+` ORDER BY updated_at LIMIT 500`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var p SyncProject
		if err := rows.Scan(&p.ID, &p.Name, &p.Color, &p.Status, &p.ClientID, &p.Archived, &p.UpdatedAt); err != nil {
			return err
		}
		page.Projects = append(page.Projects, p)
	}
	page.Truncated = page.Truncated || len(page.Projects) == syncLimit
	return rows.Err()
}

func (sv *Service) syncTasks(ctx context.Context, s *tenant.Scope, since time.Time, page *SyncPage) error {
	where, args := sinceArgs(s.WorkspaceID, since)
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, key, project_id, status_id, title, priority, due_at, completed_at, updated_at
		FROM tasks WHERE workspace_id = $1`+where+` ORDER BY updated_at LIMIT 500`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var t SyncTask
		if err := rows.Scan(&t.ID, &t.Key, &t.ProjectID, &t.StatusID, &t.Title, &t.Priority, &t.DueAt, &t.Completed, &t.UpdatedAt); err != nil {
			return err
		}
		page.Tasks = append(page.Tasks, t)
	}
	page.Truncated = page.Truncated || len(page.Tasks) == syncLimit
	return rows.Err()
}

func (sv *Service) syncIssues(ctx context.Context, s *tenant.Scope, since time.Time, page *SyncPage) error {
	where, args := sinceArgs(s.WorkspaceID, since)
	rows, err := sv.DB.QueryContext(ctx, `SELECT key, title, status, state, priority, issue_type, project_id, updated_at
		FROM reports WHERE workspace_id = $1`+where+` ORDER BY updated_at LIMIT 500`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var i SyncIssue
		if err := rows.Scan(&i.Key, &i.Title, &i.Status, &i.State, &i.Priority, &i.IssueType, &i.ProjectID, &i.UpdatedAt); err != nil {
			return err
		}
		page.Issues = append(page.Issues, i)
	}
	page.Truncated = page.Truncated || len(page.Issues) == syncLimit
	return rows.Err()
}

func (sv *Service) syncComments(ctx context.Context, s *tenant.Scope, since time.Time, page *SyncPage) error {
	where, args := sinceArgs(s.WorkspaceID, since)
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, task_id, author_id, body, updated_at
		FROM task_comments WHERE workspace_id = $1`+where+` ORDER BY updated_at LIMIT 500`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var c SyncComment
		if err := rows.Scan(&c.ID, &c.TaskID, &c.AuthorID, &c.Body, &c.UpdatedAt); err != nil {
			return err
		}
		page.Comments = append(page.Comments, c)
	}
	page.Truncated = page.Truncated || len(page.Comments) == syncLimit
	return rows.Err()
}

func (sv *Service) syncTimeEntries(ctx context.Context, s *tenant.Scope, since time.Time, page *SyncPage) error {
	where, args := sinceArgs(s.WorkspaceID, since)
	// Only the caller's own entries. A member must not learn what everyone else worked on just
	// because they asked for a delta rather than a list — the list routes scope by user and this
	// has to agree with them.
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, project_id, task_id, description, started_at, ended_at,
		duration_s, billable, updated_at FROM time_entries
		WHERE workspace_id = $1 AND user_id = `+userArg(since)+where+` ORDER BY updated_at LIMIT 500`,
		append(args, s.UserID)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var e SyncTimeEntry
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.TaskID, &e.Description, &e.StartedAt, &e.EndedAt,
			&e.DurationS, &e.Billable, &e.UpdatedAt); err != nil {
			return err
		}
		page.TimeEntries = append(page.TimeEntries, e)
	}
	page.Truncated = page.Truncated || len(page.TimeEntries) == syncLimit
	return rows.Err()
}

// userArg: the user placeholder lands after the workspace and, when present, the since value.
func userArg(since time.Time) string {
	if since.IsZero() {
		return "$2"
	}
	return "$3"
}

func (sv *Service) syncDeletions(ctx context.Context, s *tenant.Scope, since time.Time, page *SyncPage) error {
	// A first sync has nothing to forget. Sending every tombstone a workspace ever produced would
	// be a large answer to a question nobody asked.
	if since.IsZero() {
		return nil
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT entity, entity_id, deleted_at FROM deletions
		WHERE workspace_id = $1 AND deleted_at > $2 ORDER BY deleted_at LIMIT 500`, s.WorkspaceID, since.UTC())
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var t Tombstone
		if err := rows.Scan(&t.Entity, &t.ID, &t.DeletedAt); err != nil {
			return err
		}
		page.Deletions = append(page.Deletions, t)
	}
	page.Truncated = page.Truncated || len(page.Deletions) == syncLimit
	return rows.Err()
}

// ParseSince reads the `since` query parameter: RFC 3339, or empty for a first sync.
//
// A malformed value is refused rather than treated as "from the beginning". Silently bootstrapping
// would look like it worked and quietly ship the whole workspace to a client that only wanted the
// last minute — on someone's phone data.
func ParseSince(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}, invalid("since must be an RFC 3339 timestamp, or empty for a first sync")
	}
	return t, nil
}

func (r routes) sync() {
	do(r, http.MethodGet, "/api/w/sync", "w-sync", "What changed since a cursor: rows plus tombstones (offline clients)", "Sync", 0,
		func(ctx context.Context, in *struct {
			WS
			Since string `query:"since" doc:"next_since from the previous call (RFC 3339). Empty for a first sync."`
		}) (*SyncPage, error) {
			since, err := ParseSince(in.Since)
			if err != nil {
				return nil, err
			}
			return r.sv.Sync(ctx, since)
		})
}
