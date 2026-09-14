package work

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/fadymondy/managy/internal/authz"
)

// Client is a customer of the workspace. No ledger: billing arrives with invoices (P6).
type Client struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Email            *string    `json:"email"`
	Phone            *string    `json:"phone"`
	Country          *string    `json:"country" doc:"ISO 3166-1 alpha-2"`
	Currency         string     `json:"currency" doc:"ISO 4217"`
	DefaultRateMinor *int64     `json:"default_rate_minor" doc:"Hourly rate in minor units"`
	Notes            *string    `json:"notes"`
	ArchivedAt       *time.Time `json:"archived_at"`
	ProjectCount     int        `json:"project_count"`
	CreatedAt        time.Time  `json:"created_at"`
}

const clientCols = `c.id, c.name, c.email, c.phone, c.country, c.currency, c.default_rate_minor, c.notes,
	c.archived_at, c.created_at,
	(SELECT count(*) FROM projects p WHERE p.workspace_id = c.workspace_id AND p.client_id = c.id AND p.archived_at IS NULL)`

func scanClient(r scanner) (*Client, error) {
	c := &Client{}
	err := r.Scan(&c.ID, &c.Name, &c.Email, &c.Phone, &c.Country, &c.Currency, &c.DefaultRateMinor, &c.Notes,
		&c.ArchivedAt, &c.CreatedAt, &c.ProjectCount)
	return c, err
}

// ClientInput creates or patches a client. On a patch, an omitted field is unchanged and an
// empty string clears a nullable one.
type ClientInput struct {
	Name             *string `json:"name,omitempty" maxLength:"120"`
	Email            *string `json:"email,omitempty"`
	Phone            *string `json:"phone,omitempty" maxLength:"40"`
	Country          *string `json:"country,omitempty" doc:"ISO 3166-1 alpha-2, e.g. EG"`
	Currency         *string `json:"currency,omitempty" doc:"ISO 4217, e.g. USD"`
	DefaultRateMinor *int64  `json:"default_rate_minor,omitempty" doc:"Minor units per hour; negative clears"`
	Notes            *string `json:"notes,omitempty" maxLength:"4000"`
}

var (
	countryRe  = regexp.MustCompile(`^[A-Z]{2}$`)
	currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)
)

// ListClients lists the workspace's clients (active first).
func (sv *Service) ListClients(ctx context.Context, includeArchived bool) ([]Client, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ClientsRead); err != nil {
		return nil, err
	}
	q := `SELECT ` + clientCols + ` FROM clients c WHERE c.workspace_id = $1`
	if !includeArchived {
		q += ` AND c.archived_at IS NULL`
	}
	rows, err := sv.DB.QueryContext(ctx, q+` ORDER BY c.archived_at NULLS FIRST, lower(c.name)`, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Client{}
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// GetClient returns one client by id, or by exact name (case-insensitive) for MCP callers.
func (sv *Service) GetClient(ctx context.Context, ref string) (*Client, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ClientsRead); err != nil {
		return nil, err
	}
	return findClient(ctx, sv.DB, s.WorkspaceID, ref)
}

func findClient(ctx context.Context, q querier, ws, ref string) (*Client, error) {
	ref = strings.TrimSpace(ref)
	rows, err := q.QueryContext(ctx, `SELECT `+clientCols+` FROM clients c
		WHERE c.workspace_id = $1 AND (c.id = $2 OR lower(c.name) = lower($2)) ORDER BY c.created_at`, ws, ref)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var found []*Client
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return nil, err
		}
		if c.ID == ref {
			return c, nil
		}
		found = append(found, c)
	}
	switch len(found) {
	case 0:
		return nil, notFound("client")
	case 1:
		return found[0], nil
	}
	return nil, invalid("%d clients are named %q — use the id", len(found), ref)
}

func clientValues(in ClientInput, p *patch) error {
	if v, ok := trimmed(in.Name); ok {
		if v == "" {
			return invalid("a client needs a name")
		}
		p.set("name", v)
	}
	if v, ok := trimmed(in.Email); ok {
		if v != "" {
			addr, err := mail.ParseAddress(v)
			if err != nil {
				return invalid("%q is not an email address", v)
			}
			v = strings.ToLower(addr.Address)
		}
		p.set("email", nullIfEmpty(v))
	}
	if v, ok := trimmed(in.Phone); ok {
		p.set("phone", nullIfEmpty(v))
	}
	if v, ok := trimmed(in.Country); ok {
		v = strings.ToUpper(v)
		if v != "" && !countryRe.MatchString(v) {
			return invalid("country must be a two-letter ISO code, e.g. EG")
		}
		p.set("country", nullIfEmpty(v))
	}
	if v, ok := trimmed(in.Currency); ok {
		v = strings.ToUpper(v)
		if !currencyRe.MatchString(v) {
			return invalid("currency must be a three-letter ISO code, e.g. USD")
		}
		p.set("currency", v)
	}
	if in.DefaultRateMinor != nil {
		if *in.DefaultRateMinor < 0 {
			p.set("default_rate_minor", nil)
		} else {
			p.set("default_rate_minor", *in.DefaultRateMinor)
		}
	}
	if v, ok := trimmed(in.Notes); ok {
		p.set("notes", nullIfEmpty(v))
	}
	return nil
}

// CreateClient adds a client (managers and up). The currency defaults to the workspace's.
func (sv *Service) CreateClient(ctx context.Context, in ClientInput) (*Client, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ClientsWrite); err != nil {
		return nil, err
	}
	if v, _ := trimmed(in.Name); v == "" {
		return nil, invalid("a client needs a name")
	}
	p := newPatch()
	if err := clientValues(in, p); err != nil {
		return nil, err
	}
	if _, ok := p.changes["currency"]; !ok {
		var cur string
		if err := sv.DB.QueryRowContext(ctx, `SELECT currency FROM workspaces WHERE id = $1`, s.WorkspaceID).Scan(&cur); err != nil {
			return nil, err
		}
		p.set("currency", cur)
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		cols, marks, args := p.insert(s.WorkspaceID)
		if err := tx.QueryRowContext(ctx, `INSERT INTO clients (`+cols+`) VALUES (`+marks+`) RETURNING id`, args...).Scan(&id); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "client.created", SubjectType: "client", SubjectID: id,
			Changes: map[string]any{"name": p.changes["name"]}})
	})
	if err != nil {
		return nil, err
	}
	return findClient(ctx, sv.DB, s.WorkspaceID, id)
}

// UpdateClient patches a client (managers and up).
func (sv *Service) UpdateClient(ctx context.Context, ref string, in ClientInput) (*Client, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ClientsWrite); err != nil {
		return nil, err
	}
	c, err := findClient(ctx, sv.DB, s.WorkspaceID, ref)
	if err != nil {
		return nil, err
	}
	p := newPatch()
	if err := clientValues(in, p); err != nil {
		return nil, err
	}
	if p.empty() {
		return c, nil
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := p.update(ctx, tx, "clients", s.WorkspaceID, c.ID); err != nil {
			return err
		}
		p.changes["name"] = firstString(p.changes["name"], c.Name)
		return record(ctx, tx, s, entry{Action: "client.updated", SubjectType: "client", SubjectID: c.ID, Changes: p.changes})
	})
	if err != nil {
		return nil, err
	}
	return findClient(ctx, sv.DB, s.WorkspaceID, c.ID)
}

// SetClientArchived archives or restores a client. Its projects keep their link.
func (sv *Service) SetClientArchived(ctx context.Context, ref string, archived bool) (*Client, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ClientsWrite); err != nil {
		return nil, err
	}
	c, err := findClient(ctx, sv.DB, s.WorkspaceID, ref)
	if err != nil {
		return nil, err
	}
	action, expr := "client.archived", "now()"
	if !archived {
		action, expr = "client.restored", "NULL"
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE clients SET archived_at = `+expr+`, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, c.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: action, SubjectType: "client", SubjectID: c.ID, Changes: map[string]any{"name": c.Name}})
	})
	if err != nil {
		return nil, err
	}
	return findClient(ctx, sv.DB, s.WorkspaceID, c.ID)
}

// ---- patch builder ---------------------------------------------------------

// patch collects column assignments from allowlisted code paths (never from input keys).
type patch struct {
	cols    []string
	args    []any
	changes map[string]any
}

func newPatch() *patch { return &patch{changes: map[string]any{}} }

func (p *patch) set(col string, v any) {
	p.cols = append(p.cols, col)
	p.args = append(p.args, v)
	p.changes[col] = v
}

func (p *patch) empty() bool { return len(p.cols) == 0 }

// update runs UPDATE <table> SET … WHERE workspace_id = $1 AND id = $2.
func (p *patch) update(ctx context.Context, q querier, table, ws, id string) error {
	sets := make([]string, len(p.cols))
	for i, c := range p.cols {
		sets[i] = fmt.Sprintf("%s = $%d", c, i+3)
	}
	res, err := q.ExecContext(ctx, `UPDATE `+table+` SET `+strings.Join(sets, ", ")+`, updated_at = now()
		WHERE workspace_id = $1 AND id = $2`, append([]any{ws, id}, p.args...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("work: update matched no row")
	}
	return nil
}

// insert returns the column list, placeholders and args for an INSERT with workspace_id first.
func (p *patch) insert(ws string) (cols, marks string, args []any) {
	c := append([]string{"workspace_id"}, p.cols...)
	m := make([]string, len(c))
	for i := range c {
		m[i] = fmt.Sprintf("$%d", i+1)
	}
	return strings.Join(c, ", "), strings.Join(m, ", "), append([]any{ws}, p.args...)
}

func firstString(v any, def string) any {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return def
}
