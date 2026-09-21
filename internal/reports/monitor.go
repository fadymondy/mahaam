package reports

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/ratelimit"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/limits"
)

/*
The PUBLIC backend error-monitoring intake: POST /api/monitor/{project}/envelope — a Sentry-shaped
DSN (see work.MonitorDSN, work/monitor_keys.go), server-to-server only, never meant to reach a
browser. Same deliberately low-power model as the Feedback SDK's embed intake (internal/reports/
embed.go): the ONLY credential is the public key in the body, it can do exactly one thing (file
into its own project), and a bad key answers the same generic error whether it is unknown, revoked,
or belongs to a different project than the path — never distinguished for a stranger.

A repeated fault (the same fingerprint, in the same project, still open, seen inside the last 14
days) does not file a new issue every time it fires: it bumps occurrence_count and last_seen_at on
the existing one. That is the whole point of a fingerprint — a hot-looping error must not flood the
board with a thousand identical cards.
*/

const dedupWindow = 14 * 24 * time.Hour

// MountMonitor mounts POST /api/monitor/{project}/envelope (public, guard allowlist — prefix
// matched, since {project} is a path segment, not something the guard's exact-match list can hold).
func MountMonitor(k *togo.Kernel, a *app.App) {
	h := http.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { monitorIntake(w, r, a) }))
	if rl, ok := ratelimit.FromKernel(k); ok {
		h = rl.Middleware(ratelimit.Rate("monitor-embed", 60, time.Minute), func(r *http.Request) string {
			return "monitor-ip:" + clientIP(r)
		})(h)
	}
	k.Router.Handle("/api/monitor/{project}/envelope", h)
}

type monitorEnvelope struct {
	PublicKey      string            `json:"public_key"`
	Level          string            `json:"level"`   // fatal | error | warning | info | debug
	Message        string            `json:"message"` // used when there is no exception (a log-style event)
	ExceptionType  string            `json:"exception_type"`
	ExceptionValue string            `json:"exception_value"`
	Stacktrace     string            `json:"stacktrace"` // pre-formatted text; the SDK renders its own frames
	Environment    string            `json:"environment"`
	Release        string            `json:"release"`
	ServerName     string            `json:"server_name"`
	Fingerprint    string            `json:"fingerprint,omitempty"` // override; default is computed below
	Tags           map[string]string `json:"tags"`
	Extra          map[string]any    `json:"extra"`
}

type monitorKeyRow struct {
	workspaceID, name string
}

func lookupMonitorKey(ctx context.Context, db *sql.DB, projectID, public string) (*monitorKeyRow, error) {
	var k monitorKeyRow
	var revoked *time.Time
	err := db.QueryRowContext(ctx, `
		SELECT workspace_id, name, revoked_at FROM project_monitor_keys WHERE public_key = $1 AND project_id = $2`,
		strings.TrimSpace(public), projectID,
	).Scan(&k.workspaceID, &k.name, &revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("unknown key")
	}
	if err != nil {
		return nil, err
	}
	if revoked != nil {
		return nil, errors.New("revoked key")
	}
	return &k, nil
}

func levelPriority(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "fatal":
		return "highest"
	case "error":
		return "high"
	case "warning":
		return "medium"
	default:
		return "low"
	}
}

// fingerprint groups occurrences of "the same fault" in one project: the exception type plus
// either the top line of the stack trace (most specific) or the message (for a log-style event
// with no exception), so two unrelated errors with the same TYPE but a different cause don't merge.
func fingerprint(projectID, excType, top, message string) string {
	sum := sha256.Sum256([]byte(projectID + "|" + excType + "|" + firstNonEmpty(top, message)))
	return hex.EncodeToString(sum[:16])
}

func topFrame(stacktrace string) string {
	for _, line := range strings.Split(stacktrace, "\n") {
		if l := strings.TrimSpace(line); l != "" {
			return l
		}
	}
	return ""
}

func formatBody(env monitorEnvelope) string {
	var b strings.Builder
	if env.ExceptionValue != "" {
		fmt.Fprintf(&b, "%s\n\n", env.ExceptionValue)
	}
	if env.Environment != "" || env.Release != "" || env.ServerName != "" {
		fmt.Fprintf(&b, "environment: %s · release: %s · server: %s\n\n", firstNonEmpty(env.Environment, "—"), firstNonEmpty(env.Release, "—"), firstNonEmpty(env.ServerName, "—"))
	}
	for k, v := range env.Tags {
		fmt.Fprintf(&b, "%s: %s\n", k, v)
	}
	if len(env.Extra) > 0 {
		if raw, err := json.MarshalIndent(env.Extra, "", "  "); err == nil {
			fmt.Fprintf(&b, "\nextra:\n```\n%s\n```\n", raw)
		}
	}
	if env.Stacktrace != "" {
		fmt.Fprintf(&b, "\n```\n%s\n```\n", clip(env.Stacktrace, 20000))
	}
	return b.String()
}

func monitorIntake(w http.ResponseWriter, r *http.Request, a *app.App) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	projectID := chi.URLParam(r, "project")
	var env monitorEnvelope
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&env); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "malformed JSON"})
		return
	}
	key, err := lookupMonitorKey(r.Context(), a.SysDB, projectID, env.PublicKey)
	if err != nil {
		// Never distinguish "unknown" from "revoked" from "wrong project" to a stranger.
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "monitoring is not available for this DSN"})
		return
	}
	var wsStatus string
	if err := a.SysDB.QueryRowContext(r.Context(), `SELECT status FROM workspaces WHERE id = $1`, key.workspaceID).Scan(&wsStatus); err != nil || wsStatus != "active" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "monitoring is not available for this DSN"})
		return
	}
	if err := intakePreflight(r.Context(), key.workspaceID, 0); err != nil {
		if x, ok := limits.As(err); ok {
			writeJSON(w, x.Status, map[string]string{"error": "monitoring is not available right now", "code": "quota_exceeded"})
			return
		}
		a.Log.Error("monitor intake", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record the event"})
		return
	}

	title := clip(firstNonEmpty(joinType(env.ExceptionType, env.ExceptionValue), env.Message, "Reported error"), 200)
	fp := strings.TrimSpace(env.Fingerprint)
	if fp == "" {
		fp = fingerprint(projectID, env.ExceptionType, topFrame(env.Stacktrace), env.Message)
	}
	body := formatBody(env)

	// Dedup: an OPEN issue with the same fingerprint, seen inside the window, gets bumped instead
	// of a new card. state = the issue lifecycle column, distinct from the board's status/category.
	var existingKey string
	err = a.SysDB.QueryRowContext(r.Context(), `
		UPDATE reports SET occurrence_count = occurrence_count + 1, last_seen_at = now(), updated_at = now()
		WHERE workspace_id = $1 AND project_id = $2 AND monitor_fingerprint = $3
		  AND state = 'open' AND last_seen_at > $4
		RETURNING key`,
		key.workspaceID, projectID, fp, time.Now().Add(-dedupWindow),
	).Scan(&existingKey)
	if err == nil {
		writeJSON(w, http.StatusOK, map[string]string{"key": existingKey, "status": "updated"})
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		a.Log.Error("monitor intake: dedup update", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record the event"})
		return
	}

	rep, err := Create(r.Context(), a.SysDB, key.workspaceID, NewReport{
		Title: title, IssueType: "bug", Priority: levelPriority(env.Level),
		Body: clip(body, 20000), ProjectID: projectID, Source: "monitor",
	})
	if err != nil {
		if _, ok := limits.As(err); ok {
			writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": "monitoring is not available right now", "code": "quota_exceeded"})
			return
		}
		a.Log.Error("monitor intake: create", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record the event"})
		return
	}
	if _, err := a.SysDB.ExecContext(r.Context(), `UPDATE reports SET monitor_fingerprint = $1, last_seen_at = now() WHERE id = $2`, fp, rep.ID); err != nil {
		a.Log.Error("monitor intake: stamp fingerprint", "err", err)
	}
	_, _ = a.SysDB.ExecContext(r.Context(), `UPDATE project_monitor_keys SET last_used_at = now() WHERE public_key = $1`, strings.TrimSpace(env.PublicKey))
	a.Emit(r.Context(), "report.created", map[string]string{"key": rep.Key})
	writeJSON(w, http.StatusCreated, map[string]string{"key": rep.Key, "status": "created"})
}

func joinType(excType, excValue string) string {
	excType, excValue = strings.TrimSpace(excType), strings.TrimSpace(excValue)
	switch {
	case excType == "" && excValue == "":
		return ""
	case excType == "":
		return excValue
	case excValue == "":
		return excType
	default:
		return excType + ": " + excValue
	}
}
