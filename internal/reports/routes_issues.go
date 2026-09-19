package reports

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
RegisterIssues mounts /api/w/issues/* — the per-workspace view of the reports +
report_comments tables, so a workspace's own "Report a problem" intake (filed
into the workspace by intake() when the request names one) is triaged inside
that workspace, mirroring fadymondy.com-v2.

Every path is under /api/w/, so the guard's workspace tier applies (session +
membership of X-Workspace-ID, 404 otherwise) and generatedAuthz passes it through
to the role checks here (reads: feedback:read; writes — create, edit, move:
feedback:write, both Member). The workspace is the request's X-Workspace-ID
(tenant.Scope), NEVER the platform workspace — these are the workspace's own
issues, not Mahaam's own-platform bug reports.

A project reference (list filter, create) resolves through work.FindProject, so
it must be a project the caller can see; an invisible one is a 404.

Lives in this package (not internal/work) to avoid the work → reports import
cycle: work.Create's key allocation already makes reports depend on work.
`a` may be nil (OpenAPI export). Everything runs on the RLS app pool (a.SQLDB)
with an explicit workspace_id predicate.
*/
func RegisterIssues(api huma.API, a *app.App) {
	h := &issueRoutes{api: api, app: a}
	if a != nil {
		h.db = a.SQLDB
		h.log = a.Log
	}
	h.mount()
}

type issueRoutes struct {
	api huma.API
	app *app.App
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
	Key          string     `json:"key"`
	Title        string     `json:"title"`
	Status       string     `json:"status"`
	State        string     `json:"state"`
	Priority     string     `json:"priority"`
	IssueType    string     `json:"issue_type"`
	Body         *string    `json:"body"`
	Resolution   *string    `json:"resolution"`
	Route        *string    `json:"route"`
	PageURL      *string    `json:"page_url"`
	Selector     *string    `json:"selector"`
	Screenshot   *string    `json:"screenshot"`
	ConsoleLog   *string    `json:"console_log"`
	NetworkLog   *string    `json:"network_log"`
	Viewport     *string    `json:"viewport"`
	UserAgent    *string    `json:"user_agent"`
	ReporterID   *string    `json:"reporter_id"`
	ProjectID    *string    `json:"project_id"`
	Source       string     `json:"source" doc:"app, portal or embed"`
	HumanOnly    bool       `json:"human_only" doc:"Agents must not work this issue"`
	AIModel      *string    `json:"ai_model" doc:"Model the agent runs this issue with (opus, sonnet, haiku, fable)"`
	AIEffort     *string    `json:"ai_effort" doc:"low, medium, high, xhigh or max"`
	Agent        *string    `json:"agent" doc:"Subagent that works this issue"`
	Skill        *string    `json:"skill" doc:"Skill the agent runs for this issue"`
	SortOrder    int64      `json:"sort_order"`
	AgentSeconds int64      `json:"agent_seconds" doc:"Time an agent has banked on the issue"`
	CommentCount int64      `json:"comment_count"`
	StartedAt    *time.Time `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at"`
	ClosedAt     *time.Time `json:"closed_at"`
	CreatedAt    time.Time  `json:"created_at"`
	RequestState *string    `json:"request_state" doc:"Set when the issue is a customer request: pending, accepted, declined or converted"`
	UpdatedAt    time.Time  `json:"updated_at"`
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

// Priorities is the issue priority allowlist (the MCP tools' enum).
var Priorities = []string{"highest", "high", "medium", "low", "lowest"}

// Types is the issue type allowlist.
var Types = []string{"bug", "feature", "task", "story", "epic"}

// Efforts are the reasoning-effort levels an issue can ask its agent to run at.
var Efforts = []string{"low", "medium", "high", "xhigh", "max"}

func oneOf(v string, set []string) bool {
	for _, s := range set {
		if s == v {
			return true
		}
	}
	return false
}

func toIssue(r *Report) Issue {
	return Issue{
		Key: r.Key, Title: r.Title, Status: r.Status, State: r.State, Priority: r.Priority,
		IssueType: r.IssueType, Body: r.Body, Resolution: r.Resolution, Route: r.Route,
		PageURL: r.PageURL, Selector: r.Selector, Screenshot: r.Screenshot,
		ConsoleLog: r.ConsoleLog, NetworkLog: r.NetworkLog, Viewport: r.Viewport,
		UserAgent: r.UserAgent, ReporterID: r.ReporterID, ProjectID: r.ProjectID, Source: r.Source,
		HumanOnly: r.HumanOnly, AIModel: r.AIModel, AIEffort: r.AIEffort, Agent: r.Agent, Skill: r.Skill, SortOrder: r.SortOrder, AgentSeconds: r.AgentSeconds,
		StartedAt: r.StartedAt, FinishedAt: r.FinishedAt, ClosedAt: r.ClosedAt,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, RequestState: r.RequestState,
	}
}

func toIssueComments(cs []Comment) []IssueComment {
	out := make([]IssueComment, 0, len(cs))
	for _, c := range cs {
		out = append(out, IssueComment{ID: c.ID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind, Body: c.Body, CreatedAt: c.CreatedAt})
	}
	return out
}

// statusFields is the column set for moving r to status: done closes it, leaving
// done reopens it.
func statusFields(r *Report, status string, fields map[string]any) {
	fields["status"] = status
	switch {
	case status == "done":
		fields["state"], fields["closed_at"] = "closed", time.Now().UTC()
	case r.Status == "done":
		fields["state"], fields["closed_at"] = "open", nil
	}
}

func (h *issueRoutes) mount() {
	const tag = "Issues"

	huma.Register(h.api, huma.Operation{
		OperationID: "w-list-issues", Method: http.MethodGet, Path: "/api/w/issues",
		Summary: "The workspace's issues (its own \"Report a problem\" intake), board order", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		work.WS
		Status           string `query:"status" doc:"backlog, todo, in_progress, waiting_approval, in_review, done"`
		State            string `query:"state" doc:"open or closed"`
		Priority         string `query:"priority" doc:"highest, high, medium, low or lowest"`
		Type             string `query:"type" doc:"bug, feature, task, story or epic"`
		Q                string `query:"q" doc:"Title contains"`
		Project          string `query:"project" doc:"Project id or name (must be visible to you)"`
		IncludeHumanOnly bool   `query:"include_human_only" default:"true" doc:"Include issues marked human-only"`
	}) (*work.Resp[IssueList], error) {
		s, err := h.reader(ctx)
		if err != nil {
			return nil, err
		}
		projectID, err := h.project(ctx, in.Project)
		if err != nil {
			return nil, err
		}
		rows, err := List(ctx, h.db, s.WorkspaceID, Filter{
			Status: in.Status, State: in.State, IssueType: in.Type, Q: in.Q,
			ProjectID: projectID, HideHumanOnly: !in.IncludeHumanOnly, Limit: 500,
		})
		if err != nil {
			return nil, h.fail(err)
		}
		counts, err := h.commentCounts(ctx, s.WorkspaceID, rows)
		if err != nil {
			return nil, h.fail(err)
		}
		out := IssueList{Issues: make([]Issue, 0, len(rows))}
		for _, rep := range rows {
			if in.Priority != "" && rep.Priority != in.Priority {
				continue
			}
			i := toIssue(rep)
			i.CommentCount = counts[rep.ID]
			out.Issues = append(out.Issues, i)
		}
		return &work.Resp[IssueList]{Body: out}, nil
	})

	huma.Register(h.api, huma.Operation{
		OperationID: "w-create-issue", Method: http.MethodPost, Path: "/api/w/issues",
		Summary: "File an issue in the workspace (members)", Tags: []string{tag}, DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *struct {
		work.WS
		Body struct {
			Title     string `json:"title" minLength:"1" maxLength:"300"`
			Body      string `json:"body,omitempty" maxLength:"20000"`
			IssueType string `json:"issue_type,omitempty" doc:"bug, feature, task, story or epic (default bug)"`
			Priority  string `json:"priority,omitempty" doc:"highest, high, medium, low or lowest (default medium)"`
			Status    string `json:"status,omitempty" doc:"Board column (default backlog)"`
			Project   string `json:"project,omitempty" doc:"Project id or name (must be visible to you)"`
		}
	}) (*work.Resp[IssueDetail], error) {
		s, err := h.writer(ctx)
		if err != nil {
			return nil, err
		}
		b := in.Body
		if strings.TrimSpace(b.Title) == "" {
			return nil, huma.Error422UnprocessableEntity("title is required")
		}
		if b.IssueType != "" && !oneOf(b.IssueType, Types) {
			return nil, huma.Error422UnprocessableEntity("unknown issue type " + b.IssueType)
		}
		if b.Priority != "" && !oneOf(b.Priority, Priorities) {
			return nil, huma.Error422UnprocessableEntity("unknown priority " + b.Priority)
		}
		if b.Status != "" && !ValidStatus(b.Status) {
			return nil, huma.Error422UnprocessableEntity("unknown status " + b.Status)
		}
		projectID, err := h.project(ctx, b.Project)
		if err != nil {
			return nil, err
		}
		rep, err := Create(ctx, h.db, s.WorkspaceID, NewReport{
			Title: b.Title, Body: b.Body, IssueType: b.IssueType, Priority: b.Priority, Status: b.Status,
			ReporterID: s.UserID, ProjectID: projectID, Source: "app",
		})
		if err != nil {
			return nil, h.fail(err)
		}
		return &work.Resp[IssueDetail]{Body: IssueDetail{Issue: toIssue(rep), Comments: []IssueComment{}}}, nil
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
		return h.detail(ctx, rep)
	})

	huma.Register(h.api, huma.Operation{
		OperationID: "w-update-issue", Method: http.MethodPatch, Path: "/api/w/issues/{key}",
		Summary: "Edit or triage an issue: title, body, type, status, priority, state, resolution, human-only (members)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		work.WS
		IssueKeyRef
		Body struct {
			Title      *string `json:"title,omitempty" maxLength:"300"`
			Body       *string `json:"body,omitempty" maxLength:"20000"`
			IssueType  *string `json:"issue_type,omitempty" doc:"bug, feature, task, story or epic"`
			Status     *string `json:"status,omitempty" doc:"backlog, todo, in_progress, waiting_approval, in_review, done"`
			Priority   *string `json:"priority,omitempty" doc:"highest, high, medium, low or lowest"`
			State      *string `json:"state,omitempty" doc:"open or closed"`
			Resolution *string `json:"resolution,omitempty"`
			HumanOnly  *bool   `json:"human_only,omitempty" doc:"Keep agents off this issue"`
			AIModel    *string `json:"ai_model,omitempty" maxLength:"40" doc:"\"\" clears"`
			AIEffort   *string `json:"ai_effort,omitempty" doc:"low, medium, high, xhigh, max; \"\" clears"`
			Agent      *string `json:"agent,omitempty" maxLength:"100"`
			Skill      *string `json:"skill,omitempty" maxLength:"100"`
		}
	}) (*work.Resp[IssueDetail], error) {
		s, err := h.writer(ctx)
		if err != nil {
			return nil, err
		}
		rep, err := Find(ctx, h.db, s.WorkspaceID, in.Key)
		if err != nil {
			return nil, huma.Error404NotFound("issue not found")
		}
		b := in.Body
		fields := map[string]any{}
		if b.Title != nil {
			t := strings.TrimSpace(*b.Title)
			if t == "" {
				return nil, huma.Error422UnprocessableEntity("title cannot be empty")
			}
			fields["title"] = t
		}
		if b.Body != nil {
			fields["body"] = nullable(*b.Body)
		}
		if b.IssueType != nil {
			if !oneOf(*b.IssueType, Types) {
				return nil, huma.Error422UnprocessableEntity("unknown issue type " + *b.IssueType)
			}
			fields["issue_type"] = *b.IssueType
		}
		if b.Status != nil {
			if !ValidStatus(*b.Status) {
				return nil, huma.Error422UnprocessableEntity("unknown status " + *b.Status)
			}
			statusFields(rep, *b.Status, fields)
		}
		if b.State != nil {
			if *b.State != "open" && *b.State != "closed" {
				return nil, huma.Error422UnprocessableEntity("state must be open or closed")
			}
			fields["state"] = *b.State
		}
		if b.Priority != nil {
			if !oneOf(*b.Priority, Priorities) {
				return nil, huma.Error422UnprocessableEntity("unknown priority " + *b.Priority)
			}
			fields["priority"] = *b.Priority
		}
		if b.Resolution != nil {
			fields["resolution"] = nullable(*b.Resolution)
		}
		if b.HumanOnly != nil {
			fields["human_only"] = *b.HumanOnly
		}
		if b.AIEffort != nil && *b.AIEffort != "" && !oneOf(*b.AIEffort, Efforts) {
			return nil, huma.Error422UnprocessableEntity("unknown effort " + *b.AIEffort)
		}
		for col, v := range map[string]*string{"ai_model": b.AIModel, "ai_effort": b.AIEffort, "agent": b.Agent, "skill": b.Skill} {
			if v != nil {
				fields[col] = nullable(strings.TrimSpace(*v))
			}
		}
		if err := Update(ctx, h.db, rep, fields); err != nil {
			return nil, h.fail(err)
		}
		rep, err = Find(ctx, h.db, s.WorkspaceID, rep.ID)
		if err != nil {
			return nil, h.fail(err)
		}
		return h.detail(ctx, rep)
	})

	huma.Register(h.api, huma.Operation{
		OperationID: "w-move-issue", Method: http.MethodPost, Path: "/api/w/issues/{key}/move",
		Summary: "Place an issue on the board: just before or after another issue (taking its column), or at the end of a column (members)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		work.WS
		IssueKeyRef
		Body struct {
			Before string `json:"before,omitempty" doc:"Key of the issue to land just above"`
			After  string `json:"after,omitempty" doc:"Key of the issue to land just below"`
			Status string `json:"status,omitempty" doc:"Target column when there is no neighbour (an empty column)"`
		}
	}) (*work.Resp[IssueDetail], error) {
		s, err := h.writer(ctx)
		if err != nil {
			return nil, err
		}
		rep, err := Find(ctx, h.db, s.WorkspaceID, in.Key)
		if err != nil {
			return nil, huma.Error404NotFound("issue not found")
		}
		b := in.Body
		switch {
		case b.Before != "" || b.After != "":
			ref, after := b.Before, false
			if ref == "" {
				ref, after = b.After, true
			}
			anchor, err := Find(ctx, h.db, s.WorkspaceID, ref)
			if err != nil {
				return nil, huma.Error404NotFound("anchor issue not found")
			}
			if anchor.ID == rep.ID {
				return nil, huma.Error422UnprocessableEntity("an issue cannot be placed next to itself")
			}
			if err := Reorder(ctx, h.db, rep, anchor, after); err != nil {
				return nil, h.fail(err)
			}
		case b.Status != "":
			if !ValidStatus(b.Status) {
				return nil, huma.Error422UnprocessableEntity("unknown status " + b.Status)
			}
			var last int64
			if err := h.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(sort_order), 0) FROM reports
				WHERE workspace_id = $1 AND status = $2 AND id <> $3`, s.WorkspaceID, b.Status, rep.ID).Scan(&last); err != nil {
				return nil, h.fail(err)
			}
			fields := map[string]any{"sort_order": last + 1000}
			if b.Status != rep.Status {
				statusFields(rep, b.Status, fields)
			}
			if err := Update(ctx, h.db, rep, fields); err != nil {
				return nil, h.fail(err)
			}
		default:
			return nil, huma.Error422UnprocessableEntity("name before, after or status")
		}
		rep, err = Find(ctx, h.db, s.WorkspaceID, rep.ID)
		if err != nil {
			return nil, h.fail(err)
		}
		return h.detail(ctx, rep)
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

// detail renders rep with its thread.
func (h *issueRoutes) detail(ctx context.Context, rep *Report) (*work.Resp[IssueDetail], error) {
	comments, err := Comments(ctx, h.db, rep.WorkspaceID, rep.ID)
	if err != nil {
		return nil, h.fail(err)
	}
	d := IssueDetail{Issue: toIssue(rep), Comments: toIssueComments(comments)}
	d.CommentCount = int64(len(comments))
	return &work.Resp[IssueDetail]{Body: d}, nil
}

// commentCounts returns the thread length per report id for rows.
func (h *issueRoutes) commentCounts(ctx context.Context, workspaceID string, rows []*Report) (map[string]int64, error) {
	out := map[string]int64{}
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	res, err := h.db.QueryContext(ctx, `SELECT report_id, count(*) FROM report_comments
		WHERE workspace_id = $1 AND report_id = ANY($2) GROUP BY report_id`, workspaceID, ids)
	if err != nil {
		return nil, err
	}
	defer res.Close()
	for res.Next() {
		var id string
		var n int64
		if err := res.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, res.Err()
}

// project resolves an optional project reference through the domain layer, so the
// caller must be able to see it (else 404); "" means none.
func (h *issueRoutes) project(ctx context.Context, ref string) (string, error) {
	if strings.TrimSpace(ref) == "" {
		return "", nil
	}
	p, err := work.New(h.app).FindProject(ctx, ref)
	if err != nil {
		if e, ok := work.AsError(err); ok && e.Status == http.StatusUnprocessableEntity {
			return "", huma.Error422UnprocessableEntity(e.Msg)
		} else if !ok {
			return "", h.fail(err)
		}
		return "", huma.Error404NotFound("project not found")
	}
	return p.ID, nil
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

// writer is the create/edit/move gate (feedback:write, Member+).
func (h *issueRoutes) writer(ctx context.Context) (*tenant.Scope, error) {
	s, err := h.reader(ctx)
	if err != nil {
		return nil, err
	}
	if !authz.Can(s.Role, authz.FeedbackWrite) {
		return nil, huma.Error403Forbidden("your role cannot edit issues")
	}
	return s, nil
}

func (h *issueRoutes) fail(err error) error {
	if x, ok := limits.As(err); ok { // a plan quota (internal/limits)
		return huma.NewError(x.Status, x.Msg)
	}
	if h.log != nil {
		h.log.Error("issues", "err", err)
	}
	return huma.Error500InternalServerError("something went wrong")
}
