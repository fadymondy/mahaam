package reports

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/managy/internal/app"
	"github.com/fadymondy/managy/internal/tenant"
	"github.com/fadymondy/managy/internal/work"
)

/*
The client portal's issue intake (P7). A client — or any member — files an issue
INTO a specific project through the portal; it lands in the workspace's reports
table with project_id set and source='portal', reusing the same board and triage
the in-app issues use. This replaces the old "tickets" concept.

Two surfaces:
  * POST /api/w/portal/issues (raw, so it accepts the shared feedback-sdk's
    multipart payload with a screenshot) — files an issue after checking the
    caller can SEE the named project (work.VisibleProject → 404 otherwise).
  * GET  /api/w/portal/issues (huma) — the caller's OWN filed issues, so a client
    never sees anyone else's. Both are under /api/w/, so the guard's workspace
    tier (session + membership, 404 otherwise) runs first.
*/

// MountPortalFile mounts the raw, multipart-capable POST /api/w/portal/issues.
func MountPortalFile(k *togo.Kernel, a *app.App) {
	k.Router.Post("/api/w/portal/issues", func(w http.ResponseWriter, r *http.Request) {
		portalFile(w, r, a)
	})
}

func portalFile(w http.ResponseWriter, r *http.Request, a *app.App) {
	s, ok := tenant.From(r.Context())
	if !ok || s.WorkspaceID == "" || s.UserID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace not found"})
		return
	}
	fields, shot, shotExt, ok2 := parseFeedback(w, r)
	if !ok2 {
		return
	}
	projectRef := strings.TrimSpace(fields["project_id"])
	if projectRef == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "which project is this about?"})
		return
	}
	// The caller must be able to see the project (a client: one of theirs) — else 404.
	proj, err := work.New(a).VisibleProject(r.Context(), projectRef)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "project not found"})
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
	issueType := normType(fields["issue_type"])
	rep, err := Create(r.Context(), a.SQLDB, s.WorkspaceID, NewReport{
		Title: title, IssueType: issueType, Body: strings.TrimSpace(fields["body"]),
		Route: fields["route"], PageURL: fields["page_url"], Selector: fields["selector"],
		Screenshot: saveScreenshot(shot, shotExt),
		ConsoleLog: fields["console_log"], NetworkLog: fields["network_log"],
		UserAgent: firstNonEmpty(fields["user_agent"], r.UserAgent()), Viewport: fields["viewport"],
		ReporterID: s.UserID, ProjectID: proj.ID, Source: "portal",
	})
	if err != nil {
		a.Log.Error("portal issue", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not file the issue"})
		return
	}
	a.Emit(r.Context(), "report.created", map[string]string{"key": rep.Key})
	writeJSON(w, http.StatusCreated, map[string]string{"key": rep.Key})
}

func normType(t string) string {
	switch t {
	case "bug", "feature", "task":
		return t
	default:
		return "bug"
	}
}

// RegisterPortalIssues mounts the huma read side: the caller's own filed issues.
func RegisterPortalIssues(api huma.API, a *app.App) {
	h := &issueRoutes{api: api}
	if a != nil {
		h.db = a.SQLDB
		h.log = a.Log
	}
	huma.Register(h.api, huma.Operation{
		OperationID: "w-portal-issues", Method: http.MethodGet, Path: "/api/w/portal/issues",
		Summary: "The issues you filed through the portal", Tags: []string{"Client portal"},
	}, func(ctx context.Context, in *struct {
		work.WS
		Project string `query:"project" doc:"Limit to one project"`
	}) (*work.Resp[IssueList], error) {
		s, ok := tenant.From(ctx)
		if !ok || s.WorkspaceID == "" || s.UserID == "" {
			return nil, huma.Error404NotFound("workspace not found")
		}
		rows, err := List(ctx, h.db, s.WorkspaceID, Filter{ReporterID: s.UserID, ProjectID: strings.TrimSpace(in.Project)})
		if err != nil {
			return nil, h.fail(err)
		}
		out := IssueList{Issues: make([]Issue, 0, len(rows))}
		for _, rep := range rows {
			out.Issues = append(out.Issues, toIssue(rep))
		}
		return &work.Resp[IssueList]{Body: out}, nil
	})
}
