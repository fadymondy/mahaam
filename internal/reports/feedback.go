package reports

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/togo-framework/auth"
	"github.com/togo-framework/ratelimit"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
MountFeedback is the intake for the "Report a problem" dialog.

Wire contract (plan, "Feedback SDK"): POST {endpoint} with title, body,
issue_type, page_url, route, selector, screenshot (file), console_log,
network_log, user_agent, viewport, meta — exactly the reports columns, so the
shared packages/feedback-sdk can post here unchanged once it exists. Accepts
multipart/form-data (the SDK's shape, with a screenshot) or JSON.

Signed-in only (server/guard.go). Reports land in the PLATFORM workspace — they
are about Mahaam itself, not about the reporter's workspace — so the reporter
cannot read them back through their own workspace; the admin MCP triages them.
*/
func MountFeedback(k *togo.Kernel, a *app.App) {
	h := http.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { intake(w, r, a) }))
	if rl, ok := ratelimit.FromKernel(k); ok {
		h = rl.Middleware(ratelimit.Rate("feedback", 10, time.Minute), func(r *http.Request) string {
			if id, ok := auth.IdentityFrom(r.Context()); ok && id != nil {
				return "feedback:" + id.ID
			}
			return "feedback-ip:" + r.RemoteAddr
		})(h)
	}
	k.Router.Handle("/api/feedback", h)
}

const maxScreenshot = 8 << 20

// parseFeedback reads the wire contract (multipart with an optional screenshot,
// or JSON) into a flat string map plus the screenshot bytes. Shared by the in-app
// intake, the client portal and the public embed endpoint so all three accept the
// same "Report a problem" payload. On a client error it writes the response and
// returns ok=false.
func parseFeedback(w http.ResponseWriter, r *http.Request) (fields map[string]string, shot []byte, shotExt string, ok bool) {
	fields = map[string]string{}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(maxScreenshot + 1<<20); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read the form"})
			return nil, nil, "", false
		}
		for k, v := range r.MultipartForm.Value {
			if len(v) > 0 {
				fields[k] = v[0]
			}
		}
		if f, hdr, err := r.FormFile("screenshot"); err == nil {
			defer f.Close()
			switch hdr.Header.Get("Content-Type") {
			case "image/png":
				shotExt = ".png"
			case "image/jpeg":
				shotExt = ".jpg"
			case "image/webp":
				shotExt = ".webp"
			default:
				writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "the screenshot must be PNG, JPEG or WebP"})
				return nil, nil, "", false
			}
			shot, _ = io.ReadAll(io.LimitReader(f, maxScreenshot+1))
			if len(shot) > maxScreenshot {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "the screenshot is larger than 8 MB"})
				return nil, nil, "", false
			}
		}
	} else {
		var body map[string]any
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return nil, nil, "", false
		}
		for k, v := range body {
			if s, ok := v.(string); ok {
				fields[k] = s
			}
		}
	}
	return fields, shot, shotExt, true
}

// saveScreenshot writes the screenshot bytes under storage/feedback and returns
// the stored relative path, or "" if there was nothing to write.
func saveScreenshot(shot []byte, shotExt string) string {
	if len(shot) == 0 {
		return ""
	}
	name := randomName() + shotExt
	dir := filepath.Join(storageDir(), "feedback")
	if err := os.MkdirAll(dir, 0o755); err == nil && os.WriteFile(filepath.Join(dir, name), shot, 0o644) == nil {
		return "feedback/" + name
	}
	return ""
}

func intake(w http.ResponseWriter, r *http.Request, a *app.App) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	id, ok := auth.IdentityFrom(r.Context())
	if !ok || id == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	fields, shot, shotExt, ok := parseFeedback(w, r)
	if !ok {
		return
	}

	title := strings.TrimSpace(fields["title"])
	if title == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "a title is required"})
		return
	}
	if len(title) > 200 {
		title = title[:200]
	}
	issueType := fields["issue_type"]
	switch issueType {
	case "bug", "feature", "task":
	default:
		issueType = "bug"
	}

	// Where the report lands: the reporter's CURRENT workspace when the request
	// names one (X-Workspace-ID) and the reporter is a member of it — so a
	// workspace's own "Report a problem" intake is triaged inside that workspace.
	// With no workspace named (Mahaam's own-platform bug reports, and the
	// feedback-sdk's default), it lands in the platform workspace as before.
	target, err := PlatformID(r.Context(), a)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "intake unavailable"})
		return
	}
	if ref := strings.TrimSpace(r.Header.Get(tenant.Header)); ref != "" {
		if sc, err := tenant.Resolve(r.Context(), a.SysDB, id.ID, ref); err == nil {
			target = sc.WorkspaceID
		}
	}

	screenshot := saveScreenshot(shot, shotExt)

	// The reports table has no `meta` column (it mirrors fadymondy.com's), so the
	// reporter's context travels in the body, where a human and an agent both see it.
	body := strings.TrimSpace(fields["body"])
	body += "\n\n---\nReported by " + id.Email + " via the in-app dialog."
	if m := strings.TrimSpace(fields["meta"]); m != "" {
		var pretty any
		if json.Unmarshal([]byte(m), &pretty) == nil {
			b, _ := json.MarshalIndent(pretty, "", "  ")
			body += "\n\n```json\n" + string(b) + "\n```"
		}
	}

	rep, err := Create(r.Context(), a.SysDB, target, NewReport{
		Title: title, IssueType: issueType, Body: strings.TrimSpace(body),
		Route: fields["route"], PageURL: fields["page_url"], Selector: fields["selector"], Screenshot: screenshot,
		ConsoleLog: fields["console_log"], NetworkLog: fields["network_log"],
		UserAgent: firstNonEmpty(fields["user_agent"], r.UserAgent()), Viewport: fields["viewport"],
		ReporterID: id.ID,
	})
	if err != nil {
		a.Log.Error("feedback intake", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not file the report"})
		return
	}
	a.Emit(r.Context(), "report.created", map[string]string{"key": rep.Key})
	writeJSON(w, http.StatusCreated, map[string]string{"key": rep.Key})
}

func storageDir() string {
	if d := os.Getenv("STORAGE_DIR"); d != "" {
		return d
	}
	return "storage"
}

func randomName() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%d-%s", time.Now().Unix(), hex.EncodeToString(b))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// intakePreflight checks the workspace's plan before anything is stored: one more issue (total and
// this month) and, with a screenshot, the storage quota. Create re-checks the issue quotas; this
// runs first so a refused report leaves no orphaned screenshot behind.
func intakePreflight(ctx context.Context, workspaceID string, shotBytes int) error {
	if err := limits.Check(ctx, workspaceID, limits.Issues, 1); err != nil {
		return err
	}
	if err := limits.Check(ctx, workspaceID, limits.IssuesMonth, 1); err != nil {
		return err
	}
	if shotBytes > 0 {
		return limits.CheckStorage(ctx, workspaceID, int64(shotBytes))
	}
	return nil
}

// writeRefusal answers a plan refusal (402 / 429 with its code) and reports whether err was one.
func writeRefusal(w http.ResponseWriter, err error) bool {
	x, ok := limits.As(err)
	if !ok {
		return false
	}
	writeJSON(w, x.Status, map[string]string{"error": x.Msg, "code": x.Code})
	return true
}
