package work

import (
	"context"
	"database/sql"
	"strings"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
)

/*
The customer panel (roadmap 5): what a customer — a client-role portal contact — sees of each of
their projects. Everything here is an AGGREGATE: task counts by category and % done, hours used
against the hours budget, hours per week, and counts of recently completed tasks — plus what the
project shares with its customer (portal_share.go: team names, columns, the read-only board, the
money budget). It never returns a time entry, a rate or a task comment. Money appears only on invoices
that were sent (drafts hidden), and only to the client's own contacts or to invoice readers.

Access: authz.PortalRead (clients up) AND the project must be visible (visibleClause → 404). The
issue and request side lives in internal/reports (portal_panel.go, requests.go), which composes this.
*/

// PortalProject is one project as its customer sees it.
type PortalProject struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Description     *string    `json:"description"`
	Color           string     `json:"color"`
	Status          string     `json:"status" doc:"planned, active, on_hold, completed, cancelled"`
	StartsOn        *string    `json:"starts_on"`
	EndsOn          *string    `json:"ends_on"`
	ClientName      *string    `json:"client_name"`
	Archived        bool       `json:"archived"`
	Tasks           TaskCounts `json:"tasks" doc:"Counts only — task rows are never shown"`
	PercentDone     int        `json:"percent_done"`
	BudgetMinutes   *int64     `json:"budget_minutes" doc:"Hours budget in minutes (money budgets are not shown)"`
	UsedMinutes     int64      `json:"used_minutes" doc:"Tracked time on the project (stopped entries)"`
	OpenIssues      int        `json:"open_issues"`
	PendingRequests int        `json:"pending_requests"`
}

// PortalWeek is the tracked time of one week (Monday, workspace timezone).
type PortalWeek struct {
	Week    string `json:"week" doc:"YYYY-MM-DD of the Monday"`
	Minutes int64  `json:"minutes"`
}

// PortalProjectDetail is the customer panel of one project.
type PortalProjectDetail struct {
	PortalProject
	Weeks           []PortalWeek   `json:"weeks" doc:"The last 12 weeks, totals only"`
	Completed7d     int            `json:"completed_7d" doc:"Tasks completed in the last 7 days (count)"`
	Completed30d    int            `json:"completed_30d"`
	InvoicesVisible bool           `json:"invoices_visible"`
	Invoices        []Invoice      `json:"invoices" doc:"Sent/paid invoices of the project's client (drafts hidden)"`
	Share           PortalShare    `json:"share" doc:"What the team shares with you on this project"`
	Team            []PortalPerson `json:"team" doc:"The people on the project (when shared): names only"`
	Columns         []PortalColumn `json:"columns" doc:"Status columns with task counts (when the board is shared)"`
	BudgetAmount    *int64         `json:"budget_amount_minor" doc:"The money budget in minor units (only when shared)"`
	BudgetCurrency  *string        `json:"budget_currency"`
}

func percentDone(c TaskCounts) int {
	total := c.Todo + c.Doing + c.Done
	if total == 0 {
		return 0
	}
	return c.Done * 100 / total
}

func toPortal(p *Project) PortalProject {
	return PortalProject{ID: p.ID, Name: p.Name, Description: p.Description, Color: p.Color, Status: p.Status,
		StartsOn: p.StartsOn, EndsOn: p.EndsOn, ClientName: p.ClientName, Archived: p.ArchivedAt != nil,
		Tasks: p.Tasks, PercentDone: percentDone(p.Tasks), BudgetMinutes: p.BudgetMinutes}
}

// fillPortalCounts adds used minutes, open issues and pending requests to ps (one query each).
func (sv *Service) fillPortalCounts(ctx context.Context, ws string, ps []PortalProject) error {
	if len(ps) == 0 {
		return nil
	}
	ids := make([]string, len(ps))
	at := map[string]int{}
	for i, p := range ps {
		ids[i], at[p.ID] = p.ID, i
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT project_id, (COALESCE(sum(duration_s), 0) / 60)::bigint FROM time_entries
		WHERE workspace_id = $1 AND project_id = ANY($2) AND duration_s IS NOT NULL GROUP BY project_id`, ws, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var m int64
		if err := rows.Scan(&id, &m); err != nil {
			rows.Close()
			return err
		}
		ps[at[id]].UsedMinutes = m
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = sv.DB.QueryContext(ctx, `SELECT project_id,
			count(*) FILTER (WHERE state = 'open' AND (request_state IS NULL OR request_state = 'accepted')),
			count(*) FILTER (WHERE request_state = 'pending')
		FROM reports WHERE workspace_id = $1 AND project_id = ANY($2) GROUP BY project_id`, ws, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var open, pending int
		if err := rows.Scan(&id, &open, &pending); err != nil {
			return err
		}
		ps[at[id]].OpenIssues, ps[at[id]].PendingRequests = open, pending
	}
	return rows.Err()
}

// PortalProjects lists the caller's visible projects (for a client: their client's book) as
// customer-panel summaries, archived ones included last.
func (sv *Service) PortalProjects(ctx context.Context) ([]PortalProject, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.PortalRead); err != nil {
		return nil, err
	}
	if err := feature(ctx, s, limits.FeaturePortal); err != nil {
		return nil, err
	}
	args := []any{s.WorkspaceID}
	clause := visibleClause(s, &args)
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+projectCols+` FROM projects p WHERE p.workspace_id = $1 AND `+clause+`
		ORDER BY (p.archived_at IS NOT NULL), lower(p.name) LIMIT 500`, args...)
	if err != nil {
		return nil, err
	}
	out := []PortalProject{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, toPortal(p))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, sv.fillPortalCounts(ctx, s.WorkspaceID, out)
}

// PortalProject returns one project's customer panel, or 404 when the caller cannot see it.
func (sv *Service) PortalProject(ctx context.Context, ref string) (*PortalProjectDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.PortalRead); err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, strings.TrimSpace(ref))
	if err != nil {
		return nil, err
	}
	base := []PortalProject{toPortal(p)}
	if err := sv.fillPortalCounts(ctx, s.WorkspaceID, base); err != nil {
		return nil, err
	}
	d := &PortalProjectDetail{PortalProject: base[0], Weeks: []PortalWeek{}, Invoices: []Invoice{}}

	if d.Weeks, err = sv.portalWeeks(ctx, s.WorkspaceID, p.ID); err != nil {
		return nil, err
	}
	if err := sv.fillShared(ctx, s, p, d); err != nil {
		return nil, err
	}

	if err := sv.DB.QueryRowContext(ctx, `SELECT
			count(*) FILTER (WHERE completed_at >= now() - interval '7 days'),
			count(*) FILTER (WHERE completed_at >= now() - interval '30 days')
		FROM tasks WHERE workspace_id = $1 AND project_id = $2`, s.WorkspaceID, p.ID).Scan(&d.Completed7d, &d.Completed30d); err != nil {
		return nil, err
	}

	// Invoices: the project's client's sent invoices — to that client's own portal contacts, or
	// to someone who reads invoices anyway (manager+). Nobody else sees money here.
	if p.ClientID != nil {
		mine, _ := sv.portalClientID(ctx, s)
		if mine == *p.ClientID || authz.Can(s.Role, authz.InvoicesRead) {
			d.InvoicesVisible = true
			irows, err := sv.DB.QueryContext(ctx, `SELECT `+invoiceCols+
				`WHERE i.workspace_id = $1 AND i.client_id = $2 AND i.status <> 'draft'
				 ORDER BY i.issue_date DESC, i.number DESC LIMIT 200`, s.WorkspaceID, *p.ClientID)
			if err != nil {
				return nil, err
			}
			defer irows.Close()
			for irows.Next() {
				iv, err := scanInvoice(irows)
				if err != nil {
					return nil, err
				}
				d.Invoices = append(d.Invoices, *iv)
			}
			if err := irows.Err(); err != nil {
				return nil, err
			}
		}
	}
	return d, nil
}

// VisibleProjectIDs lists the ids of every project the caller can see (archived included).
func (sv *Service) VisibleProjectIDs(ctx context.Context) ([]string, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ProjectsRead); err != nil {
		return nil, err
	}
	args := []any{s.WorkspaceID}
	clause := visibleClause(s, &args)
	rows, err := sv.DB.QueryContext(ctx, `SELECT p.id FROM projects p WHERE p.workspace_id = $1 AND `+clause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ---- notifications for the request portal ----------------------------------------------------

// Note is an in-app notification another package (internal/reports) sends through the inbox.
// URL may contain {slug}, replaced with the workspace slug.
type Note struct {
	Kind, Title, Body, URL string
	Data                   map[string]any
}

// NotifyUsers writes n to each user's inbox (never the caller, only active members) in one
// transaction, and pushes it on the realtime channel after commit.
func (sv *Service) NotifyUsers(ctx context.Context, users []string, n Note) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	users = dedupe(users)
	if len(users) == 0 {
		return nil
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		var slug string
		if err := tx.QueryRowContext(ctx, `SELECT slug FROM workspaces WHERE id = $1`, s.WorkspaceID).Scan(&slug); err != nil {
			return err
		}
		data := map[string]any{"actor_id": s.UserID, "actor": s.Email}
		for k, v := range n.Data {
			data[k] = v
		}
		for _, u := range users {
			if u == "" || u == s.UserID {
				continue
			}
			var active bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active')`,
				s.WorkspaceID, u).Scan(&active); err != nil {
				return err
			}
			if !active {
				continue
			}
			nt, err := notify(ctx, tx, s.WorkspaceID, u, newNote{Kind: n.Kind, Title: n.Title, Body: n.Body,
				URL: strings.ReplaceAll(n.URL, "{slug}", slug), Data: data})
			if err != nil {
				return err
			}
			queueNote(tx, s.WorkspaceID, u, nt)
		}
		return nil
	})
}

// ManagerIDs lists the workspace's active managers, admins and owners (the Requests inbox).
func (sv *Service) ManagerIDs(ctx context.Context) ([]string, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT user_id FROM workspace_members WHERE workspace_id = $1
		AND status = 'active' AND role IN ('manager', 'admin', 'owner')`, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// NewError builds a caller-safe domain error (status + message) for packages composing work.
func NewError(status int, msg string) error { return &Error{Status: status, Msg: msg} }
