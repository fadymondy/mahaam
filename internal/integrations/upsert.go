package integrations

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/tenant"
)

// ExternalIssue is one issue from a provider, already mapped to Mahaam's vocabulary.
type ExternalIssue struct {
	Source     string // github | jira | linear
	ExternalID string // the provider's stable id
	Key        string // human key: owner/repo#12, PROJ-7, ENG-3
	URL        string
	Title      string
	Body       string
	Status     string // a reports.Statuses value
	IssueType  string // bug | feature | task | story | epic
	Priority   string // highest | high | medium | low | lowest
	// OpenClosedOnly: the provider only knows open/closed (GitHub). An open external issue
	// then leaves a Mahaam status such as in_progress alone instead of resetting it.
	OpenClosedOnly bool
}

func (x ExternalIssue) closed() bool { return x.Status == "done" }

func (x ExternalIssue) state() string {
	if x.closed() {
		return "closed"
	}
	return "open"
}

// upsertIssue creates the Mahaam issue for x in projectID, or updates the one already imported
// (unique (workspace_id, external_source, external_id)). Creation goes through reports.Create so
// the MG-n key comes from the workspace's shared counter; updates through reports.Update.
func (sv *Service) upsertIssue(ctx context.Context, s *tenant.Scope, projectID string, x ExternalIssue) (created bool, rep *reports.Report, err error) {
	x.Title = strings.TrimSpace(x.Title)
	if x.Title == "" {
		x.Title = "(untitled " + x.Key + ")"
	}
	x.Title = truncate(x.Title, 500)
	x.Body = truncate(x.Body, 100_000)
	if !reports.ValidStatus(x.Status) {
		x.Status = "backlog"
	}
	for attempt := 0; attempt < 3; attempt++ {
		id, err := sv.findExternal(ctx, s.WorkspaceID, x.Source, x.ExternalID)
		if err != nil {
			return false, nil, err
		}
		if id != "" {
			rep, err := sv.updateExisting(ctx, s, id, x)
			return false, rep, err
		}
		rep, err := reports.Create(ctx, sv.DB, s.WorkspaceID, reports.NewReport{
			Title: x.Title, Body: x.Body, IssueType: x.IssueType, Status: x.Status, Priority: x.Priority,
			ProjectID: projectID, Source: x.Source, ReporterID: reporter(s),
		})
		if err != nil {
			return false, nil, err
		}
		_, err = sv.DB.ExecContext(ctx, `UPDATE reports SET external_source = $3, external_id = $4, external_key = $5,
			external_url = $6, external_state = $7 WHERE workspace_id = $1 AND id = $2`,
			s.WorkspaceID, rep.ID, x.Source, x.ExternalID, nullable(x.Key), nullable(x.URL), x.state())
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			// A concurrent import (webhook vs sync) linked the same external issue first: drop
			// the duplicate we just made and update theirs.
			_, _ = sv.DB.ExecContext(ctx, `DELETE FROM reports WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, rep.ID)
			continue
		}
		if err != nil {
			return false, nil, err
		}
		return true, rep, nil
	}
	return false, nil, errors.New("could not link the imported issue")
}

func (sv *Service) findExternal(ctx context.Context, workspaceID, source, externalID string) (string, error) {
	var id string
	err := sv.DB.QueryRowContext(ctx, `SELECT id FROM reports WHERE workspace_id = $1 AND external_source = $2 AND external_id = $3`,
		workspaceID, source, externalID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func (sv *Service) updateExisting(ctx context.Context, s *tenant.Scope, id string, x ExternalIssue) (*reports.Report, error) {
	rep, err := reports.Find(ctx, sv.DB, s.WorkspaceID, id)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{}
	if rep.Title != x.Title {
		fields["title"] = x.Title
	}
	if cur := deref(rep.Body); cur != x.Body {
		fields["body"] = nullable(x.Body)
	}
	status := x.Status
	if x.OpenClosedOnly && !x.closed() {
		status = rep.Status
		if rep.Status == "done" {
			status = "todo" // reopened on GitHub
		}
	}
	if status != rep.Status {
		fields["status"] = status
		switch {
		case status == "done":
			fields["state"], fields["closed_at"] = "closed", time.Now().UTC()
		case rep.Status == "done":
			fields["state"], fields["closed_at"] = "open", nil
		}
	}
	if !x.OpenClosedOnly {
		// Jira / Linear own the classification of an imported issue.
		if x.Priority != "" && x.Priority != rep.Priority {
			fields["priority"] = x.Priority
		}
		if x.IssueType != "" && x.IssueType != rep.IssueType {
			fields["issue_type"] = x.IssueType
		}
	}
	if len(fields) > 0 {
		if err := reports.Update(ctx, sv.DB, rep, fields); err != nil {
			return nil, err
		}
	}
	if _, err := sv.DB.ExecContext(ctx, `UPDATE reports SET external_key = $3, external_url = $4, external_state = $5
		WHERE workspace_id = $1 AND id = $2 AND (external_key IS DISTINCT FROM $3 OR external_url IS DISTINCT FROM $4 OR external_state IS DISTINCT FROM $5)`,
		s.WorkspaceID, rep.ID, nullable(x.Key), nullable(x.URL), x.state()); err != nil {
		return nil, err
	}
	return rep, nil
}

func reporter(s *tenant.Scope) string {
	if s.UserID == "" || s.UserID == "system" {
		return ""
	}
	return s.UserID
}

func nullable(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
