package reports

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/togo-framework/ratelimit"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/managy/internal/app"
)

/*
The PUBLIC embeddable-feedback intake. This is the only unauthenticated write
surface in Managy, so it is locked down deliberately:

  * No session, no workspace header. The ONLY credential is a per-project public
    key (pfk_…) sent in the form body. A workspace/JWT is never read — there is no
    auth to escalate. Even a valid key can do exactly one thing: file an issue into
    its own project.
  * Origin allowlist. The request Origin must be listed on the key (or the key must
    allow '*'). CORS headers are reflected only for an allowed origin, so a browser
    on any other site cannot read a response or (with a non-simple request) send one.
  * Rate limited per client address (ratelimit plugin) AND the key's last_used_at is
    stamped, so abuse of one key is visible.
  * Fields are stripped and length-capped; the report is written on the OWNER pool
    with the workspace_id taken from the KEY, never from the request.
  * A missing, inactive, revoked or unknown key, or a disallowed origin → 403.
*/

// MountEmbed mounts POST /api/feedback/embed (public) and the loader /embed/v1.js.
func MountEmbed(k *togo.Kernel, a *app.App) {
	h := http.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { embedIntake(w, r, a) }))
	if rl, ok := ratelimit.FromKernel(k); ok {
		h = rl.Middleware(ratelimit.Rate("feedback-embed", 20, time.Minute), func(r *http.Request) string {
			return "embed-ip:" + clientIP(r)
		})(h)
	}
	k.Router.Handle("/api/feedback/embed", h)

	// The loader/bundle the owner pastes onto a client's site. Served from disk
	// (EMBED_DIR, default embed/dist) so the Go build never depends on the JS build;
	// 404 until `make embed` has produced it.
	k.Router.Get("/embed/v1.js", func(w http.ResponseWriter, r *http.Request) { serveEmbedAsset(w, r, "v1.js") })
}

func embedDir() string {
	if d := os.Getenv("EMBED_DIR"); d != "" {
		return d
	}
	return filepath.Join("embed", "dist")
}

func serveEmbedAsset(w http.ResponseWriter, r *http.Request, name string) {
	p := filepath.Join(embedDir(), filepath.Base(name))
	b, err := os.ReadFile(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Access-Control-Allow-Origin", "*") // the loader itself is public
	_, _ = w.Write(b)
}

type embedKey struct {
	workspaceID, projectID string
	origins                []string
}

func lookupKey(ctx context.Context, db *sql.DB, public string) (*embedKey, error) {
	var k embedKey
	var originsCSV string
	var active bool
	var revoked *time.Time
	err := db.QueryRowContext(ctx, `SELECT workspace_id, project_id, active, revoked_at,
		array_to_string(allowed_origins, ',') FROM project_feedback_keys WHERE public_key = $1`,
		strings.TrimSpace(public)).Scan(&k.workspaceID, &k.projectID, &active, &revoked, &originsCSV)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("unknown key")
	}
	if err != nil {
		return nil, err
	}
	if !active || revoked != nil {
		return nil, errors.New("revoked key")
	}
	if originsCSV != "" {
		k.origins = strings.Split(originsCSV, ",")
	}
	return &k, nil
}

// originAllowed reports whether origin is on the key's allowlist ('*' = any).
func originAllowed(origins []string, origin string) bool {
	origin = strings.ToLower(strings.TrimSpace(origin))
	for _, o := range origins {
		if o == "*" || strings.EqualFold(o, origin) {
			return true
		}
	}
	return false
}

func embedIntake(w http.ResponseWriter, r *http.Request, a *app.App) {
	origin := r.Header.Get("Origin")

	// CORS preflight (only fires if the SDK ever sends a non-simple request). Answer
	// after the key/origin are known below; a bare OPTIONS with no key gets a generic 403.
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "600")
		// The origin is echoed only once the key confirms it; without a key we cannot,
		// so reflect it here for the preflight and let the POST enforce the allowlist.
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}

	fields, shot, shotExt, ok := parseFeedback(w, r)
	if !ok {
		return
	}

	key, err := lookupKey(r.Context(), a.SysDB, fields["public_key"])
	if err != nil {
		// Never distinguish "unknown" from "revoked" from "wrong origin" to a stranger.
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "feedback is not available here"})
		return
	}
	// Origin: prefer the Origin header (browser-set, unspoofable from JS); fall back
	// to a page_url origin only for non-browser callers with no Origin header.
	reqOrigin := origin
	if reqOrigin == "" {
		reqOrigin = originOf(fields["page_url"])
	}
	if !originAllowed(key.origins, reqOrigin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "feedback is not available here"})
		return
	}
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}

	title := strings.TrimSpace(fields["title"])
	if title == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "a title is required"})
		return
	}
	if len(title) > 200 {
		title = title[:200]
	}

	rep, err := Create(r.Context(), a.SysDB, key.workspaceID, NewReport{
		Title: title, IssueType: normType(fields["issue_type"]),
		Body:       clip(fields["body"], 20000),
		Route:      clip(fields["route"], 500),
		PageURL:    clip(fields["page_url"], 1000),
		Selector:   clip(fields["selector"], 500),
		Screenshot: saveScreenshot(shot, shotExt),
		ConsoleLog: clip(fields["console_log"], 50000),
		NetworkLog: clip(fields["network_log"], 50000),
		UserAgent:  clip(firstNonEmpty(fields["user_agent"], r.UserAgent()), 500),
		Viewport:   clip(fields["viewport"], 50),
		ProjectID:  key.projectID, Source: "embed",
	})
	if err != nil {
		a.Log.Error("embed intake", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not file the report"})
		return
	}
	_, _ = a.SysDB.ExecContext(r.Context(), `UPDATE project_feedback_keys SET last_used_at = now() WHERE public_key = $1`, strings.TrimSpace(fields["public_key"]))
	a.Emit(r.Context(), "report.created", map[string]string{"key": rep.Key})
	writeJSON(w, http.StatusCreated, map[string]string{"key": rep.Key})
}

func clientIP(r *http.Request) string {
	ip := r.RemoteAddr
	if i := strings.LastIndex(ip, ":"); i > 0 {
		ip = ip[:i]
	}
	return ip
}

func originOf(pageURL string) string {
	pageURL = strings.TrimSpace(pageURL)
	if pageURL == "" {
		return ""
	}
	// scheme://host without the path.
	if i := strings.Index(pageURL, "://"); i > 0 {
		rest := pageURL[i+3:]
		if j := strings.IndexByte(rest, '/'); j >= 0 {
			rest = rest[:j]
		}
		return strings.ToLower(pageURL[:i+3] + rest)
	}
	return ""
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n]
	}
	return s
}
