package reports

// Moderation for the shared comment threads (App Store guideline 1.2, Google Play's UGC policy).
// Workspaces are private and invite-only, but comments still reach other people, so:
//
//	delete  a member removes their own reply on an issue (managers: anyone's) and a customer their
//	        own reply in the portal. Task comments already had DELETE /api/w/comments/{comment}.
//	report  anyone who can see a comment can report it: POST /api/w/comments/{comment}/report
//	        (task, issue and portal threads alike). The report is kept as a workspace-level activity
//	        entry (no project, so the reporter is not named in a project feed) and mailed to the
//	        workspace owners and admins and to the platform's support address, which reviews
//	        reports within 24 hours (Terms → Acceptable use). Reporting twice is a no-op.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/mail"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

// CommentReportInput is the optional reason a person gives when reporting a comment.
type CommentReportInput struct {
	Reason string `json:"reason,omitempty" maxLength:"500" doc:"Why the comment is reported (optional)"`
}

// CommentReported confirms a report was filed (or had been already).
type CommentReported struct {
	Reported bool `json:"reported"`
}

// defaultSupportEmail is where reports go when SUPPORT_EMAIL is unset: the address the support
// page and the store listings publish.
const defaultSupportEmail = "info@3x1.io"

func supportEmail() string {
	if v := strings.TrimSpace(os.Getenv("SUPPORT_EMAIL")); v != "" {
		return v
	}
	return defaultSupportEmail
}

// reportedComment is what a report is about.
type reportedComment struct {
	ID, Kind, AuthorID, Body, Key string
}

// findReportable resolves a comment the caller can see: a task comment (staff only, on a project
// they can see) or an issue comment (staff with feedback:read; a customer only on their projects).
func findReportable(ctx context.Context, a *app.App, s *tenant.Scope, id string) (*reportedComment, error) {
	notFound := work.NewError(http.StatusNotFound, "comment not found")
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, notFound
	}
	var author sql.NullString
	var body, projectID, key string
	err := a.SQLDB.QueryRowContext(ctx, `SELECT c.author_id, c.body, t.project_id, t.key FROM task_comments c
		JOIN tasks t ON t.workspace_id = c.workspace_id AND t.id = c.task_id
		WHERE c.workspace_id = $1 AND c.id = $2`, s.WorkspaceID, id).Scan(&author, &body, &projectID, &key)
	switch {
	case err == nil:
		if s.Role == string(authz.Client) {
			return nil, notFound
		}
		if _, err := work.New(a).VisibleProject(ctx, projectID); err != nil {
			return nil, notFound
		}
		return &reportedComment{ID: id, Kind: "task", AuthorID: author.String, Body: body, Key: key}, nil
	case !errors.Is(err, sql.ErrNoRows):
		return nil, err
	}

	var reportID string
	err = a.SQLDB.QueryRowContext(ctx, `SELECT report_id, author_id, body FROM report_comments
		WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, id).Scan(&reportID, &author, &body)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound
	}
	if err != nil {
		return nil, err
	}
	var rep *Report
	if s.Role == string(authz.Client) {
		_, rep, err = portalIssue(ctx, a, authz.PortalRead, reportID)
	} else if authz.Can(s.Role, authz.FeedbackRead) {
		rep, err = Find(ctx, a.SQLDB, s.WorkspaceID, reportID)
	} else {
		return nil, notFound
	}
	if err != nil || rep == nil {
		return nil, notFound
	}
	return &reportedComment{ID: id, Kind: "issue", AuthorID: author.String, Body: body, Key: rep.Key}, nil
}

// ReportComment files a report about a comment the caller can see.
func ReportComment(ctx context.Context, a *app.App, id, reason string) error {
	s, ok := tenant.From(ctx)
	if !ok || s.WorkspaceID == "" || s.UserID == "" {
		return work.NewError(http.StatusNotFound, "workspace not found")
	}
	c, err := findReportable(ctx, a, s, id)
	if err != nil {
		return err
	}
	if c.AuthorID != "" && c.AuthorID == s.UserID {
		return work.NewError(http.StatusUnprocessableEntity, "you cannot report your own comment — delete it instead")
	}
	reason = truncate(strings.TrimSpace(reason), 500)

	var already bool
	if err := a.SQLDB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM activity_logs
		WHERE workspace_id = $1 AND action = 'comment.reported' AND subject_id = $2 AND actor_id = $3)`,
		s.WorkspaceID, c.ID, s.UserID).Scan(&already); err != nil {
		return err
	}
	if already {
		return nil
	}
	if err := work.RecordActivity(ctx, a.SQLDB, s, work.ActivityEntry{
		Action: "comment.reported", SubjectType: "comment", SubjectID: c.ID,
		Changes: map[string]any{"key": c.Key, "kind": c.Kind, "author_id": c.AuthorID, "excerpt": truncate(c.Body, 280), "reason": reason},
	}); err != nil {
		return err
	}
	notifyCommentReport(a, s, c, reason)
	return nil
}

// notifyCommentReport mails the workspace's owners and admins and support, in the background.
func notifyCommentReport(a *app.App, s *tenant.Scope, c *reportedComment, reason string) {
	sv := work.New(a)
	if sv.Mail == nil {
		return
	}
	to := []string{supportEmail()}
	var wsName, slug string
	if a.SysDB != nil {
		_ = a.SysDB.QueryRow(`SELECT name, slug FROM workspaces WHERE id = $1`, s.WorkspaceID).Scan(&wsName, &slug)
		rows, err := a.SysDB.Query(`SELECT u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = $1 AND m.role IN ('owner', 'admin') AND m.status = 'active'`, s.WorkspaceID)
		if err == nil {
			for rows.Next() {
				var e string
				if rows.Scan(&e) == nil && strings.Contains(e, "@") && !strings.EqualFold(e, to[0]) {
					to = append(to, e)
				}
			}
			rows.Close()
		}
	}
	reporter := s.Email
	if reporter == "" {
		reporter = s.UserID
	}
	if reason == "" {
		reason = "(none given)"
	}
	text := fmt.Sprintf("A comment was reported in the workspace %q (%s).\n\nWhere: %s %s\nComment id: %s\nAuthor id: %s\nReported by: %s\nReason: %s\n\nComment:\n%s\n\n"+
		"Please review it within 24 hours. A workspace owner or manager can delete the comment and remove the member in Mahaam.\n",
		wsName, slug, c.Kind, c.Key, c.ID, c.AuthorID, reporter, reason, truncate(c.Body, 2000))
	msg := mail.Message{To: to, Subject: fmt.Sprintf("[Mahaam] Reported comment on %s", c.Key), Text: text}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := sv.Mail.Send(ctx, msg); err != nil && a.Log != nil {
			a.Log.Warn("comment report mail", "err", err, "comment", c.ID)
		}
	}()
}

// DeleteIssueComment removes a reply on an issue: the caller's own (staff with feedback:read, or a
// customer on their project); comments:moderate (managers) may remove anyone's except on the
// customer side.
func DeleteIssueComment(ctx context.Context, a *app.App, key, id string, portal bool) error {
	var s *tenant.Scope
	var rep *Report
	var err error
	if portal {
		s, rep, err = portalIssue(ctx, a, authz.PortalWrite, key)
	} else {
		s, err = scope(ctx, authz.FeedbackRead)
		if err == nil {
			rep, err = Find(ctx, a.SQLDB, s.WorkspaceID, key)
			if err != nil {
				err = work.NewError(http.StatusNotFound, "issue not found")
			}
		}
	}
	if err != nil {
		return err
	}
	var author sql.NullString
	var body string
	err = a.SQLDB.QueryRowContext(ctx, `SELECT author_id, body FROM report_comments WHERE workspace_id = $1 AND report_id = $2 AND id = $3`,
		s.WorkspaceID, rep.ID, strings.TrimSpace(id)).Scan(&author, &body)
	if errors.Is(err, sql.ErrNoRows) {
		return work.NewError(http.StatusNotFound, "comment not found")
	}
	if err != nil {
		return err
	}
	mine := author.Valid && author.String == s.UserID
	if !mine && (portal || !authz.Can(s.Role, authz.CommentsModerate)) {
		return work.NewError(http.StatusForbidden, "you can only delete your own comments")
	}
	tx, err := a.SQLDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, `DELETE FROM report_comments WHERE workspace_id = $1 AND report_id = $2 AND id = $3`,
		s.WorkspaceID, rep.ID, strings.TrimSpace(id)); err != nil {
		return err
	}
	var projectID, taskID string
	if rep.ProjectID != nil {
		projectID = *rep.ProjectID
	}
	_ = tx.QueryRowContext(ctx, `SELECT COALESCE(task_id, '') FROM reports WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, rep.ID).Scan(&taskID)
	if err := work.RecordActivity(ctx, tx, s, work.ActivityEntry{ProjectID: projectID, TaskID: taskID,
		Action: "comment.deleted", SubjectType: "comment", SubjectID: strings.TrimSpace(id),
		Changes: map[string]any{"key": rep.Key, "author_id": author.String}}); err != nil {
		return err
	}
	return tx.Commit()
}

// registerCommentModeration mounts the delete and report routes.
func registerCommentModeration(api huma.API, h *issueRoutes) {
	a := h.app
	huma.Register(api, huma.Operation{
		OperationID: "w-report-comment", Method: http.MethodPost, Path: "/api/w/comments/{comment}/report",
		Summary: "Report a comment you can see (task, issue or portal thread) to the workspace owners and support",
		Tags:    []string{"Comments"},
	}, func(ctx context.Context, in *struct {
		work.WS
		work.CommentRef
		Body *CommentReportInput `required:"false"`
	}) (*work.Resp[CommentReported], error) {
		reason := ""
		if in.Body != nil {
			reason = in.Body.Reason
		}
		if err := ReportComment(ctx, a, in.Comment, reason); err != nil {
			return nil, h.domain(err)
		}
		return &work.Resp[CommentReported]{Body: CommentReported{Reported: true}}, nil
	})
	huma.Register(api, huma.Operation{
		OperationID: "w-delete-issue-comment", Method: http.MethodDelete, Path: "/api/w/issues/{key}/comments/{comment}",
		Summary: "Delete your reply on an issue (managers: any)", Tags: []string{"Issues"}, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *struct {
		work.WS
		IssueKeyRef
		work.CommentRef
	}) (*struct{}, error) {
		if err := DeleteIssueComment(ctx, a, in.Key, in.Comment, false); err != nil {
			return nil, h.domain(err)
		}
		return nil, nil
	})
	huma.Register(api, huma.Operation{
		OperationID: "w-portal-delete-issue-comment", Method: http.MethodDelete, Path: "/api/w/portal/issues/{key}/comments/{comment}",
		Summary: "Delete your own reply on an issue of your project", Tags: []string{"Client portal"}, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *struct {
		work.WS
		IssueKeyRef
		work.CommentRef
	}) (*struct{}, error) {
		if err := DeleteIssueComment(ctx, a, in.Key, in.Comment, true); err != nil {
			return nil, h.domain(err)
		}
		return nil, nil
	})
}
