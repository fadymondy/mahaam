// Package work is Managy's project-management domain: clients, teams, projects (members,
// attached teams, statuses), tasks (assignees, labels, checklist, subtasks), comments with
// @mentions, attachments and the activity feed.
//
// The REST handlers (routes.go) and the user MCP tools call the same functions, so a browser
// session and an agent go through one authorization path and one activity log.
//
// Every function reads the caller from tenant.Scope on ctx and runs on the RLS app pool, and
// still puts `workspace_id = $1` in every statement: RLS is the backstop, not the only fence.
// Every write runs in a transaction that also appends its activity entry, so the feed cannot
// disagree with the data, and the actor always comes from the session or the MCP token.
package work

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/managy/internal/app"
	"github.com/fadymondy/managy/internal/authz"
	"github.com/fadymondy/managy/internal/tenant"
)

// Service carries the handles the domain needs. Build it with New.
type Service struct {
	DB    *sql.DB // app pool (RLS enforced) — everything tenant-scoped
	Sys   *sql.DB // owner pool — only to read member emails (the app role has no grant on users)
	Store togo.Storage
	Log   *slog.Logger
}

// New builds the service from the app container. a may be nil (OpenAPI export).
func New(a *app.App) *Service {
	if a == nil {
		return &Service{}
	}
	return &Service{DB: a.SQLDB, Sys: a.SysDB, Store: a.Storage, Log: a.Log}
}

// ---- errors ----------------------------------------------------------------

// Error is a domain error whose message is safe to show to the caller, with the HTTP status
// it maps to. MCP tools return the message in-band.
type Error struct {
	Status int
	Msg    string
}

func (e *Error) Error() string { return e.Msg }

func notFound(what string) error { return &Error{http.StatusNotFound, what + " not found"} }
func forbidden(msg string) error { return &Error{http.StatusForbidden, msg} }
func conflict(msg string) error  { return &Error{http.StatusConflict, msg} }
func invalid(format string, args ...any) error {
	return &Error{http.StatusUnprocessableEntity, fmt.Sprintf(format, args...)}
}

// AsError maps err to a caller-safe Error, or reports false for an internal failure (which
// the caller logs and answers generically).
func AsError(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	if errors.Is(err, sql.ErrNoRows) {
		return &Error{http.StatusNotFound, "not found"}, true
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23505":
			return &Error{http.StatusConflict, "that already exists"}, true
		case "23503":
			return &Error{http.StatusUnprocessableEntity, "a referenced item does not exist in this workspace"}, true
		case "23514":
			return &Error{http.StatusUnprocessableEntity, "a value is out of range"}, true
		}
	}
	return nil, false
}

// ---- caller and authorization ---------------------------------------------

func caller(ctx context.Context) (*tenant.Scope, error) {
	s, ok := tenant.From(ctx)
	if !ok || s.WorkspaceID == "" || s.UserID == "" {
		return nil, notFound("workspace")
	}
	return s, nil
}

func atLeast(s *tenant.Scope, r authz.Role) bool { return authz.Role(s.Role).AtLeast(r) }

func require(s *tenant.Scope, action string) error {
	if authz.Can(s.Role, action) {
		return nil
	}
	return forbidden(fmt.Sprintf("your role (%s) cannot do this (%s)", s.Role, action))
}

// querier is satisfied by *sql.DB and *sql.Tx.
type querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type scanner interface{ Scan(dest ...any) error }

// tx runs fn in a transaction on the app pool. The RLS connection wrapper scopes every
// statement of the transaction to the workspace on ctx.
func (sv *Service) tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	if sv.DB == nil {
		return errors.New("work: database unavailable")
	}
	tx, err := sv.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// ---- request metadata for activity entries ---------------------------------

// RequestMeta is the request context an activity entry carries.
type RequestMeta struct{ IP, UserAgent string }

type metaKey struct{}

// MetaFrom returns the request metadata on ctx (zero value if none).
func MetaFrom(ctx context.Context) RequestMeta {
	m, _ := ctx.Value(metaKey{}).(RequestMeta)
	return m
}

// MetaMiddleware records the client address and user agent for activity entries.
// Deliberately RemoteAddr, not X-Forwarded-For: forwarding headers are client-settable,
// the same flaw that makes togo audit's X-User-Id causer spoofable.
func MetaMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if host, _, err := net.SplitHostPort(ip); err == nil {
			ip = host
		}
		ctx := context.WithValue(r.Context(), metaKey{}, RequestMeta{IP: ip, UserAgent: r.UserAgent()})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ---- values -----------------------------------------------------------------

// Palette is the closed list of colour keys a project, team, status or label may carry. The
// web maps each to theme tokens (web/lib/palette.ts); a raw colour is never stored.
var Palette = []string{"violet", "blue", "teal", "green", "amber", "orange", "red", "pink", "slate"}

func pickColor(in *string, def string) (string, error) {
	if in == nil || strings.TrimSpace(*in) == "" {
		return def, nil
	}
	c := strings.ToLower(strings.TrimSpace(*in))
	for _, p := range Palette {
		if p == c {
			return c, nil
		}
	}
	return "", invalid("unknown colour %q (use one of: %s)", c, strings.Join(Palette, ", "))
}

func oneOf(field, v string, allowed ...string) error {
	for _, a := range allowed {
		if v == a {
			return nil
		}
	}
	return invalid("%s must be one of: %s", field, strings.Join(allowed, ", "))
}

// trimmed returns the trimmed value and whether the field was sent at all.
func trimmed(p *string) (string, bool) {
	if p == nil {
		return "", false
	}
	return strings.TrimSpace(*p), true
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func parseDay(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, invalid("%q is not a date (YYYY-MM-DD)", s)
	}
	return &t, nil
}

// parseWhen accepts RFC 3339 or a bare date (midnight UTC).
func parseWhen(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		u := t.UTC()
		return &u, nil
	}
	return parseDay(s)
}

func dayString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func splitIDs(s string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, ",")
}

// dedupe trims, drops empties and duplicates, keeping order.
func dedupe(ids []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] || strings.Contains(id, ",") {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// ---- keys ---------------------------------------------------------------------

// KeyPrefix is the task/issue key prefix: MG-123.
const KeyPrefix = "MG-"

// NextNumber allocates the next MG-<n> of a workspace. One sequence is shared by tasks and
// reports so a key always names exactly one thing. The first call seeds the counter from
// whatever already exists. INSERT … ON CONFLICT DO UPDATE takes the row lock, so concurrent
// callers serialise on it and never receive the same number.
func NextNumber(ctx context.Context, q querier, workspaceID string) (int64, error) {
	var n int64
	err := q.QueryRowContext(ctx, `
		INSERT INTO key_counters (workspace_id, value)
		VALUES ($1, 1 + GREATEST(
			(SELECT COALESCE(MAX(number), 0) FROM tasks WHERE workspace_id = $1),
			(SELECT COALESCE(MAX(number), 0) FROM reports WHERE workspace_id = $1)))
		ON CONFLICT (workspace_id) DO UPDATE SET value = key_counters.value + 1, updated_at = now()
		RETURNING value`, workspaceID).Scan(&n)
	return n, err
}

var keyRe = regexp.MustCompile(`(?i)^MG-(\d+)$`)

// parseRef splits a task reference: "MG-12" or "12" → number; anything else → id.
func parseRef(ref string) (id string, number int64) {
	ref = strings.TrimSpace(ref)
	if m := keyRe.FindStringSubmatch(ref); m != nil {
		n, _ := strconv.ParseInt(m[1], 10, 64)
		return "", n
	}
	if n, err := strconv.ParseInt(ref, 10, 64); err == nil && n > 0 {
		return "", n
	}
	return ref, 0
}

// ---- fractional positions -------------------------------------------------------

// between returns a position that sorts at index among the ascending positions in list.
// ok=false means the gap there is exhausted and the list must be renumbered first.
func between(list []float64, index int) (float64, bool) {
	n := len(list)
	if index < 0 || index > n {
		index = n
	}
	switch {
	case n == 0:
		return 1024, true
	case index == 0:
		return list[0] - 1024, true
	case index == n:
		return list[n-1] + 1024, true
	}
	a, b := list[index-1], list[index]
	if b-a < 1e-6 {
		return 0, false
	}
	return (a + b) / 2, true
}
