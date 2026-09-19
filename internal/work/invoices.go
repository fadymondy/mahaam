package work

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	importexport "github.com/togo-framework/import-export"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
Invoices (plan: "Invoices from unbilled time"; P6). REST (/api/w/invoices*) and the MCP invoice
tools call these functions, so a browser and an agent share one authorization path and one activity
log, exactly like the rest of internal/work.

Money is minor units (bigint), never float. VAT is a rate (tax_rate, a fraction). Every money value
is in the invoice's currency, snapshotted when the draft is made. Drafting from time gathers a
client's unbilled, billable, finished entries in the invoice currency, groups them into lines and
LOCKS them (time_entries.invoice_id + locked_at) in the same transaction — which internal/work/time.go
already treats as immutable. Voiding the invoice releases its entries. Only a draft can be deleted.

Status is a small state machine: draft -> sent -> paid | void. Illegal transitions are refused.
Recording payments that cover the total flips a sent invoice to paid.
*/

// Invoice is one invoice as the API lists it (without its lines/payments; GetInvoice adds those).
type Invoice struct {
	ID            string    `json:"id"`
	Number        string    `json:"number"`
	ClientID      string    `json:"client_id"`
	ClientName    *string   `json:"client_name"`
	Status        string    `json:"status" doc:"draft, sent, paid or void"`
	Currency      string    `json:"currency"`
	IssueDate     string    `json:"issue_date" doc:"YYYY-MM-DD"`
	DueDate       *string   `json:"due_date" doc:"YYYY-MM-DD or null"`
	SubtotalMinor int64     `json:"subtotal_minor"`
	TaxRate       string    `json:"tax_rate" doc:"A fraction, e.g. \"0.14\" for 14%"`
	TaxMinor      int64     `json:"tax_minor"`
	TotalMinor    int64     `json:"total_minor"`
	PaidMinor     int64     `json:"paid_minor" doc:"Sum of recorded payments, minor units"`
	Notes         *string   `json:"notes"`
	CreatedBy     string    `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// InvoiceLine is one line of an invoice.
type InvoiceLine struct {
	ID                 string   `json:"id"`
	Description        string   `json:"description"`
	Quantity           string   `json:"quantity" doc:"Hours (decimal string)"`
	UnitMinor          int64    `json:"unit_minor" doc:"Per-hour rate, minor units"`
	AmountMinor        int64    `json:"amount_minor"`
	SourceTimeEntryIDs []string `json:"source_time_entry_ids" doc:"The time entries this line bills, if drafted from time"`
}

// InvoicePayment is one payment recorded against an invoice.
type InvoicePayment struct {
	ID          string    `json:"id"`
	AmountMinor int64     `json:"amount_minor"`
	PaidAt      time.Time `json:"paid_at"`
	Ref         *string   `json:"ref"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// InvoiceDetail is one invoice with its lines and payments.
type InvoiceDetail struct {
	Invoice
	Lines    []InvoiceLine    `json:"lines"`
	Payments []InvoicePayment `json:"payments"`
}

const invoiceCols = `i.id, i.number, i.client_id, c.name, i.status, i.currency,
	to_char(i.issue_date, 'YYYY-MM-DD'), to_char(i.due_date, 'YYYY-MM-DD'),
	i.subtotal_minor, i.tax_rate::text, i.tax_minor, i.total_minor,
	COALESCE((SELECT sum(p.amount_minor) FROM invoice_payments p WHERE p.workspace_id = i.workspace_id AND p.invoice_id = i.id), 0),
	i.notes, i.created_by, i.created_at, i.updated_at
	FROM invoices i
	LEFT JOIN clients c ON c.workspace_id = i.workspace_id AND c.id = i.client_id `

func scanInvoice(r scanner) (*Invoice, error) {
	iv := &Invoice{}
	err := r.Scan(&iv.ID, &iv.Number, &iv.ClientID, &iv.ClientName, &iv.Status, &iv.Currency,
		&iv.IssueDate, &iv.DueDate, &iv.SubtotalMinor, &iv.TaxRate, &iv.TaxMinor, &iv.TotalMinor,
		&iv.PaidMinor, &iv.Notes, &iv.CreatedBy, &iv.CreatedAt, &iv.UpdatedAt)
	if err == nil {
		iv.CreatedAt, iv.UpdatedAt = iv.CreatedAt.UTC(), iv.UpdatedAt.UTC()
		iv.TaxRate = trimRate(iv.TaxRate)
	}
	return iv, err
}

// trimRate drops trailing zeros from a numeric text so "0.1400" reads "0.14".
func trimRate(s string) string {
	if !strings.Contains(s, ".") {
		return s
	}
	s = strings.TrimRight(s, "0")
	return strings.TrimSuffix(s, ".")
}

// ---- money -----------------------------------------------------------------------------

// mulDivRound returns round(a * b / c) with banker-free half-up rounding, exactly (big integers),
// for c > 0. Used for amount = seconds * ratePerHour / 3600 and tax = subtotal * rate.
func mulDivRound(a, b, c int64) int64 {
	if c == 0 {
		return 0
	}
	n := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	d := big.NewInt(c)
	q, r := new(big.Int).QuoRem(n, d, new(big.Int))
	// half up on the remainder
	if new(big.Int).Mul(r, big.NewInt(2)).CmpAbs(d) >= 0 {
		if (a < 0) != (b < 0) {
			q.Sub(q, big.NewInt(1))
		} else {
			q.Add(q, big.NewInt(1))
		}
	}
	return q.Int64()
}

// taxMinor = round(subtotal * rate). rate is scaled by 10^4 (numeric(6,4)).
func taxMinorFromScaled(subtotal, rateScaled int64) int64 {
	return mulDivRound(subtotal, rateScaled, 10000)
}

// ---- number allocation ------------------------------------------------------------------

// NextInvoiceNumber allocates the next per-workspace, per-year sequence value under a row lock.
func NextInvoiceNumber(ctx context.Context, q querier, ws string, year int) (int64, error) {
	var n int64
	err := q.QueryRowContext(ctx, `
		INSERT INTO invoice_counters (workspace_id, year, value) VALUES ($1, $2, 1)
		ON CONFLICT (workspace_id, year) DO UPDATE SET value = invoice_counters.value + 1, updated_at = now()
		RETURNING value`, ws, year).Scan(&n)
	return n, err
}

func formatNumber(year int, n int64) string { return fmt.Sprintf("INV-%04d-%06d", year, n) }

// ---- listing / detail -------------------------------------------------------------------

// InvoiceFilter narrows ListInvoices.
type InvoiceFilter struct {
	ClientID string
	Status   string
	Limit    int
}

// ListInvoices lists the workspace's invoices, newest first (managers and up).
func (sv *Service) ListInvoices(ctx context.Context, f InvoiceFilter) ([]Invoice, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.InvoicesRead); err != nil {
		return nil, err
	}
	args := []any{s.WorkspaceID}
	where := "WHERE i.workspace_id = $1"
	if ref := strings.TrimSpace(f.ClientID); ref != "" {
		c, err := findClient(ctx, sv.DB, s.WorkspaceID, ref)
		if err != nil {
			return nil, err
		}
		args = append(args, c.ID)
		where += " AND i.client_id = $" + itoa(len(args))
	}
	if st := strings.TrimSpace(f.Status); st != "" {
		if err := oneOf("status", st, "draft", "sent", "paid", "void"); err != nil {
			return nil, err
		}
		args = append(args, st)
		where += " AND i.status = $" + itoa(len(args))
	}
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	args = append(args, limit)
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+invoiceCols+where+
		` ORDER BY i.issue_date DESC, i.number DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Invoice{}
	for rows.Next() {
		iv, err := scanInvoice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *iv)
	}
	return out, rows.Err()
}

// findInvoice loads one invoice header by id or number.
func findInvoice(ctx context.Context, q querier, ws, ref string) (*Invoice, error) {
	ref = strings.TrimSpace(ref)
	iv, err := scanInvoice(q.QueryRowContext(ctx, `SELECT `+invoiceCols+
		`WHERE i.workspace_id = $1 AND (i.id = $2 OR i.number = upper($2))`, ws, ref))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("invoice")
	}
	return iv, err
}

func (sv *Service) loadLines(ctx context.Context, ws, invID string) ([]InvoiceLine, error) {
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, description, quantity::text, unit_minor, amount_minor, source_time_entry_ids
		FROM invoice_lines WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY position, created_at`, ws, invID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvoiceLine{}
	for rows.Next() {
		l := InvoiceLine{}
		var raw []byte
		if err := rows.Scan(&l.ID, &l.Description, &l.Quantity, &l.UnitMinor, &l.AmountMinor, &raw); err != nil {
			return nil, err
		}
		l.Quantity = trimRate(l.Quantity)
		l.SourceTimeEntryIDs = []string{}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &l.SourceTimeEntryIDs)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (sv *Service) loadPayments(ctx context.Context, ws, invID string) ([]InvoicePayment, error) {
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, amount_minor, paid_at, ref, created_by, created_at
		FROM invoice_payments WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY paid_at, created_at`, ws, invID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvoicePayment{}
	for rows.Next() {
		p := InvoicePayment{}
		if err := rows.Scan(&p.ID, &p.AmountMinor, &p.PaidAt, &p.Ref, &p.CreatedBy, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.PaidAt, p.CreatedAt = p.PaidAt.UTC(), p.CreatedAt.UTC()
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetInvoice returns one invoice by number or id, with its lines and payments (managers and up).
func (sv *Service) GetInvoice(ctx context.Context, ref string) (*InvoiceDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	// Staff with invoices:read see any invoice. A customer (a portal contact) sees only their
	// own client's invoices that were sent (never drafts) — anything else does not exist for them.
	staff := authz.Can(s.Role, authz.InvoicesRead)
	contactOf := ""
	if !staff {
		if contactOf, err = sv.portalClientID(ctx, s); err != nil {
			return nil, notFound("invoice")
		}
	}
	iv, err := findInvoice(ctx, sv.DB, s.WorkspaceID, ref)
	if err != nil {
		return nil, err
	}
	if !staff && (iv.ClientID != contactOf || iv.Status == "draft") {
		return nil, notFound("invoice")
	}
	lines, err := sv.loadLines(ctx, s.WorkspaceID, iv.ID)
	if err != nil {
		return nil, err
	}
	pays, err := sv.loadPayments(ctx, s.WorkspaceID, iv.ID)
	if err != nil {
		return nil, err
	}
	return &InvoiceDetail{Invoice: *iv, Lines: lines, Payments: pays}, nil
}

// ---- draft from unbilled time -----------------------------------------------------------

// DraftInput drafts an invoice from a client's unbilled time.
type DraftInput struct {
	ClientID   string   `json:"client_id" doc:"Client id or exact name"`
	From       string   `json:"from,omitempty" doc:"YYYY-MM-DD (workspace timezone); default: no lower bound"`
	To         string   `json:"to,omitempty" doc:"YYYY-MM-DD (workspace timezone); default: today"`
	ProjectIDs []string `json:"project_ids,omitempty" doc:"Limit to these projects (ids or names)"`
	GroupBy    string   `json:"group_by,omitempty" enum:"project,task," doc:"Group lines by project (default) or task"`
	TaxRate    *string  `json:"tax_rate,omitempty" doc:"VAT as a fraction, e.g. 0.14; default 0"`
	DueDate    string   `json:"due_date,omitempty" doc:"YYYY-MM-DD"`
	Notes      string   `json:"notes,omitempty" maxLength:"4000"`
	// Besides time, bill the client's unbilled AI usage and due subscription periods up to
	// the end date (both default true). See billing_sources.go.
	IncludeAI            *bool `json:"include_ai,omitempty" doc:"Bill unbilled AI usage (default true)"`
	IncludeSubscriptions *bool `json:"include_subscriptions,omitempty" doc:"Bill due subscription periods (default true)"`
}

type gatheredEntry struct {
	ID        string
	ProjectID *string
	TaskID    *string
	TaskKey   *string
	TaskTitle *string
	ProjName  *string
	Seconds   int64
	Rate      int64 // bill_rate_minor, 0 if null
}

// parseRateScaled turns a fraction string ("0.14") into a scaled integer (1400 = 0.1400).
func parseRateScaled(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	neg := strings.HasPrefix(s, "-")
	if neg {
		return 0, invalid("tax_rate can't be negative")
	}
	whole, frac, _ := strings.Cut(s, ".")
	if whole == "" {
		whole = "0"
	}
	for _, c := range whole + frac {
		if c < '0' || c > '9' {
			return 0, invalid("%q is not a rate (a fraction like 0.14)", s)
		}
	}
	if len(frac) > 4 {
		return 0, invalid("tax_rate has at most 4 decimal places")
	}
	for len(frac) < 4 {
		frac += "0"
	}
	var w, f int64
	fmt.Sscanf(whole, "%d", &w)
	fmt.Sscanf(frac, "%d", &f)
	scaled := w*10000 + f
	if scaled > 100000 { // 10.0000
		return 0, invalid("tax_rate is unreasonably large")
	}
	return scaled, nil
}

// DraftFromTime creates a draft invoice from a client's unbilled, billable, finished time and locks
// those entries. Manager+. Entries not in the invoice currency are skipped (reported in the notes).
func (sv *Service) DraftFromTime(ctx context.Context, in DraftInput) (*InvoiceDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.InvoicesWrite); err != nil {
		return nil, err
	}
	cl, err := findClient(ctx, sv.DB, s.WorkspaceID, in.ClientID)
	if err != nil {
		return nil, err
	}
	groupBy := strings.TrimSpace(in.GroupBy)
	if groupBy == "" {
		groupBy = "project"
	}
	if err := oneOf("group_by", groupBy, "project", "task"); err != nil {
		return nil, err
	}
	rateScaled := int64(0)
	if in.TaxRate != nil {
		if rateScaled, err = parseRateScaled(*in.TaxRate); err != nil {
			return nil, err
		}
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	currency := cl.Currency
	if currency == "" {
		currency = conf.Currency
	}
	due, err := localDay(in.DueDate, conf.Loc)
	if err != nil {
		return nil, err
	}
	// Resolve any project filter to ids the caller can see.
	var projIDs []string
	for _, ref := range dedupe(in.ProjectIDs) {
		p, err := sv.FindProject(ctx, ref)
		if err != nil {
			return nil, err
		}
		if p.ClientID == nil || *p.ClientID != cl.ID {
			return nil, invalid("%s is not a project of %s", p.Name, cl.Name)
		}
		projIDs = append(projIDs, p.ID)
	}
	from, err := localDay(in.From, conf.Loc)
	if err != nil {
		return nil, err
	}
	to, err := localDay(in.To, conf.Loc)
	if err != nil {
		return nil, err
	}

	args := []any{s.WorkspaceID, cl.ID, currency}
	where := `WHERE e.workspace_id = $1 AND e.client_id = $2 AND e.currency = $3
		AND e.billable = true AND e.ended_at IS NOT NULL AND e.invoice_id IS NULL AND e.locked_at IS NULL`
	if from != nil {
		args = append(args, from.UTC())
		where += " AND e.started_at >= $" + itoa(len(args))
	}
	if to != nil {
		until := time.Date(to.Year(), to.Month(), to.Day()+1, 0, 0, 0, 0, conf.Loc)
		args = append(args, until.UTC())
		where += " AND e.started_at < $" + itoa(len(args))
	}
	if len(projIDs) > 0 {
		args = append(args, projIDs)
		where += " AND e.project_id = ANY($" + itoa(len(args)) + ")"
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT e.id, e.project_id, e.task_id, t.key, t.title, p.name, e.duration_s,
		COALESCE(e.bill_rate_minor, 0)
		FROM time_entries e
		LEFT JOIN projects p ON p.workspace_id = e.workspace_id AND p.id = e.project_id
		LEFT JOIN tasks t ON t.workspace_id = e.workspace_id AND t.id = e.task_id `+where+
		` ORDER BY p.name, t.key`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var gathered []gatheredEntry
	for rows.Next() {
		g := gatheredEntry{}
		var dur *int64
		if err := rows.Scan(&g.ID, &g.ProjectID, &g.TaskID, &g.TaskKey, &g.TaskTitle, &g.ProjName, &dur, &g.Rate); err != nil {
			return nil, err
		}
		if dur != nil {
			g.Seconds = *dur
		}
		gathered = append(gathered, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	untilDay := time.Now().In(conf.Loc)
	if to != nil {
		untilDay = *to
	}
	untilDay = time.Date(untilDay.Year(), untilDay.Month(), untilDay.Day(), 0, 0, 0, 0, time.UTC)
	var fromDay *time.Time
	if from != nil {
		f := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
		fromDay = &f
	}
	extras, err := sv.gatherExtras(ctx, sv.DB, s.WorkspaceID, cl.ID, currency, projIDs, fromDay, untilDay,
		in.IncludeAI == nil || *in.IncludeAI, in.IncludeSubscriptions == nil || *in.IncludeSubscriptions)
	if err != nil {
		return nil, err
	}
	if len(gathered) == 0 && len(extras) == 0 {
		return nil, invalid("there is nothing unbilled for %s in that range and currency (time, AI usage or subscriptions)", cl.Name)
	}

	type lineAgg struct {
		key     string
		desc    string
		unit    int64
		seconds int64
		ids     []string
	}
	order := []string{}
	agg := map[string]*lineAgg{}
	for _, g := range gathered {
		var groupKey, desc string
		if groupBy == "task" && g.TaskKey != nil {
			groupKey = "t:" + *g.TaskKey
			desc = *g.TaskKey
			if g.TaskTitle != nil && *g.TaskTitle != "" {
				desc += " " + *g.TaskTitle
			}
		} else if g.ProjName != nil {
			groupKey = "p:" + sval(g.ProjectID)
			desc = *g.ProjName
		} else {
			groupKey = "none"
			desc = "Unassigned time"
		}
		// A line carries one rate; different rates in the same group split into separate lines.
		key := fmt.Sprintf("%s|%d", groupKey, g.Rate)
		a := agg[key]
		if a == nil {
			a = &lineAgg{key: key, desc: desc, unit: g.Rate}
			agg[key] = a
			order = append(order, key)
		}
		a.seconds += g.Seconds
		a.ids = append(a.ids, g.ID)
	}
	sort.Strings(order)

	year := time.Now().In(conf.Loc).Year()
	if in.From == "" && in.To != "" && to != nil {
		year = to.Year()
	}

	var invID, number string
	var subtotal int64
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		n, err := NextInvoiceNumber(ctx, tx, s.WorkspaceID, year)
		if err != nil {
			return err
		}
		number = formatNumber(year, n)
		notes := strings.TrimSpace(in.Notes)
		var dueArg any
		if due != nil {
			dueArg = due.Format("2006-01-02")
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO invoices
			(workspace_id, client_id, number, status, currency, issue_date, due_date, tax_rate, notes, created_by)
			VALUES ($1, $2, $3, 'draft', $4, current_date, $5, $6::numeric/10000, $7, $8) RETURNING id`,
			s.WorkspaceID, cl.ID, number, currency, dueArg, rateScaled, nullIfEmpty(notes), s.UserID).Scan(&invID); err != nil {
			return err
		}
		pos := 1.0
		for _, key := range order {
			a := agg[key]
			amount := mulDivRound(a.seconds, a.unit, 3600)
			subtotal += amount
			idsJSON, _ := json.Marshal(a.ids)
			// quantity in hours, 4 dp: seconds/3600.
			if _, err := tx.ExecContext(ctx, `INSERT INTO invoice_lines
				(workspace_id, invoice_id, description, quantity, unit_minor, amount_minor, source_time_entry_ids, position)
				VALUES ($1, $2, $3, round($4::numeric/3600, 4), $5, $6, $7, $8)`,
				s.WorkspaceID, invID, a.desc, a.seconds, a.unit, amount, idsJSON, pos); err != nil {
				return err
			}
			pos++
		}
		for _, x := range extras {
			subtotal += x.amount
			if _, err := tx.ExecContext(ctx, `INSERT INTO invoice_lines
				(workspace_id, invoice_id, description, quantity, unit_minor, amount_minor, position)
				VALUES ($1, $2, $3, 1, $4, $4, $5)`, s.WorkspaceID, invID, truncate(x.desc, 2000), x.amount, pos); err != nil {
				return err
			}
			pos++
		}
		if err := lockExtras(ctx, tx, s.WorkspaceID, invID, currency, extras); err != nil {
			return err
		}
		tax := taxMinorFromScaled(subtotal, rateScaled)
		total := subtotal + tax
		if _, err := tx.ExecContext(ctx, `UPDATE invoices SET subtotal_minor = $3, tax_minor = $4, total_minor = $5, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, invID, subtotal, tax, total); err != nil {
			return err
		}
		// Lock exactly the gathered entries onto this invoice (immutable afterwards). The WHERE keeps
		// the guarantee that only still-unbilled, unlocked rows are taken, even under a race.
		ids := make([]string, 0, len(gathered))
		for _, g := range gathered {
			ids = append(ids, g.ID)
		}
		res, err := tx.ExecContext(ctx, `UPDATE time_entries SET invoice_id = $2, locked_at = now(), updated_at = now()
			WHERE workspace_id = $1 AND id = ANY($3) AND invoice_id IS NULL AND locked_at IS NULL`,
			s.WorkspaceID, invID, ids)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); int(n) != len(ids) {
			return conflict("some of that time was billed or locked while the invoice was being drafted — try again")
		}
		return record(ctx, tx, s, entry{Action: "invoice.drafted", SubjectType: "invoice", SubjectID: invID,
			Changes: map[string]any{"number": number, "client": cl.Name, "total_minor": total, "currency": currency, "entries": len(ids), "extra_lines": len(extras)}})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetInvoice(ctx, invID)
}

// ---- status transitions -----------------------------------------------------------------

// allowed[from][to] is a legal status transition.
var invoiceTransitions = map[string]map[string]bool{
	"draft": {"sent": true, "void": true},
	"sent":  {"paid": true, "void": true},
	"paid":  {},
	"void":  {},
}

// SetInvoiceStatus moves an invoice through draft -> sent -> paid | void. Voiding releases the
// invoice's locked time entries. Manager+.
func (sv *Service) SetInvoiceStatus(ctx context.Context, ref, status string) (*InvoiceDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.InvoicesWrite); err != nil {
		return nil, err
	}
	status = strings.ToLower(strings.TrimSpace(status))
	if err := oneOf("status", status, "draft", "sent", "paid", "void"); err != nil {
		return nil, err
	}
	iv, err := findInvoice(ctx, sv.DB, s.WorkspaceID, ref)
	if err != nil {
		return nil, err
	}
	if iv.Status == status {
		return sv.GetInvoice(ctx, iv.ID)
	}
	if !invoiceTransitions[iv.Status][status] {
		return nil, conflict(fmt.Sprintf("an invoice can't go from %s to %s", iv.Status, status))
	}
	if status == "paid" && iv.PaidMinor < iv.TotalMinor {
		return nil, conflict("record a payment covering the total before marking it paid")
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE invoices SET status = $3, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, iv.ID, status); err != nil {
			return err
		}
		if status == "void" {
			if _, err := tx.ExecContext(ctx, `UPDATE time_entries SET invoice_id = NULL, locked_at = NULL, updated_at = now()
				WHERE workspace_id = $1 AND invoice_id = $2`, s.WorkspaceID, iv.ID); err != nil {
				return err
			}
			if err := releaseExtras(ctx, tx, s.WorkspaceID, iv.ID); err != nil {
				return err
			}
		}
		return record(ctx, tx, s, entry{Action: "invoice." + status, SubjectType: "invoice", SubjectID: iv.ID,
			Changes: map[string]any{"number": iv.Number, "from": iv.Status, "to": status}})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetInvoice(ctx, iv.ID)
}

// ---- payments ----------------------------------------------------------------------------

// PaymentInput records a payment against an invoice.
type PaymentInput struct {
	AmountMinor int64  `json:"amount_minor" minimum:"1" doc:"Minor units, in the invoice currency"`
	PaidAt      string `json:"paid_at,omitempty" doc:"RFC 3339; default now"`
	Ref         string `json:"ref,omitempty" maxLength:"200" doc:"A reference (transfer id, cheque no.)"`
}

// RecordPayment adds a payment; when the recorded payments cover the total, the invoice flips to
// paid. Payments are refused on a draft or a void invoice. Manager+.
func (sv *Service) RecordPayment(ctx context.Context, ref string, in PaymentInput) (*InvoiceDetail, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.InvoicesWrite); err != nil {
		return nil, err
	}
	if in.AmountMinor <= 0 {
		return nil, invalid("a payment must be a positive amount in minor units")
	}
	iv, err := findInvoice(ctx, sv.DB, s.WorkspaceID, ref)
	if err != nil {
		return nil, err
	}
	if iv.Status == "draft" {
		return nil, conflict("send the invoice before recording a payment")
	}
	if iv.Status == "void" {
		return nil, conflict("this invoice is void")
	}
	var paidAt *time.Time
	if paidAt, err = parseWhen(in.PaidAt); err != nil {
		return nil, err
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		var when any = time.Now().UTC()
		if paidAt != nil {
			when = *paidAt
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO invoice_payments (workspace_id, invoice_id, amount_minor, paid_at, ref, created_by)
			VALUES ($1, $2, $3, $4, $5, $6)`, s.WorkspaceID, iv.ID, in.AmountMinor, when, nullIfEmpty(strings.TrimSpace(in.Ref)), s.UserID); err != nil {
			return err
		}
		var paid int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(sum(amount_minor), 0) FROM invoice_payments
			WHERE workspace_id = $1 AND invoice_id = $2`, s.WorkspaceID, iv.ID).Scan(&paid); err != nil {
			return err
		}
		newStatus := iv.Status
		if paid >= iv.TotalMinor && iv.Status == "sent" {
			newStatus = "paid"
			if _, err := tx.ExecContext(ctx, `UPDATE invoices SET status = 'paid', updated_at = now()
				WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, iv.ID); err != nil {
				return err
			}
		}
		return record(ctx, tx, s, entry{Action: "invoice.payment", SubjectType: "invoice", SubjectID: iv.ID,
			Changes: map[string]any{"number": iv.Number, "amount_minor": in.AmountMinor, "paid_minor": paid, "status": newStatus}})
	})
	if err != nil {
		return nil, err
	}
	return sv.GetInvoice(ctx, iv.ID)
}

// ---- delete ------------------------------------------------------------------------------

// DeleteInvoice deletes a draft invoice, releasing its locked entries. Only a draft can be deleted.
func (sv *Service) DeleteInvoice(ctx context.Context, ref string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.InvoicesWrite); err != nil {
		return err
	}
	iv, err := findInvoice(ctx, sv.DB, s.WorkspaceID, ref)
	if err != nil {
		return err
	}
	if iv.Status != "draft" {
		return conflict("only a draft invoice can be deleted — void a sent invoice instead")
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE time_entries SET invoice_id = NULL, locked_at = NULL, updated_at = now()
			WHERE workspace_id = $1 AND invoice_id = $2`, s.WorkspaceID, iv.ID); err != nil {
			return err
		}
		if err := releaseExtras(ctx, tx, s.WorkspaceID, iv.ID); err != nil {
			return err
		}
		// invoice_lines and invoice_payments cascade on the composite FK.
		res, err := tx.ExecContext(ctx, `DELETE FROM invoices WHERE workspace_id = $1 AND id = $2 AND status = 'draft'`, s.WorkspaceID, iv.ID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return conflict("the invoice is no longer a draft")
		}
		return record(ctx, tx, s, entry{Action: "invoice.deleted", SubjectType: "invoice", SubjectID: iv.ID,
			Changes: map[string]any{"number": iv.Number}})
	})
}

// ---- unbilled (for the client page's reserved slot) --------------------------------------

// Unbilled is a client's unbilled, billable, finished time and its value in the client currency.
type Unbilled struct {
	Currency    string `json:"currency"`
	Seconds     int64  `json:"seconds"`
	AmountMinor int64  `json:"amount_minor"`
	EntryCount  int    `json:"entry_count"`
}

// ClientUnbilled returns the value of a client's unbilled billable time (entries with invoice_id
// NULL, in the client currency). It powers the "unbilled value" on the client page. Manager+.
func (sv *Service) ClientUnbilled(ctx context.Context, ref string) (*Unbilled, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.InvoicesRead); err != nil {
		return nil, err
	}
	cl, err := findClient(ctx, sv.DB, s.WorkspaceID, ref)
	if err != nil {
		return nil, err
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	currency := cl.Currency
	if currency == "" {
		currency = conf.Currency
	}
	u := &Unbilled{Currency: currency}
	rows, err := sv.DB.QueryContext(ctx, `SELECT COALESCE(duration_s, 0), COALESCE(bill_rate_minor, 0)
		FROM time_entries WHERE workspace_id = $1 AND client_id = $2 AND currency = $3
		AND billable = true AND ended_at IS NOT NULL AND invoice_id IS NULL AND locked_at IS NULL`,
		s.WorkspaceID, cl.ID, currency)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var sec, rate int64
		if err := rows.Scan(&sec, &rate); err != nil {
			return nil, err
		}
		u.Seconds += sec
		u.AmountMinor += mulDivRound(sec, rate, 3600)
		u.EntryCount++
	}
	return u, rows.Err()
}

// ListClientInvoices lists one client's invoices (fills the client page's Invoices slot).
func (sv *Service) ListClientInvoices(ctx context.Context, ref string) ([]Invoice, error) {
	cl, err := func() (*Client, error) {
		s, err := caller(ctx)
		if err != nil {
			return nil, err
		}
		if err := require(s, authz.InvoicesRead); err != nil {
			return nil, err
		}
		return findClient(ctx, sv.DB, s.WorkspaceID, ref)
	}()
	if err != nil {
		return nil, err
	}
	return sv.ListInvoices(ctx, InvoiceFilter{ClientID: cl.ID})
}

// ---- export and print --------------------------------------------------------------------

var invoiceHeaders = map[string]map[string]string{
	"en": {"description": "Description", "hours": "Hours", "unit": "Unit rate", "amount": "Amount",
		"subtotal": "Subtotal", "tax": "VAT", "total": "Total", "paid": "Paid", "due": "Amount due"},
	"ar": {"description": "الوصف", "hours": "الساعات", "unit": "سعر الوحدة", "amount": "المبلغ",
		"subtotal": "المجموع الفرعي", "tax": "ضريبة القيمة المضافة", "total": "الإجمالي", "paid": "المدفوع", "due": "المستحق"},
}

func invHead(lang string) map[string]string {
	if h, ok := invoiceHeaders[lang]; ok {
		return h
	}
	return invoiceHeaders["en"]
}

// ExportInvoice renders an invoice's line items as CSV or XLSX.
func (sv *Service) ExportInvoice(ctx context.Context, ref, format, lang string) (*ExportFile, error) {
	iv, err := sv.GetInvoice(ctx, ref)
	if err != nil {
		return nil, err
	}
	if format == "" {
		format = "csv"
	}
	if err := oneOf("format", format, "csv", "xlsx"); err != nil {
		return nil, err
	}
	h := invHead(lang)
	cols := []string{h["description"], h["hours"], h["unit"] + " (" + iv.Currency + ")", h["amount"] + " (" + iv.Currency + ")"}
	t := ExportTable{Columns: cols}
	for _, l := range iv.Lines {
		t.Rows = append(t.Rows, map[string]any{cols[0]: safeCell(l.Description), cols[1]: l.Quantity,
			cols[2]: Money(l.UnitMinor), cols[3]: Money(l.AmountMinor)})
	}
	t.Rows = append(t.Rows,
		map[string]any{cols[0]: h["subtotal"], cols[3]: Money(iv.SubtotalMinor)},
		map[string]any{cols[0]: h["tax"] + " (" + iv.TaxRate + ")", cols[3]: Money(iv.TaxMinor)},
		map[string]any{cols[0]: h["total"], cols[3]: Money(iv.TotalMinor)})
	ie := sv.Sheet
	if ie == nil {
		ie = &importexport.Service{}
	}
	data, err := ie.Export(ctx, t.Rows, importexport.ExportOpts{Format: format, Columns: t.Columns, Sheet: iv.Number})
	if err != nil {
		return nil, err
	}
	f := &ExportFile{Name: fmt.Sprintf("%s.%s", iv.Number, format), Data: data, ContentType: "text/csv; charset=utf-8"}
	if format == "xlsx" {
		f.ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	} else {
		f.Data = append([]byte("\xEF\xBB\xBF"), data...)
	}
	return f, nil
}

// InvoicePrintHTML renders a clean, printable invoice as a self-contained HTML document.
func (sv *Service) InvoicePrintHTML(ctx context.Context, ref, lang string) (string, error) {
	iv, err := sv.GetInvoice(ctx, ref)
	if err != nil {
		return "", err
	}
	var wsName string
	_ = sv.DB.QueryRowContext(ctx, `SELECT name FROM workspaces WHERE id = (SELECT workspace_id FROM invoices WHERE id = $1)`, iv.ID).Scan(&wsName)
	h := invHead(lang)
	dir := "ltr"
	if lang == "ar" {
		dir = "rtl"
	}
	esc := htmlEscape
	var b strings.Builder
	fmt.Fprintf(&b, `<!doctype html><html lang="%s" dir="%s"><head><meta charset="utf-8">`, lang, dir)
	fmt.Fprintf(&b, `<title>%s</title><style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:0;padding:40px;background:#fff}
.wrap{max-width:800px;margin:0 auto}
.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
h1{font-size:22px;margin:0 0 4px}
.muted{color:#666;font-size:13px}
.num{font-variant-numeric:tabular-nums}
table{width:100%%;border-collapse:collapse;margin-top:24px;font-size:14px}
th,td{padding:8px 10px;text-align:%s;border-bottom:1px solid #e5e5e5}
td.n,th.n{text-align:%s;font-variant-numeric:tabular-nums}
tfoot td{border:none;padding-top:6px}
tfoot tr:last-child td{font-weight:700;font-size:16px;border-top:2px solid #111;padding-top:10px}
.status{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;border:1px solid #ccc;text-transform:uppercase;letter-spacing:.04em}
@media print{body{padding:0}.wrap{max-width:none}@page{margin:18mm}}
</style></head><body><div class="wrap">`, esc(iv.Number), textAlign(dir), endAlign(dir))
	fmt.Fprintf(&b, `<div class="top"><div><h1>%s</h1><div class="muted">%s</div></div>`, esc(wsName), esc(sval(iv.ClientName)))
	fmt.Fprintf(&b, `<div style="text-align:%s"><div class="num" style="font-size:18px;font-weight:600">%s</div>`, endAlign(dir), esc(iv.Number))
	fmt.Fprintf(&b, `<div class="muted">%s</div><div class="status">%s</div></div></div>`, esc(iv.IssueDate), esc(iv.Status))
	fmt.Fprintf(&b, `<table><thead><tr><th>%s</th><th class="n">%s</th><th class="n">%s</th><th class="n">%s</th></tr></thead><tbody>`,
		esc(h["description"]), esc(h["hours"]), esc(h["unit"]), esc(h["amount"]))
	for _, l := range iv.Lines {
		fmt.Fprintf(&b, `<tr><td>%s</td><td class="n">%s</td><td class="n">%s</td><td class="n">%s %s</td></tr>`,
			esc(l.Description), esc(l.Quantity), esc(Money(l.UnitMinor)), esc(iv.Currency), esc(Money(l.AmountMinor)))
	}
	b.WriteString(`</tbody><tfoot>`)
	row := func(label, val string) {
		fmt.Fprintf(&b, `<tr><td colspan="3">%s</td><td class="n">%s %s</td></tr>`, esc(label), esc(iv.Currency), esc(val))
	}
	row(h["subtotal"], Money(iv.SubtotalMinor))
	row(h["tax"]+" ("+iv.TaxRate+")", Money(iv.TaxMinor))
	if iv.PaidMinor > 0 {
		row(h["paid"], Money(iv.PaidMinor))
		row(h["due"], Money(iv.TotalMinor-iv.PaidMinor))
	} else {
		row(h["total"], Money(iv.TotalMinor))
	}
	b.WriteString(`</tfoot></table>`)
	if iv.Notes != nil && *iv.Notes != "" {
		fmt.Fprintf(&b, `<p class="muted" style="margin-top:24px;white-space:pre-wrap">%s</p>`, esc(*iv.Notes))
	}
	b.WriteString(`</div></body></html>`)
	return b.String(), nil
}

func textAlign(dir string) string {
	if dir == "rtl" {
		return "right"
	}
	return "left"
}
func endAlign(dir string) string {
	if dir == "rtl" {
		return "left"
	}
	return "right"
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return r.Replace(s)
}
