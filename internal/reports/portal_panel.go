package reports

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
The customer panel's issue side (roadmap 5) and its REST surface.

A customer sees ALL the issues of their projects (they are the customer, not only the reporter),
in a slim shape: no captured console/network logs, no agent strategy, no human_only flag, and no
author ids on comments (only whether a comment is theirs). On the issues of their own projects they
may do exactly four things, through PATCH /api/w/portal/issues/{key} — never the general
PATCH /api/w/issues/{key}:

	comment                   POST …/comments
	accept                    status in_review → done
	reopen                    status done | in_review → todo
	re-prioritise             priority

Access is authz.PortalRead / PortalWrite (clients up) AND the issue's project must be visible to the
caller (work.VisibleProject); anything else is 404. Staff who can see the project may use the same
endpoints (the panel is theirs to preview).
*/

// PortalIssue is an issue as its customer sees it.
type PortalIssue struct {
	Key          string     `json:"key"`
	Title        string     `json:"title"`
	Body         *string    `json:"body"`
	Status       string     `json:"status"`
	State        string     `json:"state"`
	Priority     string     `json:"priority"`
	IssueType    string     `json:"issue_type"`
	Source       string     `json:"source"`
	Resolution   *string    `json:"resolution"`
	ProjectID    *string    `json:"project_id"`
	Screenshot   *string    `json:"screenshot"`
	Mine         bool       `json:"mine" doc:"You filed it"`
	CommentCount int64      `json:"comment_count"`
	CanAccept    bool       `json:"can_accept" doc:"In review: you may accept it (→ done)"`
	CanReopen    bool       `json:"can_reopen" doc:"Done or in review: you may reopen it (→ todo)"`
	ClosedAt     *time.Time `json:"closed_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// PortalComment is one comment of a customer-visible thread.
type PortalComment struct {
	ID         string    `json:"id"`
	AuthorKind string    `json:"author_kind" doc:"user or agent"`
	Mine       bool      `json:"mine"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

// PortalIssueDetail is one issue with its thread.
type PortalIssueDetail struct {
	PortalIssue
	Comments []PortalComment `json:"comments"`
}

// PortalProjectPage is a project's whole customer panel: aggregates, issues, requests, invoices.
type PortalProjectPage struct {
	work.PortalProjectDetail
	Issues   []PortalIssue `json:"issues"`
	Requests []Request     `json:"requests"`
}

// PortalProjectList is the body of GET /api/w/portal/projects.
type PortalProjectList struct {
	Projects []work.PortalProject `json:"projects"`
}

func toPortalIssue(r *Report, userID string) PortalIssue {
	return PortalIssue{Key: r.Key, Title: r.Title, Body: r.Body, Status: r.Status, State: r.State, Priority: r.Priority,
		IssueType: r.IssueType, Source: r.Source, Resolution: r.Resolution, ProjectID: r.ProjectID, Screenshot: r.Screenshot,
		Mine:      r.ReporterID != nil && *r.ReporterID == userID,
		CanAccept: r.Status == "in_review", CanReopen: r.Status == "done" || r.Status == "in_review",
		ClosedAt: r.ClosedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

// PortalProject composes a project's customer panel.
func PortalProject(ctx context.Context, a *app.App, ref string) (*PortalProjectPage, error) {
	sv := work.New(a)
	d, err := sv.PortalProject(ctx, ref)
	if err != nil {
		return nil, err
	}
	s, _ := tenant.From(ctx)
	rows, err := List(ctx, a.SQLDB, s.WorkspaceID, Filter{ProjectID: d.ID, Limit: 500})
	if err != nil {
		return nil, err
	}
	counts, err := commentCounts(ctx, a, s.WorkspaceID, rows)
	if err != nil {
		return nil, err
	}
	page := &PortalProjectPage{PortalProjectDetail: *d, Issues: make([]PortalIssue, 0, len(rows))}
	for _, r := range rows {
		i := toPortalIssue(r, s.UserID)
		i.CommentCount = counts[r.ID]
		page.Issues = append(page.Issues, i)
	}
	if page.Requests, err = queryRequests(ctx, a.SQLDB, s, `AND r.project_id = $2`, d.ID); err != nil {
		return nil, err
	}
	return page, nil
}

func commentCounts(ctx context.Context, a *app.App, ws string, rows []*Report) (map[string]int64, error) {
	h := &issueRoutes{db: a.SQLDB}
	return h.commentCounts(ctx, ws, rows)
}

// portalIssue loads an issue of a project the caller can see, or 404.
func portalIssue(ctx context.Context, a *app.App, action, key string) (*tenant.Scope, *Report, error) {
	s, err := scope(ctx, action)
	if err != nil {
		return nil, nil, err
	}
	rep, err := Find(ctx, a.SQLDB, s.WorkspaceID, key)
	if err != nil || rep.ProjectID == nil {
		return nil, nil, work.NewError(http.StatusNotFound, "issue not found")
	}
	if _, err := work.New(a).VisibleProject(ctx, *rep.ProjectID); err != nil {
		return nil, nil, work.NewError(http.StatusNotFound, "issue not found")
	}
	return s, rep, nil
}

// GetPortalIssue returns one issue of the caller's projects with its thread.
func GetPortalIssue(ctx context.Context, a *app.App, key string) (*PortalIssueDetail, error) {
	s, rep, err := portalIssue(ctx, a, authz.PortalRead, key)
	if err != nil {
		return nil, err
	}
	return portalDetail(ctx, a, s, rep)
}

func portalDetail(ctx context.Context, a *app.App, s *tenant.Scope, rep *Report) (*PortalIssueDetail, error) {
	cs, err := Comments(ctx, a.SQLDB, s.WorkspaceID, rep.ID)
	if err != nil {
		return nil, err
	}
	d := &PortalIssueDetail{PortalIssue: toPortalIssue(rep, s.UserID), Comments: make([]PortalComment, 0, len(cs))}
	var state *string
	_ = a.SQLDB.QueryRowContext(ctx, `SELECT request_state FROM reports WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, rep.ID).Scan(&state)
	if state != nil && *state != "accepted" {
		d.CanAccept, d.CanReopen = false, false // a request not on the board has no workflow yet
	}
	for _, c := range cs {
		d.Comments = append(d.Comments, PortalComment{ID: c.ID, AuthorKind: c.AuthorKind, Body: c.Body, CreatedAt: c.CreatedAt,
			Mine: c.AuthorID != nil && *c.AuthorID == s.UserID})
	}
	d.CommentCount = int64(len(cs))
	return d, nil
}

// PortalIssueChange is everything a customer may change on an issue.
type PortalIssueChange struct {
	Status   *string `json:"status,omitempty" doc:"done (accept, from in_review) or todo (reopen, from done or in_review)"`
	Priority *string `json:"priority,omitempty" doc:"highest, high, medium, low or lowest"`
}

// UpdatePortalIssue applies a customer's accept / reopen / re-prioritise.
func UpdatePortalIssue(ctx context.Context, a *app.App, key string, in PortalIssueChange) (*PortalIssueDetail, error) {
	s, rep, err := portalIssue(ctx, a, authz.PortalWrite, key)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{}
	note := ""
	if in.Status != nil && *in.Status != rep.Status {
		var state *string
		_ = a.SQLDB.QueryRowContext(ctx, `SELECT request_state FROM reports WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, rep.ID).Scan(&state)
		if state != nil && *state != "accepted" {
			return nil, work.NewError(http.StatusUnprocessableEntity, "this request is not on the board yet")
		}
		switch *in.Status {
		case "done":
			if rep.Status != "in_review" {
				return nil, work.NewError(http.StatusUnprocessableEntity, "you can accept an issue once it is in review")
			}
			note = "Accepted by the customer."
		case "todo":
			if rep.Status != "done" && rep.Status != "in_review" {
				return nil, work.NewError(http.StatusUnprocessableEntity, "you can reopen an issue that is in review or done")
			}
			note = "Reopened by the customer."
		default:
			return nil, work.NewError(http.StatusUnprocessableEntity, "you can set the status to done (accept) or todo (reopen) only")
		}
		statusFields(rep, *in.Status, fields)
	}
	if in.Priority != nil && *in.Priority != rep.Priority {
		if !oneOf(*in.Priority, Priorities) {
			return nil, work.NewError(http.StatusUnprocessableEntity, "unknown priority "+*in.Priority)
		}
		fields["priority"] = *in.Priority
	}
	if err := Update(ctx, a.SQLDB, rep, fields); err != nil {
		return nil, err
	}
	if note != "" {
		_ = AddComment(ctx, a.SQLDB, rep, s.UserID, "user", note)
	}
	if rep, err = Find(ctx, a.SQLDB, s.WorkspaceID, rep.ID); err != nil {
		return nil, err
	}
	return portalDetail(ctx, a, s, rep)
}

// CommentPortalIssue adds the customer's reply to an issue of their project.
func CommentPortalIssue(ctx context.Context, a *app.App, key, body string) (*PortalComment, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, work.NewError(http.StatusUnprocessableEntity, "write something")
	}
	s, rep, err := portalIssue(ctx, a, authz.PortalWrite, key)
	if err != nil {
		return nil, err
	}
	c, err := AddCommentReturning(ctx, a.SQLDB, rep, s.UserID, "user", truncate(body, 10000))
	if err != nil {
		return nil, err
	}
	return &PortalComment{ID: c.ID, AuthorKind: c.AuthorKind, Mine: true, Body: c.Body, CreatedAt: c.CreatedAt}, nil
}

// ---- REST -----------------------------------------------------------------------------------

// MountPortalRequestFile mounts the raw, multipart-capable POST /api/w/portal/requests (the same
// parser as the feedback intake, so a screenshot can ride along).
func MountPortalRequestFile(k *togo.Kernel, a *app.App) {
	k.Router.Post("/api/w/portal/requests", func(w http.ResponseWriter, r *http.Request) {
		fields, shot, ext, ok := parseFeedback(w, r)
		if !ok {
			return
		}
		if s, ok := tenant.From(r.Context()); ok {
			if err := intakePreflight(r.Context(), s.WorkspaceID, len(shot)); err != nil {
				if !writeRefusal(w, err) {
					a.Log.Error("portal request", "err", err)
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not file the request"})
				}
				return
			}
		}
		req, err := FileRequest(r.Context(), a, RequestInput{
			Project: firstNonEmpty(fields["project_id"], fields["project"]), Title: fields["title"],
			Body: firstNonEmpty(fields["body"], fields["details"]), Kind: fields["kind"], DesiredOn: fields["desired_on"],
			Screenshot: saveScreenshot(shot, ext),
		})
		if err != nil {
			if e, ok := work.AsError(err); ok {
				writeJSON(w, e.Status, map[string]string{"error": e.Msg})
				return
			}
			a.Log.Error("portal request", "err", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not file the request"})
			return
		}
		writeJSON(w, http.StatusCreated, req)
	})
}

// MountScreenshots serves an issue's / request's attached image (stored under STORAGE_DIR/feedback
// by saveScreenshot, never publicly): staff with feedback:read through /api/w/issues/{key}/screenshot,
// a customer through /api/w/portal/issues/{key}/screenshot (the issue's project must be visible).
func MountScreenshots(k *togo.Kernel, a *app.App) {
	serve := func(w http.ResponseWriter, r *http.Request, rep *Report) {
		if rep.Screenshot == nil || !strings.HasPrefix(*rep.Screenshot, "feedback/") || strings.Contains(*rep.Screenshot, "..") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no screenshot"})
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeFile(w, r, filepath.Join(storageDir(), filepath.FromSlash(*rep.Screenshot)))
	}
	fail := func(w http.ResponseWriter, err error) {
		if e, ok := work.AsError(err); ok {
			writeJSON(w, e.Status, map[string]string{"error": e.Msg})
			return
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "issue not found"})
	}
	k.Router.Get("/api/w/issues/{key}/screenshot", func(w http.ResponseWriter, r *http.Request) {
		s, ok := tenant.From(r.Context())
		if !ok || s.WorkspaceID == "" || s.UserID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace not found"})
			return
		}
		if !authz.Can(s.Role, authz.FeedbackRead) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "your role cannot read issues"})
			return
		}
		rep, err := Find(r.Context(), a.SQLDB, s.WorkspaceID, chi.URLParam(r, "key"))
		if err != nil {
			fail(w, nil)
			return
		}
		serve(w, r, rep)
	})
	k.Router.Get("/api/w/portal/issues/{key}/screenshot", func(w http.ResponseWriter, r *http.Request) {
		_, rep, err := portalIssue(r.Context(), a, authz.PortalRead, chi.URLParam(r, "key"))
		if err != nil {
			fail(w, err)
			return
		}
		serve(w, r, rep)
	})
}

// RegisterPortalPanel mounts the customer panel and the staff Requests inbox.
func RegisterPortalPanel(api huma.API, a *app.App) {
	h := &issueRoutes{api: api, app: a}
	if a != nil {
		h.db = a.SQLDB
		h.log = a.Log
	}
	const portalTag, reqTag = "Client portal", "Requests"
	reg := func(op huma.Operation, tag string) huma.Operation {
		op.Tags = []string{tag}
		return op
	}

	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-projects", Method: http.MethodGet, Path: "/api/w/portal/projects",
		Summary: "Your projects as their customer sees them: progress, hours against budget, open issues (aggregates only)"}, portalTag),
		func(ctx context.Context, _ *work.WS) (*work.Resp[PortalProjectList], error) {
			list, err := work.New(a).PortalProjects(ctx)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[PortalProjectList]{Body: PortalProjectList{Projects: list}}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-project", Method: http.MethodGet, Path: "/api/w/portal/projects/{project}",
		Summary: "One project's customer panel: progress, weekly hours, issues, requests and invoices"}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			work.ProjectRef
		}) (*work.Resp[PortalProjectPage], error) {
			page, err := PortalProject(ctx, a, in.Project)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[PortalProjectPage]{Body: *page}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-board", Method: http.MethodGet, Path: "/api/w/portal/projects/{project}/tasks",
		Summary: "The project's task board, read-only (when the team shares it): columns and whitelisted task fields"}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			work.ProjectRef
		}) (*work.Resp[work.PortalBoard], error) {
			b, err := work.New(a).PortalBoard(ctx, in.Project)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[work.PortalBoard]{Body: *b}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-task", Method: http.MethodGet, Path: "/api/w/portal/projects/{project}/tasks/{task}",
		Summary: "One task read-only: description and checklist (never the team's comments)"}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			work.ProjectRef
			work.TaskRef
		}) (*work.Resp[work.PortalTaskDetail], error) {
			t, err := work.New(a).PortalTask(ctx, in.Project, in.Task)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[work.PortalTaskDetail]{Body: *t}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-time", Method: http.MethodGet, Path: "/api/w/portal/projects/{project}/time",
		Summary: "Tracked time on the project: total, by week and by task (no people, no money)"}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			work.ProjectRef
		}) (*work.Resp[work.PortalTimeReport], error) {
			t, err := work.New(a).PortalTime(ctx, in.Project)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[work.PortalTimeReport]{Body: *t}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-activity", Method: http.MethodGet, Path: "/api/w/portal/projects/{project}/activity",
		Summary: "Recent customer-safe activity: tasks created, moved and completed; issues and requests"}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			work.ProjectRef
		}) (*work.Resp[PortalActivityList], error) {
			list, err := work.New(a).PortalActivity(ctx, in.Project)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[PortalActivityList]{Body: PortalActivityList{Items: list}}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-issue", Method: http.MethodGet, Path: "/api/w/portal/issues/{key}",
		Summary: "One issue of your projects with its thread"}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			IssueKeyRef
		}) (*work.Resp[PortalIssueDetail], error) {
			d, err := GetPortalIssue(ctx, a, in.Key)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[PortalIssueDetail]{Body: *d}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-update-issue", Method: http.MethodPatch, Path: "/api/w/portal/issues/{key}",
		Summary: "Accept (in_review → done), reopen (→ todo) or re-prioritise an issue of your project"}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			IssueKeyRef
			Body PortalIssueChange
		}) (*work.Resp[PortalIssueDetail], error) {
			d, err := UpdatePortalIssue(ctx, a, in.Key, in.Body)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[PortalIssueDetail]{Body: *d}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-comment-issue", Method: http.MethodPost, Path: "/api/w/portal/issues/{key}/comments",
		Summary: "Reply on an issue of your project", DefaultStatus: http.StatusCreated}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			IssueKeyRef
			Body struct {
				Body string `json:"body" minLength:"1" maxLength:"10000"`
			}
		}) (*work.Resp[PortalComment], error) {
			c, err := CommentPortalIssue(ctx, a, in.Key, in.Body.Body)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[PortalComment]{Body: *c}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-portal-requests", Method: http.MethodGet, Path: "/api/w/portal/requests",
		Summary: "The requests of your projects with their state and the team's reply"}, portalTag),
		func(ctx context.Context, in *struct {
			work.WS
			Project string `query:"project" doc:"Limit to one project"`
		}) (*work.Resp[RequestList], error) {
			list, err := PortalRequests(ctx, a, in.Project)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[RequestList]{Body: RequestList{Requests: list}}, nil
		})

	huma.Register(api, reg(huma.Operation{OperationID: "w-list-requests", Method: http.MethodGet, Path: "/api/w/requests",
		Summary: "The customer Requests inbox (manager+); pending by default"}, reqTag),
		func(ctx context.Context, in *struct {
			work.WS
			State   string `query:"state" doc:"pending (default), accepted, declined, converted or all"`
			Project string `query:"project"`
		}) (*work.Resp[RequestList], error) {
			list, err := ListRequests(ctx, a, in.State, in.Project)
			if err != nil {
				return nil, h.domain(err)
			}
			counts, err := CountRequests(ctx, a)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[RequestList]{Body: RequestList{Requests: list, Counts: counts}}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-get-request", Method: http.MethodGet, Path: "/api/w/requests/{key}",
		Summary: "One request in any state (manager+): body, requester, history, thread and what it became"}, reqTag),
		func(ctx context.Context, in *struct {
			work.WS
			IssueKeyRef
		}) (*work.Resp[RequestDetail], error) {
			d, err := GetRequest(ctx, a, in.Key)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[RequestDetail]{Body: *d}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-reopen-request", Method: http.MethodPost, Path: "/api/w/requests/{key}/reopen",
		Summary: "Undo a decision: an accepted, declined or converted request goes back to pending (a task it became is kept)"}, reqTag),
		func(ctx context.Context, in *struct {
			work.WS
			IssueKeyRef
			Body struct {
				Note string `json:"note,omitempty" maxLength:"2000"`
			}
		}) (*work.Resp[Request], error) {
			r, err := ReopenRequest(ctx, a, in.Key, in.Body.Note)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[Request]{Body: *r}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-accept-request", Method: http.MethodPost, Path: "/api/w/requests/{key}/accept",
		Summary: "Accept a request: it becomes a normal issue on the board, and the customer is told"}, reqTag),
		func(ctx context.Context, in *struct {
			work.WS
			IssueKeyRef
			Body AcceptInput
		}) (*work.Resp[Request], error) {
			r, err := AcceptRequest(ctx, a, in.Key, in.Body)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[Request]{Body: *r}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-decline-request", Method: http.MethodPost, Path: "/api/w/requests/{key}/decline",
		Summary: "Decline a request with a reason the customer sees"}, reqTag),
		func(ctx context.Context, in *struct {
			work.WS
			IssueKeyRef
			Body struct {
				Reason string `json:"reason" maxLength:"2000"`
			}
		}) (*work.Resp[Request], error) {
			r, err := DeclineRequest(ctx, a, in.Key, in.Body.Reason)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[Request]{Body: *r}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "w-convert-request", Method: http.MethodPost, Path: "/api/w/requests/{key}/convert-to-task",
		Summary: "Turn a request into a task (linked by a comment); the customer is told"}, reqTag),
		func(ctx context.Context, in *struct {
			work.WS
			IssueKeyRef
			Body struct {
				Project string `json:"project,omitempty" doc:"Project for the task (default the request's)"`
			}
		}) (*work.Resp[ConvertResult], error) {
			r, key, err := ConvertRequest(ctx, a, in.Key, in.Body.Project)
			if err != nil {
				return nil, h.domain(err)
			}
			return &work.Resp[ConvertResult]{Body: ConvertResult{Request: *r, TaskKey: key}}, nil
		})
}

// PortalActivityList is the body of GET /api/w/portal/projects/{project}/activity.
type PortalActivityList struct {
	Items []work.PortalActivityItem `json:"items"`
}

// ConvertResult is the body of POST …/convert-to-task.
type ConvertResult struct {
	Request Request `json:"request"`
	TaskKey string  `json:"task_key"`
}

// domain maps a caller-safe domain error to its status; anything else is a logged 500.
func (h *issueRoutes) domain(err error) error {
	if e, ok := work.AsError(err); ok {
		return huma.NewError(e.Status, e.Msg)
	}
	return h.fail(err)
}
