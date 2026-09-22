package reports

import (
	"net/http"
	"strings"

	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
POST /api/w/issues/file — a member files an issue WITH a screenshot.

This exists because there was no way to do it. `POST /api/w/issues` is JSON only, and
`/api/w/issues/{key}/screenshot` is a GET that serves one, so a client that had captured a screen
had nowhere to send it. The two multipart intakes that did accept an image were both wrong for a
signed-in member:

  * /api/feedback/embed  — authenticates with a project's public pfk_ key and an Origin allowlist.
    A member already has a session; asking them to also hold a public key would be worse security,
    not better, and the origin check makes no sense for a native or extension caller.
  * /api/feedback        — files into the PLATFORM workspace. That is Mahaam's own inbox, not the
    customer's board.

Raw rather than huma for the same reason the portal intake is: huma does not model multipart, and
this has to accept the same payload shape the capture code already produces.

Everything about handling the image — the 8 MB cap, PNG/JPEG/WebP only, the quota preflight, where
the file lands — is the shared path (parseFeedback, intakePreflight, saveScreenshot). Reimplementing
any of it here is how one intake ends up with a limit the others do not have.
*/

// MountIssueFile mounts the multipart member issue intake.
func MountIssueFile(k *togo.Kernel, a *app.App) {
	k.Router.Post("/api/w/issues/file", func(w http.ResponseWriter, r *http.Request) {
		issueFile(w, r, a)
	})
}

func issueFile(w http.ResponseWriter, r *http.Request, a *app.App) {
	// Under /api/w/, so the guard has already resolved the session and membership. This is the
	// belt to that braces: no scope means no workspace, and a 404 rather than a 403 keeps the
	// existence of the workspace unconfirmed.
	s, ok := tenant.From(r.Context())
	if !ok || s.WorkspaceID == "" || s.UserID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace not found"})
		return
	}

	fields, shot, shotExt, ok2 := parseFeedback(w, r)
	if !ok2 {
		return // parseFeedback has already written the reason
	}

	title := strings.TrimSpace(fields["title"])
	if title == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "a title is required"})
		return
	}
	if len(title) > 200 {
		title = title[:200]
	}

	// A project is optional here, unlike the portal intake: an extension filing "this page is
	// broken" from a random site often has no project in mind, and forcing one would make people
	// pick a wrong answer. When given, the caller must be able to SEE it — otherwise 404, which is
	// also what a project in another workspace looks like.
	var projectID string
	if ref := strings.TrimSpace(fields["project"]); ref != "" {
		proj, err := work.New(a).VisibleProject(r.Context(), ref)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "project not found"})
			return
		}
		projectID = proj.ID
	}

	// Quota and storage are checked before the file is written, not after: a workspace over its
	// limit should be refused, not refused *and* charged the disk.
	if err := intakePreflight(r.Context(), s.WorkspaceID, len(shot)); err != nil {
		if !writeRefusal(w, err) {
			a.Log.Error("issue file", "err", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not file the issue"})
		}
		return
	}

	rep, err := Create(r.Context(), a.SQLDB, s.WorkspaceID, NewReport{
		Title:      title,
		Body:       clip(fields["body"], 20000),
		IssueType:  normType(fields["issue_type"]),
		Priority:   normPriority(fields["priority"]),
		Route:      clip(fields["route"], 500),
		PageURL:    clip(fields["page_url"], 1000),
		Selector:   clip(fields["selector"], 500),
		Screenshot: saveScreenshot(shot, shotExt),
		ConsoleLog: clip(fields["console_log"], 50000),
		NetworkLog: clip(fields["network_log"], 50000),
		UserAgent:  clip(firstNonEmpty(fields["user_agent"], r.UserAgent()), 500),
		Viewport:   clip(fields["viewport"], 50),
		ReporterID: s.UserID,
		ProjectID:  projectID,
		// Not "embed" and not "portal": this is a member filing from one of our own clients, and
		// the board filters on source.
		Source: "app",
	})
	if err != nil {
		if writeRefusal(w, err) {
			return
		}
		a.Log.Error("issue file", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not file the issue"})
		return
	}

	a.Emit(r.Context(), "report.created", map[string]string{"key": rep.Key})
	writeJSON(w, http.StatusCreated, map[string]string{"key": rep.Key})
}
