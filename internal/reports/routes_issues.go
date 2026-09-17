package reports

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/fadymondy/managy/internal/app"
	"github.com/fadymondy/managy/internal/authz"
	"github.com/fadymondy/managy/internal/tenant"
	"github.com/fadymondy/managy/internal/work"
)

/*
RegisterIssues mounts /api/w/issues/* — the per-workspace view of the reports +
report_comments tables, so a workspace's own "Report a problem" intake (filed
into the workspace by intake() when the request names one) is triaged inside
that workspace, mirroring fadymondy.com-v2.

Every path is under /api/w/, so the guard's workspace tier applies (session +
membership of X-Workspace-ID, 404 otherwise) and generatedAuthz passes it through
to the role checks here (reads: any member; the PATCH: manager+, matching how
project writes are gated). The workspace is the request's X-Workspace-ID
(tenant.Scope), NEVER the platform workspace — these are the workspace's own
issues, not Managy's own-platform bug reports.

Lives in this package (not internal/work) to avoid the work → reports import
cycle: work.Create's key allocation already makes reports depend on work.
`a` may be nil (OpenAPI export). Everything runs on the RLS app pool (a.SQLDB)
with an explicit workspace_id predicate.
*/
func RegisterIssues(api huma.API, a *app.App) {
	h := &issueRoutes{api: api}
	if a != nil {
		h.db = a.SQLDB
		h.log = a.Log
	}
	h.mount()
}

type issueRoutes struct {
	api huma.API
	db  *sql.DB
	log *slog.Logger
}

// IssueKeyRef is the {key} path parameter. Exported so Huma binds it through the
// embedded struct (Huma skips fields promoted through an unexported embed).
type IssueKeyRef struct {
	Key string `path:"key" doc:"MG-12 or the issue id"`
}

// Issue is one report as JSON for a TS client (snake_case, the reports columns).
type Issue struct {
	Key        string    `json:"key"`
	Title      string    `json:"title"`
	Status     string    `json:"status"`
	State      string    `json:"state"`
	Priority   string    `json:"priority"`
	IssueType  string    `json:"issue_type"`
	Body       *string   `json:"body"`
	Resolution *string   `json:"resolution"`
	Route      *string   `json:"route"`
	PageURL    *string   `json:"page_url"`
	Selector   *string   `json:"selector"`
	Screenshot *string   `json:"screenshot"`
	ConsoleLog *string   `json:"console_log"`
	NetworkLog *string   `json:"network_log"`
	Viewport   *string   `json:"viewport"`
	UserAgent  *string   `json:"user_agent"`
	ReporterID *string   `json:"reporter_id"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// IssueComment is one entry of an issue's thread.
type IssueComment struct {
	ID         string    `json:"id"`
	AuthorID   *string   `json:"author_id"`
	AuthorKind string    `json:"author_kind"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

// IssueDetail is one issue with its comment thread.
type IssueDetail struct {
	Issue
	Comments []IssueComment `json:"comments"`
}

// IssueList is the body of GET /api/w/issues.
type IssueList struct {
	Issues []Issue `json:"issues"`
}

func toIssue(r *Report) Issue {
	return Issue{
		Key: r.Key, Title: r.Title, Status: r.Status, State: r.State, Priority: r.Priority,
		IssueType: r.IssueType, Body: r.Body, Resolution: r.Resolution, Route: r.Route,
		PageURL: r.PageURL, Selector: r.Selector, Screenshot: r.Screenshot,
		ConsoleLog: r.ConsoleLog, NetworkLog: r.NetworkLog, Viewport: r.Viewport,
		UserAgent: r.UserAgent, ReporterID: r.ReporterID,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func toIssueComments(cs []Comment) []IssueComment {
	out := make([]IssueComment, 0, len(cs))
	for _, c := range cs {
		out = append(out, IssueComment{ID: c.ID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind, Body: c.Body, CreatedAt: c.CreatedAt})
	}
	return out
}

func (h *issueRoutes) mount() {
	const tag = "Issues"

	huma.Register(h.api, huma.Operation{
		OperationID: "w-list-issues", Method: http.MethodGet, Path: "/api/w/issues",
		Summary: "The workspace's issues (its own \"Report a problem\" intake)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		work.WS
		Status   string `query:"status" doc:"backlog, todo, in_progress, waiting_approval, in_review, done"`
		Priority string `query:"priority" doc:"Filter on priority"`
		Type     string `query:"type" doc:"bug, feature or task"`
		Q        string `query:"q" doc:"Title contains"`
	}) (*work.Resp[IssueList], error) {
		s, err := h.reader(ctx)
		if err != nil {
			return nil, err
		}
		rows, err := List(ctx, h.db, s.WorkspaceID, Filter{Status: in.Status, IssueType: in.Type, Q: in.Q})
		if err != nil {
			return nil, h.fail(err)
		}
		out := IssueList{Issues: make([]Issue, 0, len(rows))}
		for _, rep := range rows {
			if in.Priority != "" && rep.Priority != in.Priority {
				continue
			}
			out.Issues = append(out.Issues, toIssue(rep))
		}
		return &work.Resp[IssueList]{Body: out}, nil
	})

	huma.Register(h.api, huma.Operation{
		OperationID: "w-get-issue", Method: http.MethodGet, Path: "/api/w/issues/{key}",
		Summary: "One issue with its comment thread", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		work.WS
		IssueKeyRef
	}) (*work.Resp[IssueDetail], error) {
		s, err := h.reader(ctx)
		if err != nil {
			return nil, err
		}
		rep, err := Find(ctx, h.db, s.WorkspaceID, in.Key)
		if err != nil {
			return nil, huma.Error404NotFound("issue not found")
		}
		comments, err := Comments(ctx, h.db, rep.WorkspaceID, rep.ID)
		if err != nil {
			return nil, h.fail(err)
		}
		return &work.Resp[IssueDetail]{Body: IssueDetail{Issue: toIssue(rep), Comments: toIssueComments(comments)}}, nil
	})

	huma.Register(h.api, huma.Operation{
		OperationID: "w-update-issue", Method: http.MethodPatch, Path: "/api/w/issues/{key}",
		Summary: "Triage an issue: status, priority, state or resolution (managers)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		work.WS
		IssueKeyRef
		Body struct {
			Status     *string `json:"status,omitempty" doc:"backlog, todo, in_progress, waiting_approval, in_review, done"`
			Priority   *string `json:"priority,omitempty"`
			State      *string `json:"state,omitempty" doc:"open or closed"`
			Resolution *string `json:"resolution,omitempty"`
		}
	}) (*work.Resp[IssueDetail], error) {
		s, ok := tenant.From(ctx)
		if !ok || s.WorkspaceID == "" || s.UserID == "" {
			return nil, huma.Error404NotFound("workspace not found")
		}
		if !authz.Role(s.Role).AtLeast(authz.Manager) {
			return nil, huma.Error403Forbidden("only a manager or above can triage issues")
		}
		rep, err := Find(ctx, h.db, s.WorkspaceID, in.Key)
		if err != nil {
			return nil, huma.Error404NotFound("issue not found")
		}
		fields := map[string]any{}
		if in.Body.Status != nil {
			status := *in.Body.Status
			if !ValidStatus(status) {
				return nil, huma.Error422UnprocessableEntity("unknown status " + status)
			}
			fields["status"] = status
			switch {
			case status == "done":
				fields["state"], fields["closed_at"] = "closed", time.Now().UTC()
			case rep.Status == "done":
				fields["state"], fields["closed_at"] = "open", nil
			}
		}
		if in.Body.State != nil {
			if *in.Body.State != "open" && *in.Body.State != "closed" {
				return nil, huma.Error422UnprocessableEntity("state must be open or closed")
			}
			fields["state"] = *in.Body.State
		}
		if in.Body.Priority != nil {
			fields["priority"] = *in.Body.Priority
		}
		if in.Body.Resolution != nil {
			if *in.Body.Resolution == "" {
				fields["resolution"] = nil
			} else {
				fields["resolution"] = *in.Body.Resolution
			}
		}
		if err := Update(ctx, h.db, rep, fields); err != nil {
			return nil, h.fail(err)
		}
		rep, err = Find(ctx, h.db, s.WorkspaceID, rep.ID)
		if err != nil {
			return nil, h.fail(err)
		}
		comments, _ := Comments(ctx, h.db, rep.WorkspaceID, rep.ID)
		return &work.Resp[IssueDetail]{Body: IssueDetail{Issue: toIssue(rep), Comments: toIssueComments(comments)}}, nil
	})

	huma.Register(h.api, huma.Operation{
		OperationID: "w-comment-issue", Method: http.MethodPost, Path: "/api/w/issues/{key}/comments",
		Summary: "Reply on an issue (any member)", Tags: []string{tag}, DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *struct {
		work.WS
		IssueKeyRef
		Body struct {
			Body string `json:"body" minLength:"1" maxLength:"10000"`
		}
	}) (*work.Resp[IssueComment], error) {
		s, err := h.reader(ctx)
		if err != nil {
			return nil, err
		}
		rep, err := Find(ctx, h.db, s.WorkspaceID, in.Key)
		if err != nil {
			return nil, huma.Error404NotFound("issue not found")
		}
		c, err := AddCommentReturning(ctx, h.db, rep, s.UserID, "user", in.Body.Body)
		if err != nil {
			return nil, h.fail(err)
		}
		return &work.Resp[IssueComment]{Body: IssueComment{ID: c.ID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind, Body: c.Body, CreatedAt: c.CreatedAt}}, nil
	})
}

// reader resolves the caller and checks the any-member read gate (feedback:read,
// the same Member tier as clients:read).
func (h *issueRoutes) reader(ctx context.Context) (*tenant.Scope, error) {
	s, ok := tenant.From(ctx)
	if !ok || s.WorkspaceID == "" || s.UserID == "" {
		return nil, huma.Error404NotFound("workspace not found")
	}
	if !authz.Can(s.Role, authz.FeedbackRead) {
		return nil, huma.Error403Forbidden("your role cannot read issues")
	}
	return s, nil
}

func (h *issueRoutes) fail(err error) error {
	if h.log != nil {
		h.log.Error("issues", "err", err)
	}
	return huma.Error500InternalServerError("something went wrong")
}
