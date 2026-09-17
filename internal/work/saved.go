package work

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/fadymondy/managy/internal/authz"
)

/*
Saved report views (saved_reports). A view is its owner's; shared (manager+) makes it visible to
every member, read-only. Only the owner — or an admin, for a shared view — changes or deletes it.
A view stores filters, never results: opening it runs the report with the opener's own rights.
*/

// SavedReport is one saved view.
type SavedReport struct {
	ID        string      `json:"id"`
	OwnerID   string      `json:"owner_id"`
	Name      string      `json:"name"`
	Kind      string      `json:"kind" doc:"time, budget or profitability"`
	Filters   ReportQuery `json:"filters"`
	Shared    bool        `json:"shared"`
	Mine      bool        `json:"mine"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

// SavedReportInput creates or changes a view; absent fields stay.
type SavedReportInput struct {
	Name    *string      `json:"name,omitempty" maxLength:"120"`
	Kind    *string      `json:"kind,omitempty" enum:"time,budget,profitability"`
	Filters *ReportQuery `json:"filters,omitempty"`
	Shared  *bool        `json:"shared,omitempty"`
}

// SavedReportList is the body of GET /api/w/saved-reports.
type SavedReportList struct {
	Reports []SavedReport `json:"reports"`
}

const savedCols = `id, owner_id, name, kind, filters, shared, created_at, updated_at`

func scanSaved(r scanner, me string) (*SavedReport, error) {
	v := &SavedReport{}
	var raw string
	if err := r.Scan(&v.ID, &v.OwnerID, &v.Name, &v.Kind, &raw, &v.Shared, &v.CreatedAt, &v.UpdatedAt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(raw), &v.Filters)
	v.Mine = v.OwnerID == me
	return v, nil
}

func savedKindAllowed(role, kind string) bool {
	if kind == "profitability" {
		return authz.Can(role, authz.ReportsFinance)
	}
	return authz.Can(role, authz.ReportsRead)
}

// ListSavedReports lists the caller's views and the shared ones they may open.
func (sv *Service) ListSavedReports(ctx context.Context) (*SavedReportList, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ReportsRead); err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+savedCols+` FROM saved_reports WHERE workspace_id = $1 AND (owner_id = $2 OR shared)
		ORDER BY lower(name), id`, s.WorkspaceID, s.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &SavedReportList{Reports: []SavedReport{}}
	for rows.Next() {
		v, err := scanSaved(rows, s.UserID)
		if err != nil {
			return nil, err
		}
		if savedKindAllowed(s.Role, v.Kind) {
			out.Reports = append(out.Reports, *v)
		}
	}
	return out, rows.Err()
}

func cleanQuery(q ReportQuery) (string, error) {
	q.From, q.To, q.GroupBy, q.Billable = strings.TrimSpace(q.From), strings.TrimSpace(q.To), strings.TrimSpace(q.GroupBy), strings.TrimSpace(q.Billable)
	q.Users, q.Projects, q.Clients, q.Labels = cleanIDs(q.Users), cleanIDs(q.Projects), cleanIDs(q.Clients), cleanIDs(q.Labels)
	if q.GroupBy != "" {
		if err := oneOf("group_by", q.GroupBy, ReportGroups...); err != nil {
			return "", err
		}
	}
	for _, d := range []string{q.From, q.To} {
		if _, err := parseDay(d); err != nil {
			return "", err
		}
	}
	b, err := json.Marshal(q)
	return string(b), err
}

func (sv *Service) savedReport(ctx context.Context, id string) (*SavedReport, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := scanSaved(sv.DB.QueryRowContext(ctx, `SELECT `+savedCols+` FROM saved_reports WHERE workspace_id = $1 AND id = $2
		AND (owner_id = $3 OR shared)`, s.WorkspaceID, strings.TrimSpace(id), s.UserID), s.UserID)
	if err != nil {
		if e, ok := AsError(err); ok && e.Status == 404 {
			return nil, notFound("saved report")
		}
		return nil, err
	}
	if !savedKindAllowed(s.Role, v.Kind) {
		return nil, notFound("saved report")
	}
	return v, nil
}

// CreateSavedReport saves a view for the caller.
func (sv *Service) CreateSavedReport(ctx context.Context, in SavedReportInput) (*SavedReport, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ReportsRead); err != nil {
		return nil, err
	}
	name, _ := trimmed(in.Name)
	if name == "" {
		return nil, invalid("a saved report needs a name")
	}
	kind := "time"
	if v, ok := trimmed(in.Kind); ok && v != "" {
		kind = v
	}
	if err := oneOf("kind", kind, "time", "budget", "profitability"); err != nil {
		return nil, err
	}
	if !savedKindAllowed(s.Role, kind) {
		return nil, forbidden("your role cannot save this kind of report")
	}
	shared := in.Shared != nil && *in.Shared
	if shared {
		if err := require(s, authz.ReportsShare); err != nil {
			return nil, err
		}
	}
	filters := "{}"
	if in.Filters != nil {
		if filters, err = cleanQuery(*in.Filters); err != nil {
			return nil, err
		}
	}
	return scanSaved(sv.DB.QueryRowContext(ctx, `INSERT INTO saved_reports (workspace_id, owner_id, name, kind, filters, shared)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+savedCols, s.WorkspaceID, s.UserID, name, kind, filters, shared), s.UserID)
}

// UpdateSavedReport changes a view (its owner; an admin may change a shared one).
func (sv *Service) UpdateSavedReport(ctx context.Context, id string, in SavedReportInput) (*SavedReport, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := sv.savedReport(ctx, id)
	if err != nil {
		return nil, err
	}
	if !v.Mine && !authz.Role(s.Role).AtLeast(authz.Admin) {
		return nil, forbidden("only its owner changes a saved report")
	}
	name, kind, shared := v.Name, v.Kind, v.Shared
	if n, ok := trimmed(in.Name); ok {
		if n == "" {
			return nil, invalid("a saved report needs a name")
		}
		name = n
	}
	if k, ok := trimmed(in.Kind); ok && k != "" {
		if err := oneOf("kind", k, "time", "budget", "profitability"); err != nil {
			return nil, err
		}
		if !savedKindAllowed(s.Role, k) {
			return nil, forbidden("your role cannot save this kind of report")
		}
		kind = k
	}
	if in.Shared != nil && *in.Shared != shared {
		if err := require(s, authz.ReportsShare); err != nil {
			return nil, err
		}
		shared = *in.Shared
	}
	filters, _ := json.Marshal(v.Filters)
	raw := string(filters)
	if in.Filters != nil {
		if raw, err = cleanQuery(*in.Filters); err != nil {
			return nil, err
		}
	}
	return scanSaved(sv.DB.QueryRowContext(ctx, `UPDATE saved_reports SET name = $3, kind = $4, filters = $5, shared = $6, updated_at = now()
		WHERE workspace_id = $1 AND id = $2 RETURNING `+savedCols, s.WorkspaceID, v.ID, name, kind, raw, shared), s.UserID)
}

// DeleteSavedReport removes a view (its owner; an admin may remove a shared one).
func (sv *Service) DeleteSavedReport(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	v, err := sv.savedReport(ctx, id)
	if err != nil {
		return err
	}
	if !v.Mine && !authz.Role(s.Role).AtLeast(authz.Admin) {
		return forbidden("only its owner deletes a saved report")
	}
	_, err = sv.DB.ExecContext(ctx, `DELETE FROM saved_reports WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, v.ID)
	return err
}
