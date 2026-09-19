package reports

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
The request portal (roadmap 5). A customer files a REQUEST — a feature, a change or a bug — into
one of their projects. It is a reports row with request_state set (19b_portal_requests.sql):

	pending    waiting in the staff Requests inbox; NOT on the board (List hides it by default)
	accepted   a manager accepted it: from now on a normal issue on the board
	declined   closed with a reason (request_reply) the customer sees
	converted  a manager turned it into a task; request_reply and a comment name the task key

Filing: authz.PortalWrite (clients up) on a project the caller can see (work.VisibleProject → 404).
Triage: authz.RequestsManage (manager+). The customer sees the requests of all their projects.
Notifications go through the inbox (work.NotifyUsers): request.created to managers,
request.accepted / request.declined / request.converted to the requester.
*/

// RequestKinds are what a customer can ask for.
var RequestKinds = []string{"feature", "change", "bug"}

// Request is a customer request as the portal and the inbox show it.
type Request struct {
	Key         string     `json:"key"`
	Title       string     `json:"title"`
	Body        *string    `json:"body"`
	Kind        string     `json:"kind" doc:"feature, change or bug"`
	State       string     `json:"state" doc:"pending, accepted, declined or converted"`
	Reply       *string    `json:"reply" doc:"The team's answer: the decline reason, or the task it became"`
	DesiredOn   *string    `json:"desired_on" doc:"YYYY-MM-DD the customer would like it by"`
	ProjectID   *string    `json:"project_id"`
	ProjectName *string    `json:"project_name"`
	ReporterID  *string    `json:"reporter_id"`
	Mine        bool       `json:"mine"`
	Status      string     `json:"status" doc:"The board column once accepted"`
	Priority    string     `json:"priority"`
	IssueType   string     `json:"issue_type"`
	Screenshot  *string    `json:"screenshot"`
	IssueState  string     `json:"issue_state" doc:"open or closed"`
	TaskKey     *string    `json:"task_key" doc:"The task a converted request became"`
	DecidedAt   *time.Time `json:"decided_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// RequestList is the body of the request list endpoints.
type RequestList struct {
	Requests []Request      `json:"requests"`
	Counts   *RequestCounts `json:"counts,omitempty" doc:"Per-state counts (the staff inbox only)"`
}

const requestCols = `r.key, r.title, r.body, COALESCE(r.request_kind, 'feature'), r.request_state, r.request_reply,
	to_char(r.desired_on, 'YYYY-MM-DD'), r.project_id,
	(SELECT pr.name FROM projects pr WHERE pr.workspace_id = r.workspace_id AND pr.id = r.project_id),
	r.reporter_id, r.status, r.priority, r.issue_type, r.screenshot, r.state, r.request_task_key, r.request_decided_at,
	r.created_at, r.updated_at`

func queryRequests(ctx context.Context, db *sql.DB, s *tenant.Scope, where string, args ...any) ([]Request, error) {
	rows, err := db.QueryContext(ctx, `SELECT `+requestCols+` FROM reports r WHERE r.workspace_id = $1
		AND r.request_state IS NOT NULL `+where+` ORDER BY r.created_at DESC LIMIT 500`, append([]any{s.WorkspaceID}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Request{}
	for rows.Next() {
		var q Request
		if err := rows.Scan(&q.Key, &q.Title, &q.Body, &q.Kind, &q.State, &q.Reply, &q.DesiredOn, &q.ProjectID, &q.ProjectName,
			&q.ReporterID, &q.Status, &q.Priority, &q.IssueType, &q.Screenshot, &q.IssueState, &q.TaskKey, &q.DecidedAt, &q.CreatedAt, &q.UpdatedAt); err != nil {
			return nil, err
		}
		q.Mine = q.ReporterID != nil && *q.ReporterID == s.UserID
		out = append(out, q)
	}
	return out, rows.Err()
}

func oneRequest(ctx context.Context, db *sql.DB, s *tenant.Scope, id string) (*Request, error) {
	list, err := queryRequests(ctx, db, s, `AND r.id = $2`, id)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, work.NewError(http.StatusNotFound, "request not found")
	}
	return &list[0], nil
}

func scope(ctx context.Context, action string) (*tenant.Scope, error) {
	s, ok := tenant.From(ctx)
	if !ok || s.WorkspaceID == "" || s.UserID == "" {
		return nil, work.NewError(http.StatusNotFound, "workspace not found")
	}
	if !authz.Can(s.Role, action) {
		return nil, work.NewError(http.StatusForbidden, fmt.Sprintf("your role (%s) cannot do this (%s)", s.Role, action))
	}
	return s, nil
}

// RequestInput is what a customer files.
type RequestInput struct {
	Project, Title, Body, Kind, DesiredOn string
	Screenshot                            string // stored path (saveScreenshot), optional
}

// FileRequest files a customer request into a visible project as a pending request.
func FileRequest(ctx context.Context, a *app.App, in RequestInput) (*Request, error) {
	s, err := scope(ctx, authz.PortalWrite)
	if err != nil {
		return nil, err
	}
	if err := work.RequireFeature(ctx, limits.FeaturePortal); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Project) == "" {
		return nil, work.NewError(http.StatusUnprocessableEntity, "which project is this about?")
	}
	sv := work.New(a)
	proj, err := sv.VisibleProject(ctx, in.Project)
	if err != nil {
		return nil, work.NewError(http.StatusNotFound, "project not found")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, work.NewError(http.StatusUnprocessableEntity, "a title is required")
	}
	title = truncate(title, 200)
	kind := firstNonEmpty(in.Kind, "feature")
	if !oneOf(kind, RequestKinds) {
		return nil, work.NewError(http.StatusUnprocessableEntity, "kind must be feature, change or bug")
	}
	var desired any
	if d := strings.TrimSpace(in.DesiredOn); d != "" {
		t, err := time.Parse("2006-01-02", d)
		if err != nil {
			return nil, work.NewError(http.StatusUnprocessableEntity, "desired_on must be YYYY-MM-DD")
		}
		desired = t.Format("2006-01-02")
	}
	issueType := map[string]string{"feature": "feature", "change": "task", "bug": "bug"}[kind]
	body := strings.TrimSpace(in.Body)
	if len(body) > 20000 {
		body = body[:20000]
	}
	rep, err := Create(ctx, a.SQLDB, s.WorkspaceID, NewReport{
		Title: title, Body: body, IssueType: issueType, Status: "backlog", Screenshot: in.Screenshot,
		ReporterID: s.UserID, ProjectID: proj.ID, Source: "portal",
		RequestKind: kind, DesiredOn: desiredStr(desired),
	})
	if err != nil {
		return nil, err
	}
	if managers, err := sv.ManagerIDs(ctx); err == nil {
		notifyLog(a, sv.NotifyUsers(ctx, managers, work.Note{Kind: "request.created",
			Title: fmt.Sprintf("New request %s in %s: %s", rep.Key, proj.Name, title),
			URL:   "/w/{slug}/requests?key=" + rep.Key,
			Data:  map[string]any{"request_key": rep.Key, "request_title": title, "project_id": proj.ID, "project_name": proj.Name, "kind": kind}}))
	}
	return oneRequest(ctx, a.SQLDB, s, rep.ID)
}

func notifyLog(a *app.App, err error) {
	if err != nil && a != nil && a.Log != nil {
		a.Log.Error("request notification", "err", err)
	}
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// PortalRequests lists the requests of the caller's visible projects (a customer: all of their
// projects' requests, not only their own), optionally one project's.
func PortalRequests(ctx context.Context, a *app.App, projectRef string) ([]Request, error) {
	s, err := scope(ctx, authz.PortalRead)
	if err != nil {
		return nil, err
	}
	sv := work.New(a)
	var ids []string
	if strings.TrimSpace(projectRef) != "" {
		p, err := sv.VisibleProject(ctx, projectRef)
		if err != nil {
			return nil, work.NewError(http.StatusNotFound, "project not found")
		}
		ids = []string{p.ID}
	} else if ids, err = sv.VisibleProjectIDs(ctx); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []Request{}, nil
	}
	return queryRequests(ctx, a.SQLDB, s, `AND r.project_id = ANY($2)`, ids)
}

// ListRequests is the staff Requests inbox (manager+): state "" = pending, "all" = every state.
func ListRequests(ctx context.Context, a *app.App, state, projectRef string) ([]Request, error) {
	s, err := scope(ctx, authz.RequestsManage)
	if err != nil {
		return nil, err
	}
	where, args := "", []any{}
	switch state = strings.TrimSpace(state); state {
	case "", "pending", "accepted", "declined", "converted":
		args = append(args, firstNonEmpty(state, "pending"))
		where += fmt.Sprintf(" AND r.request_state = $%d", len(args)+1)
	case "all":
	default:
		return nil, work.NewError(http.StatusUnprocessableEntity, "state must be pending, accepted, declined, converted or all")
	}
	if strings.TrimSpace(projectRef) != "" {
		p, err := work.New(a).FindProject(ctx, projectRef)
		if err != nil {
			return nil, err
		}
		args = append(args, p.ID)
		where += fmt.Sprintf(" AND r.project_id = $%d", len(args)+1)
	}
	return queryRequests(ctx, a.SQLDB, s, where, args...)
}

// loadRequest loads any request (any state) for a manager, with its current state.
func loadRequest(ctx context.Context, a *app.App, key string) (*tenant.Scope, *Report, string, error) {
	s, err := scope(ctx, authz.RequestsManage)
	if err != nil {
		return nil, nil, "", err
	}
	rep, err := Find(ctx, a.SQLDB, s.WorkspaceID, key)
	if err != nil || rep.RequestState == nil {
		return nil, nil, "", work.NewError(http.StatusNotFound, "request not found")
	}
	return s, rep, *rep.RequestState, nil
}

// triage loads a pending request for a manager.
func triage(ctx context.Context, a *app.App, key string) (*tenant.Scope, *Report, error) {
	s, rep, state, err := loadRequest(ctx, a, key)
	if err != nil {
		return nil, nil, err
	}
	if state != "pending" {
		return nil, nil, work.NewError(http.StatusConflict, "this request was already "+state+" — reopen it first")
	}
	return s, rep, nil
}

// settle moves a request from one of `from` to `to` (guarded against a concurrent triage), sets
// the extra columns in `set` ($5… are args), and appends the change to request_history.
func settle(ctx context.Context, a *app.App, s *tenant.Scope, rep *Report, from []string, to, note, set string, args ...any) error {
	if set != "" {
		set = ", " + set
	}
	decided := "request_decided_at = now(), request_decided_by = $3"
	if to == "pending" {
		decided = "request_decided_at = NULL, request_decided_by = NULL"
	}
	noteArg, fromArg := 5+len(args), 6+len(args)
	q := fmt.Sprintf(`UPDATE reports SET request_state = $4%s, %s,
		request_history = request_history || jsonb_build_array(jsonb_build_object('state', $4::text, 'at', now(), 'by', $3::text, 'note', $%d::text)),
		updated_at = now()
		WHERE workspace_id = $1 AND id = $2 AND request_state = ANY($%d)`, set, decided, noteArg, fromArg)
	all := append([]any{s.WorkspaceID, rep.ID, s.UserID, to}, args...)
	all = append(all, note, from)
	res, err := a.SQLDB.ExecContext(ctx, q, all...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return work.NewError(http.StatusConflict, "this request changed meanwhile — reload it")
	}
	return nil
}

func tellRequester(ctx context.Context, a *app.App, rep *Report, kind, title string, extra map[string]any) {
	if rep.ReporterID == nil {
		return
	}
	data := map[string]any{"request_key": rep.Key, "request_title": rep.Title}
	for k, v := range extra {
		data[k] = v
	}
	url := "/w/{slug}/portal"
	if rep.ProjectID != nil {
		url += "/projects/" + *rep.ProjectID + "?tab=requests"
		data["project_id"] = *rep.ProjectID
	}
	notifyLog(a, work.New(a).NotifyUsers(ctx, []string{*rep.ReporterID}, work.Note{Kind: kind, Title: title, URL: url, Data: data}))
}

// RequestEvent is one step of a request's life.
type RequestEvent struct {
	State string    `json:"state" doc:"pending (filed or reopened), accepted, declined or converted"`
	At    time.Time `json:"at"`
	By    *string   `json:"by" doc:"User id (the requester for the filing)"`
	Note  *string   `json:"note"`
}

// RequestComment is one entry of the request's thread (the staff view: author ids included).
type RequestComment struct {
	ID         string    `json:"id"`
	AuthorID   *string   `json:"author_id"`
	AuthorKind string    `json:"author_kind"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

// RequestDetail is one request for the staff inbox: the request, its history and its thread.
type RequestDetail struct {
	Request
	ReporterEmail *string          `json:"reporter_email"`
	History       []RequestEvent   `json:"history"`
	Comments      []RequestComment `json:"comments"`
	TaskProjectID *string          `json:"task_project_id" doc:"Project of the task a converted request became"`
}

// GetRequest returns one request in ANY state (manager+) — the inbox's detail view.
func GetRequest(ctx context.Context, a *app.App, key string) (*RequestDetail, error) {
	s, rep, _, err := loadRequest(ctx, a, key)
	if err != nil {
		return nil, err
	}
	return requestDetail(ctx, a, s, rep.ID)
}

func requestDetail(ctx context.Context, a *app.App, s *tenant.Scope, id string) (*RequestDetail, error) {
	r, err := oneRequest(ctx, a.SQLDB, s, id)
	if err != nil {
		return nil, err
	}
	d := &RequestDetail{Request: *r, History: []RequestEvent{}, Comments: []RequestComment{}}
	d.History = append(d.History, RequestEvent{State: "pending", At: r.CreatedAt, By: r.ReporterID})
	var raw []byte
	if err := a.SQLDB.QueryRowContext(ctx, `SELECT request_history FROM reports WHERE workspace_id = $1 AND id = $2`,
		s.WorkspaceID, id).Scan(&raw); err != nil {
		return nil, err
	}
	var hist []RequestEvent
	if err := json.Unmarshal(raw, &hist); err == nil {
		for _, h := range hist {
			if h.Note != nil && *h.Note == "" {
				h.Note = nil
			}
			d.History = append(d.History, h)
		}
	}
	cs, err := Comments(ctx, a.SQLDB, s.WorkspaceID, id)
	if err != nil {
		return nil, err
	}
	for _, c := range cs {
		d.Comments = append(d.Comments, RequestComment{ID: c.ID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind, Body: c.Body, CreatedAt: c.CreatedAt})
	}
	if r.ReporterID != nil && a.SysDB != nil {
		var email string
		if a.SysDB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, *r.ReporterID).Scan(&email) == nil {
			d.ReporterEmail = &email
		}
	}
	if r.TaskKey != nil {
		var pid string
		if a.SQLDB.QueryRowContext(ctx, `SELECT project_id FROM tasks WHERE workspace_id = $1 AND key = $2`,
			s.WorkspaceID, *r.TaskKey).Scan(&pid) == nil {
			d.TaskProjectID = &pid
		}
	}
	return d, nil
}

// RequestCounts are the inbox's per-state counts.
type RequestCounts struct {
	Pending   int `json:"pending"`
	Accepted  int `json:"accepted"`
	Declined  int `json:"declined"`
	Converted int `json:"converted"`
	All       int `json:"all"`
}

// CountRequests counts the workspace's requests by state (manager+).
func CountRequests(ctx context.Context, a *app.App) (*RequestCounts, error) {
	s, err := scope(ctx, authz.RequestsManage)
	if err != nil {
		return nil, err
	}
	c := &RequestCounts{}
	err = a.SQLDB.QueryRowContext(ctx, `SELECT
			count(*) FILTER (WHERE request_state = 'pending'), count(*) FILTER (WHERE request_state = 'accepted'),
			count(*) FILTER (WHERE request_state = 'declined'), count(*) FILTER (WHERE request_state = 'converted'), count(*)
		FROM reports WHERE workspace_id = $1 AND request_state IS NOT NULL`, s.WorkspaceID).
		Scan(&c.Pending, &c.Accepted, &c.Declined, &c.Converted, &c.All)
	return c, err
}

// AcceptInput places an accepted request on the board.
type AcceptInput struct {
	Status    string `json:"status,omitempty" doc:"Board column (default todo)"`
	Priority  string `json:"priority,omitempty" doc:"highest, high, medium, low or lowest"`
	IssueType string `json:"issue_type,omitempty" doc:"bug, feature, task, story or epic"`
	Reply     string `json:"reply,omitempty" maxLength:"2000" doc:"Optional note to the customer"`
}

// AcceptRequest converts a pending request into an issue: a normal issue on the board from now on.
func AcceptRequest(ctx context.Context, a *app.App, key string, in AcceptInput) (*Request, error) {
	s, rep, err := triage(ctx, a, key)
	if err != nil {
		return nil, err
	}
	status := firstNonEmpty(in.Status, "todo")
	if !ValidStatus(status) || status == "done" {
		return nil, work.NewError(http.StatusUnprocessableEntity, "unknown status "+status)
	}
	priority := firstNonEmpty(in.Priority, rep.Priority)
	if !oneOf(priority, Priorities) {
		return nil, work.NewError(http.StatusUnprocessableEntity, "unknown priority "+priority)
	}
	issueType := firstNonEmpty(in.IssueType, rep.IssueType)
	if !oneOf(issueType, Types) {
		return nil, work.NewError(http.StatusUnprocessableEntity, "unknown issue type "+issueType)
	}
	reply := truncate(strings.TrimSpace(in.Reply), 2000)
	if err := settle(ctx, a, s, rep, []string{"pending"}, "accepted", reply,
		`status = $5, priority = $6, issue_type = $7, request_reply = $8, state = 'open', closed_at = NULL`,
		status, priority, issueType, nullable(reply)); err != nil {
		return nil, err
	}
	_ = AddComment(ctx, a.SQLDB, rep, s.UserID, "user", fmt.Sprintf("Converted to issue %s (%s, %s priority).", rep.Key, status, priority))
	tellRequester(ctx, a, rep, "request.accepted", fmt.Sprintf("Your request %s was accepted: %s", rep.Key, rep.Title), nil)
	return oneRequest(ctx, a.SQLDB, s, rep.ID)
}

// DeclineRequest closes a pending request with a reason the customer sees.
func DeclineRequest(ctx context.Context, a *app.App, key, reason string) (*Request, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, work.NewError(http.StatusUnprocessableEntity, "say why — the customer sees the reason")
	}
	s, rep, err := triage(ctx, a, key)
	if err != nil {
		return nil, err
	}
	reason = truncate(reason, 2000)
	if err := settle(ctx, a, s, rep, []string{"pending"}, "declined", reason,
		`state = 'closed', closed_at = now(), request_reply = $5`, reason); err != nil {
		return nil, err
	}
	tellRequester(ctx, a, rep, "request.declined", fmt.Sprintf("Your request %s was declined: %s", rep.Key, rep.Title),
		map[string]any{"reason": truncate(reason, 200)})
	return oneRequest(ctx, a.SQLDB, s, rep.ID)
}

// ConvertRequest turns a pending request into a task (in its project, or another visible one),
// links them with a comment, and closes the request as converted.
func ConvertRequest(ctx context.Context, a *app.App, key, projectRef string) (*Request, string, error) {
	s, rep, err := triage(ctx, a, key)
	if err != nil {
		return nil, "", err
	}
	sv := work.New(a)
	projectID := ""
	if strings.TrimSpace(projectRef) != "" {
		p, err := sv.FindProject(ctx, projectRef)
		if err != nil {
			return nil, "", err
		}
		projectID = p.ID
	} else if rep.ProjectID != nil {
		projectID = *rep.ProjectID
	} else {
		return nil, "", work.NewError(http.StatusUnprocessableEntity, "name the project for the task")
	}
	title := rep.Title
	desc := fmt.Sprintf("From customer request %s.", rep.Key)
	if rep.Body != nil && strings.TrimSpace(*rep.Body) != "" {
		desc += "\n\n" + *rep.Body
	}
	var desired sql.NullString
	_ = a.SQLDB.QueryRowContext(ctx, `SELECT to_char(desired_on, 'YYYY-MM-DD') FROM reports WHERE workspace_id = $1 AND id = $2`,
		s.WorkspaceID, rep.ID).Scan(&desired)
	in := work.TaskInput{Title: &title, Description: &desc}
	if desired.Valid && desired.String != "" {
		in.DueAt = &desired.String
	}
	task, err := sv.CreateTask(ctx, projectID, in)
	if err != nil {
		return nil, "", err
	}
	reply := "Planned as task " + task.Key
	if err := settle(ctx, a, s, rep, []string{"pending"}, "converted", reply,
		`state = 'closed', closed_at = now(), request_reply = $5, request_task_key = $6`, reply, task.Key); err != nil {
		return nil, "", err
	}
	_ = AddComment(ctx, a.SQLDB, rep, s.UserID, "user", fmt.Sprintf("Converted to task %s.", task.Key))
	tellRequester(ctx, a, rep, "request.converted", fmt.Sprintf("Your request %s was planned: %s", rep.Key, rep.Title),
		map[string]any{"task_key": task.Key})
	out, err := oneRequest(ctx, a.SQLDB, s, rep.ID)
	return out, task.Key, err
}

// ReopenRequest undoes a decision (manager+): an accepted, declined or converted request goes back
// to pending — off the board, open, reply cleared. A task it became is kept (the note names it).
func ReopenRequest(ctx context.Context, a *app.App, key, note string) (*Request, error) {
	s, rep, state, err := loadRequest(ctx, a, key)
	if err != nil {
		return nil, err
	}
	if state == "pending" {
		return nil, work.NewError(http.StatusConflict, "this request is already pending")
	}
	note = truncate(strings.TrimSpace(note), 2000)
	var taskKey sql.NullString
	_ = a.SQLDB.QueryRowContext(ctx, `SELECT request_task_key FROM reports WHERE workspace_id = $1 AND id = $2`,
		s.WorkspaceID, rep.ID).Scan(&taskKey)
	if taskKey.Valid && taskKey.String != "" {
		note = strings.TrimSpace(fmt.Sprintf("Was %s as task %s (the task is kept). %s", state, taskKey.String, note))
	} else if note == "" {
		note = "Was " + state + "."
	}
	if err := settle(ctx, a, s, rep, []string{"accepted", "declined", "converted"}, "pending", note,
		`status = 'backlog', state = 'open', closed_at = NULL, request_reply = NULL, request_task_key = NULL`); err != nil {
		return nil, err
	}
	_ = AddComment(ctx, a.SQLDB, rep, s.UserID, "user", "Reopened for review. "+note)
	return oneRequest(ctx, a.SQLDB, s, rep.ID)
}

func desiredStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
