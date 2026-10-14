package work

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Billing sources besides time: AI consumption and project subscriptions. Both land on the
client's next drafted invoice (DraftFromTime, invoices.go) next to the time lines.

AI usage (ai_usage) — per project, day, provider, model and source: tokens (input, output,
cache read/write), requests and what it cost us. Pushed daily over MCP (record_ai_usage) or
REST by agents and scripts; a push for the same key REPLACES that day's numbers, so a
re-run is harmless. Once invoiced a row is locked. It is billed at cost × (1 + the
project's ai_markup_bp / 10000). Recording is member+ (anyone working on the project pushes
their agent's usage); reading costs and setting the markup is manager+ (finance).

Subscriptions (project_subscriptions) — infrastructure, AI, marketing tools, domains,
software, support … per project, with our cost and the price we bill, and an interval
(month, quarter, year, one_time). Drafting an invoice bills every due period up to the
invoice's end date as one subscription_charges row per period (unique, so a period is billed
once); voiding the invoice deletes those charges and the periods become due again. Manager+.
*/

// ---- AI usage ---------------------------------------------------------------------------

// AIUsageInput is one day of one model's usage on a project.
type AIUsageInput struct {
	Day              string `json:"day" doc:"YYYY-MM-DD"`
	Provider         string `json:"provider,omitempty" doc:"anthropic (default), openai, google, …"`
	Model            string `json:"model" doc:"e.g. claude-opus-5"`
	Source           string `json:"source,omitempty" doc:"Where it came from: api (default), claude-code, an agent name… One row per day+model+source"`
	InputTokens      int64  `json:"input_tokens,omitempty" minimum:"0"`
	OutputTokens     int64  `json:"output_tokens,omitempty" minimum:"0"`
	CacheReadTokens  int64  `json:"cache_read_tokens,omitempty" minimum:"0"`
	CacheWriteTokens int64  `json:"cache_write_tokens,omitempty" minimum:"0"`
	Requests         int64  `json:"requests,omitempty" minimum:"0"`
	Cost             string `json:"cost" doc:"What it cost us, a decimal in currency units (\"12.34\")"`
	Currency         string `json:"currency,omitempty" doc:"Default USD"`
	Billable         *bool  `json:"billable,omitempty" doc:"Default true"`
	Note             string `json:"note,omitempty" maxLength:"500"`
}

// AIUsage is a stored row.
type AIUsage struct {
	ID               string  `json:"id"`
	ProjectID        string  `json:"project_id"`
	Day              string  `json:"day"`
	Provider         string  `json:"provider"`
	Model            string  `json:"model"`
	Source           string  `json:"source"`
	InputTokens      int64   `json:"input_tokens"`
	OutputTokens     int64   `json:"output_tokens"`
	CacheReadTokens  int64   `json:"cache_read_tokens"`
	CacheWriteTokens int64   `json:"cache_write_tokens"`
	Requests         int64   `json:"requests"`
	CostMinor        int64   `json:"cost_minor"`
	Currency         string  `json:"currency"`
	Billable         bool    `json:"billable"`
	InvoiceID        *string `json:"invoice_id"`
}

// parseMoney turns "12.34" into minor units (2 decimals, half up beyond).
func parseMoney(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 0 {
		return 0, invalid("%q is not an amount (use a decimal like 12.34)", s)
	}
	return int64(f*100 + 0.5), nil
}

// RecordAIUsage upserts usage rows for a project. Returns what was stored.
func (sv *Service) RecordAIUsage(ctx context.Context, projectRef string, rows []AIUsageInput) ([]AIUsage, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.AIUsageRecord); err != nil {
		return nil, err
	}
	if err := feature(ctx, s, limits.FeatureAIUsage); err != nil {
		return nil, err
	}
	p, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 || len(rows) > 500 {
		return nil, invalid("send between 1 and 500 usage rows")
	}
	out := []AIUsage{}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		for i, in := range rows {
			day, err := time.Parse("2006-01-02", strings.TrimSpace(in.Day))
			if err != nil {
				return invalid("row %d: day must be YYYY-MM-DD", i+1)
			}
			model := strings.TrimSpace(in.Model)
			if model == "" {
				return invalid("row %d: model is required", i+1)
			}
			cost, err := parseMoney(in.Cost)
			if err != nil {
				return err
			}
			provider := strings.ToLower(strings.TrimSpace(in.Provider))
			if provider == "" {
				provider = "anthropic"
			}
			source := strings.TrimSpace(in.Source)
			if source == "" {
				source = "api"
			}
			currency := strings.ToUpper(strings.TrimSpace(in.Currency))
			if currency == "" {
				currency = "USD"
			}
			billable := in.Billable == nil || *in.Billable
			var u AIUsage
			var dayOut time.Time
			err = tx.QueryRowContext(ctx, `INSERT INTO ai_usage (workspace_id, project_id, day, provider, model, source,
					input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, requests, cost_minor, currency, billable, user_id, note)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULLIF($16, ''))
				ON CONFLICT (workspace_id, project_id, day, provider, model, source) DO UPDATE SET
					input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
					cache_read_tokens = EXCLUDED.cache_read_tokens, cache_write_tokens = EXCLUDED.cache_write_tokens,
					requests = EXCLUDED.requests, cost_minor = EXCLUDED.cost_minor, currency = EXCLUDED.currency,
					billable = EXCLUDED.billable, user_id = EXCLUDED.user_id, note = EXCLUDED.note, updated_at = now()
					WHERE ai_usage.invoice_id IS NULL
				RETURNING id, project_id, day, provider, model, source, input_tokens, output_tokens, cache_read_tokens,
					cache_write_tokens, requests, cost_minor, currency, billable, invoice_id`,
				s.WorkspaceID, p.ID, day, provider, truncate(model, 100), truncate(source, 100),
				in.InputTokens, in.OutputTokens, in.CacheReadTokens, in.CacheWriteTokens, in.Requests, cost, currency, billable,
				s.UserID, strings.TrimSpace(in.Note)).Scan(&u.ID, &u.ProjectID, &dayOut, &u.Provider, &u.Model, &u.Source,
				&u.InputTokens, &u.OutputTokens, &u.CacheReadTokens, &u.CacheWriteTokens, &u.Requests, &u.CostMinor, &u.Currency,
				&u.Billable, &u.InvoiceID)
			if errors.Is(err, sql.ErrNoRows) {
				return conflict(fmt.Sprintf("row %d: %s %s on %s is already invoiced and can't change", i+1, provider, model, in.Day))
			}
			if err != nil {
				return err
			}
			u.Day = dayOut.Format("2006-01-02")
			out = append(out, u)
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "ai_usage.recorded", SubjectType: "project", SubjectID: p.ID,
			Changes: map[string]any{"rows": len(rows)}})
	})
	return out, err
}

// IssueUsage is what one agent session spent on one issue.
type IssueUsage struct {
	Total AIUsage // the project's ai_usage row for the day after adding this session
	// The issue's running totals.
	InputTokens, OutputTokens, CacheTokens, CostMinor int64
	Currency                                          string
}

// RecordIssueUsage adds one session's tokens and cost to an issue (reportID in projectRef)
// and to its project's usage for the day (source defaults to "issues"). Unlike
// RecordAIUsage it ADDS: every session on the issue pushes only what it spent itself.
func (sv *Service) RecordIssueUsage(ctx context.Context, projectRef, reportID string, in AIUsageInput) (*IssueUsage, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.AIUsageRecord); err != nil {
		return nil, err
	}
	if err := feature(ctx, s, limits.FeatureAIUsage); err != nil {
		return nil, err
	}
	p, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	day := time.Now().UTC()
	if v := strings.TrimSpace(in.Day); v != "" {
		if day, err = time.Parse("2006-01-02", v); err != nil {
			return nil, invalid("day must be YYYY-MM-DD")
		}
	}
	model := strings.TrimSpace(in.Model)
	if model == "" {
		return nil, invalid("model is required")
	}
	if in.InputTokens < 0 || in.OutputTokens < 0 || in.CacheReadTokens < 0 || in.CacheWriteTokens < 0 || in.Requests < 0 {
		return nil, invalid("token counts can't be negative")
	}
	cost, err := parseMoney(in.Cost)
	if err != nil {
		return nil, err
	}
	provider := strings.ToLower(strings.TrimSpace(in.Provider))
	if provider == "" {
		provider = "anthropic"
	}
	source := strings.TrimSpace(in.Source)
	if source == "" {
		source = "issues"
	}
	currency := strings.ToUpper(strings.TrimSpace(in.Currency))
	if currency == "" {
		currency = "USD"
	}
	requests := in.Requests
	if requests == 0 {
		requests = 1
	}
	out := &IssueUsage{}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `UPDATE reports SET ai_input_tokens = ai_input_tokens + $3,
				ai_output_tokens = ai_output_tokens + $4, ai_cache_tokens = ai_cache_tokens + $5,
				ai_cost_minor = ai_cost_minor + $6, ai_currency = $7, updated_at = now()
			WHERE workspace_id = $1 AND id = $2 AND project_id = $8
			RETURNING ai_input_tokens, ai_output_tokens, ai_cache_tokens, ai_cost_minor, ai_currency`,
			s.WorkspaceID, reportID, in.InputTokens, in.OutputTokens, in.CacheReadTokens+in.CacheWriteTokens, cost, currency, p.ID,
		).Scan(&out.InputTokens, &out.OutputTokens, &out.CacheTokens, &out.CostMinor, &out.Currency)
		if errors.Is(err, sql.ErrNoRows) {
			return notFound("issue")
		}
		if err != nil {
			return err
		}
		u := &out.Total
		var dayOut time.Time
		err = tx.QueryRowContext(ctx, `INSERT INTO ai_usage (workspace_id, project_id, day, provider, model, source,
				input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, requests, cost_minor, currency, billable, user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			ON CONFLICT (workspace_id, project_id, day, provider, model, source) DO UPDATE SET
				input_tokens = ai_usage.input_tokens + EXCLUDED.input_tokens,
				output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens,
				cache_read_tokens = ai_usage.cache_read_tokens + EXCLUDED.cache_read_tokens,
				cache_write_tokens = ai_usage.cache_write_tokens + EXCLUDED.cache_write_tokens,
				requests = ai_usage.requests + EXCLUDED.requests, cost_minor = ai_usage.cost_minor + EXCLUDED.cost_minor,
				updated_at = now()
				WHERE ai_usage.invoice_id IS NULL
			RETURNING id, project_id, day, provider, model, source, input_tokens, output_tokens, cache_read_tokens,
				cache_write_tokens, requests, cost_minor, currency, billable, invoice_id`,
			s.WorkspaceID, p.ID, day, provider, truncate(model, 100), truncate(source, 100),
			in.InputTokens, in.OutputTokens, in.CacheReadTokens, in.CacheWriteTokens, requests, cost, currency,
			in.Billable == nil || *in.Billable, s.UserID).Scan(&u.ID, &u.ProjectID, &dayOut, &u.Provider, &u.Model, &u.Source,
			&u.InputTokens, &u.OutputTokens, &u.CacheReadTokens, &u.CacheWriteTokens, &u.Requests, &u.CostMinor, &u.Currency,
			&u.Billable, &u.InvoiceID)
		if errors.Is(err, sql.ErrNoRows) {
			return conflict(fmt.Sprintf("%s %s on %s is already invoiced; record it with another day", provider, model, day.Format("2006-01-02")))
		}
		if err != nil {
			return err
		}
		u.Day = dayOut.Format("2006-01-02")
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "ai_usage.recorded", SubjectType: "report", SubjectID: reportID,
			Changes: map[string]any{"model": model, "input_tokens": in.InputTokens, "output_tokens": in.OutputTokens, "cost_minor": cost}})
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// AIUsageFilter narrows AIUsageSummary.
type AIUsageFilter struct {
	ProjectRef string
	From, To   string // YYYY-MM-DD
	GroupBy    string // day (default), model, project, source
}

// AIUsageRow is one group of the summary. BilledMinor = cost × (1 + markup).
type AIUsageRow struct {
	Key          string `json:"key" doc:"The day, model, project name or source"`
	ProjectID    string `json:"project_id,omitempty"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	CacheTokens  int64  `json:"cache_tokens"`
	Requests     int64  `json:"requests"`
	CostMinor    int64  `json:"cost_minor"`
	BilledMinor  int64  `json:"billed_minor"`
	UnbilledCost int64  `json:"unbilled_cost_minor" doc:"Billable cost not yet on an invoice"`
	Currency     string `json:"currency"`
}

// customerBilling reports whether the caller reads billing as the project's customer (MH-1190):
// billed prices on one project they can see, never our cost, the markup or notes.
func customerBilling(s *tenant.Scope, projectRef string) (bool, error) {
	if authz.Can(s.Role, authz.AIUsageRead) {
		return false, nil
	}
	// Members keep no billing view: what a customer pays is finance, like rates.
	if s.Role != string(authz.Client) {
		return false, require(s, authz.AIUsageRead)
	}
	if err := require(s, authz.BillingRead); err != nil {
		return false, err
	}
	if strings.TrimSpace(projectRef) == "" {
		return false, invalid("give the project")
	}
	return true, nil
}

// AIUsageSummary totals usage by day, model, project or source (manager+). A customer gets
// their project's usage at the billed price: cost and unbilled cost are cost × (1 + markup).
func (sv *Service) AIUsageSummary(ctx context.Context, f AIUsageFilter) ([]AIUsageRow, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	customer, err := customerBilling(s, f.ProjectRef)
	if err != nil {
		return nil, err
	}
	if err := feature(ctx, s, limits.FeatureAIUsage); err != nil {
		return nil, err
	}
	args := []any{s.WorkspaceID}
	where := "u.workspace_id = $1"
	if strings.TrimSpace(f.ProjectRef) != "" {
		p, err := sv.FindProject(ctx, f.ProjectRef)
		if err != nil {
			return nil, err
		}
		args = append(args, p.ID)
		where += " AND u.project_id = $" + itoa(len(args))
	}
	for _, d := range []struct{ v, op string }{{f.From, ">="}, {f.To, "<="}} {
		if strings.TrimSpace(d.v) == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", d.v); err != nil {
			return nil, invalid("dates are YYYY-MM-DD")
		}
		args = append(args, d.v)
		where += " AND u.day " + d.op + " $" + itoa(len(args)) + "::date"
	}
	key := map[string]string{"day": "to_char(u.day, 'YYYY-MM-DD')", "model": "u.provider || '/' || u.model", "project": "p.name", "source": "u.source"}
	gb := strings.TrimSpace(f.GroupBy)
	if gb == "" {
		gb = "day"
	}
	expr, ok := key[gb]
	if !ok {
		return nil, invalid("group_by is day, model, project or source")
	}
	pid := "''"
	if gb == "project" {
		pid = "p.id"
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+expr+`, `+pid+`, sum(u.input_tokens), sum(u.output_tokens),
			sum(u.cache_read_tokens + u.cache_write_tokens), sum(u.requests), sum(u.cost_minor),
			sum(round(u.cost_minor * (10000 + p.ai_markup_bp) / 10000.0))::bigint,
			sum(CASE WHEN u.billable AND u.invoice_id IS NULL THEN u.cost_minor ELSE 0 END),
			sum(CASE WHEN u.billable AND u.invoice_id IS NULL THEN round(u.cost_minor * (10000 + p.ai_markup_bp) / 10000.0) ELSE 0 END)::bigint,
			u.currency
		FROM ai_usage u JOIN projects p ON p.workspace_id = u.workspace_id AND p.id = u.project_id
		WHERE `+where+` GROUP BY 1, 2, u.currency ORDER BY 1`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AIUsageRow{}
	for rows.Next() {
		var r AIUsageRow
		var unbilledBilled int64
		if err := rows.Scan(&r.Key, &r.ProjectID, &r.InputTokens, &r.OutputTokens, &r.CacheTokens, &r.Requests, &r.CostMinor,
			&r.BilledMinor, &r.UnbilledCost, &unbilledBilled, &r.Currency); err != nil {
			return nil, err
		}
		if customer {
			r.CostMinor, r.UnbilledCost = r.BilledMinor, unbilledBilled
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AIMarkup reads a project's markup on AI cost, in basis points (manager+).
func (sv *Service) AIMarkup(ctx context.Context, projectRef string) (int, error) {
	s, err := caller(ctx)
	if err != nil {
		return 0, err
	}
	if err := require(s, authz.AIUsageRead); err != nil {
		return 0, err
	}
	if err := feature(ctx, s, limits.FeatureAIUsage); err != nil {
		return 0, err
	}
	p, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return 0, err
	}
	var bp int
	err = sv.DB.QueryRowContext(ctx, `SELECT ai_markup_bp FROM projects WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, p.ID).Scan(&bp)
	return bp, err
}

// SetAIMarkup sets a project's markup on AI cost (percent, e.g. "20" = +20%). Manager+.
func (sv *Service) SetAIMarkup(ctx context.Context, projectRef, percent string) (int, error) {
	s, err := caller(ctx)
	if err != nil {
		return 0, err
	}
	if err := require(s, authz.AIUsageRead); err != nil {
		return 0, err
	}
	if err := feature(ctx, s, limits.FeatureAIUsage); err != nil {
		return 0, err
	}
	p, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return 0, err
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(percent), 64)
	if err != nil || f < 0 || f > 1000 {
		return 0, invalid("markup is a percent between 0 and 1000")
	}
	bp := int(f*100 + 0.5)
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE projects SET ai_markup_bp = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
			s.WorkspaceID, p.ID, bp); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "project.ai_markup_set", SubjectType: "project", SubjectID: p.ID,
			Changes: map[string]any{"basis_points": bp}})
	})
	return bp, err
}

// ---- subscriptions ----------------------------------------------------------------------

// Subscription is a project subscription.
type Subscription struct {
	ID          string  `json:"id"`
	ProjectID   string  `json:"project_id"`
	ProjectName string  `json:"project_name"`
	Name        string  `json:"name"`
	Category    string  `json:"category" enum:"infrastructure,ai,marketing,software,domain,support,other" doc:"infrastructure, ai, marketing, software, domain, support, other"`
	Vendor      *string `json:"vendor"`
	PriceMinor  int64   `json:"price_minor" doc:"What we bill per period"`
	CostMinor   int64   `json:"cost_minor" doc:"What it costs us per period"`
	Currency    string  `json:"currency"`
	Interval    string  `json:"interval" enum:"month,quarter,year,one_time" doc:"month, quarter, year, one_time"`
	StartsOn    string  `json:"starts_on"`
	EndsOn      *string `json:"ends_on"`
	Billable    bool    `json:"billable"`
	Active      bool    `json:"active"`
	Notes       *string `json:"notes"`
	BilledUntil *string `json:"billed_until" doc:"End of the last billed period"`
	NextPeriod  *string `json:"next_period" doc:"Start of the next unbilled period, if any"`
}

// SubscriptionInput creates or patches a subscription. Money is a decimal string.
type SubscriptionInput struct {
	Name     *string `json:"name,omitempty" maxLength:"200"`
	Category *string `json:"category,omitempty" enum:"infrastructure,ai,marketing,software,domain,support,other"`
	Vendor   *string `json:"vendor,omitempty" maxLength:"200"`
	Price    *string `json:"price,omitempty" doc:"Billed per period, e.g. \"49.00\""`
	Cost     *string `json:"cost,omitempty" doc:"Our cost per period"`
	Currency *string `json:"currency,omitempty"`
	Interval *string `json:"interval,omitempty" enum:"month,quarter,year,one_time"`
	StartsOn *string `json:"starts_on,omitempty" doc:"YYYY-MM-DD"`
	EndsOn   *string `json:"ends_on,omitempty" doc:"YYYY-MM-DD, \"\" clears"`
	Billable *bool   `json:"billable,omitempty"`
	Active   *bool   `json:"active,omitempty"`
	Notes    *string `json:"notes,omitempty" maxLength:"2000"`
}

const subCols = `s.id, s.project_id, p.name, s.name, s.category, s.vendor, s.price_minor, s.cost_minor, s.currency, s.interval,
	to_char(s.starts_on, 'YYYY-MM-DD'), to_char(s.ends_on, 'YYYY-MM-DD'), s.billable, s.active, s.notes,
	(SELECT to_char(max(c.period_end), 'YYYY-MM-DD') FROM subscription_charges c WHERE c.workspace_id = s.workspace_id AND c.subscription_id = s.id)`

func scanSub(r scanner) (*Subscription, error) {
	x := &Subscription{}
	err := r.Scan(&x.ID, &x.ProjectID, &x.ProjectName, &x.Name, &x.Category, &x.Vendor, &x.PriceMinor, &x.CostMinor, &x.Currency,
		&x.Interval, &x.StartsOn, &x.EndsOn, &x.Billable, &x.Active, &x.Notes, &x.BilledUntil)
	if err == nil {
		if ps := duePeriods(x, farFuture, 1); len(ps) > 0 {
			d := ps[0].start.Format("2006-01-02")
			x.NextPeriod = &d
		}
	}
	return x, err
}

var farFuture = time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)

type period struct{ start, end time.Time }

// duePeriods lists the unbilled periods of x that start on or before until (at most max).
func duePeriods(x *Subscription, until time.Time, max int) []period {
	if !x.Active || !x.Billable {
		return nil
	}
	start, err := time.Parse("2006-01-02", x.StartsOn)
	if err != nil {
		return nil
	}
	var ends *time.Time
	if x.EndsOn != nil {
		if e, err := time.Parse("2006-01-02", *x.EndsOn); err == nil {
			ends = &e
		}
	}
	if x.BilledUntil != nil {
		if b, err := time.Parse("2006-01-02", *x.BilledUntil); err == nil {
			if x.Interval == "one_time" {
				return nil
			}
			start = b.AddDate(0, 0, 1)
		}
	}
	months := map[string]int{"month": 1, "quarter": 3, "year": 12}[x.Interval]
	out := []period{}
	for len(out) < max && !start.After(until) && (ends == nil || !start.After(*ends)) {
		if x.Interval == "one_time" {
			return append(out, period{start, start})
		}
		next := start.AddDate(0, months, 0)
		out = append(out, period{start, next.AddDate(0, 0, -1)})
		start = next
	}
	return out
}

// ListSubscriptions lists subscriptions, for one project or all (manager+). A customer gets
// their project's billable subscriptions at the price they pay: no cost, no notes.
func (sv *Service) ListSubscriptions(ctx context.Context, projectRef string) ([]Subscription, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	customer := false
	if !authz.Can(s.Role, authz.SubscriptionsManage) {
		if customer, err = customerBilling(s, projectRef); err != nil {
			return nil, err
		}
	}
	args := []any{s.WorkspaceID}
	where := "s.workspace_id = $1"
	if customer {
		where += " AND s.billable"
	}
	if strings.TrimSpace(projectRef) != "" {
		p, err := sv.FindProject(ctx, projectRef)
		if err != nil {
			return nil, err
		}
		args = append(args, p.ID)
		where += " AND s.project_id = $2"
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+subCols+` FROM project_subscriptions s
		JOIN projects p ON p.workspace_id = s.workspace_id AND p.id = s.project_id
		WHERE `+where+` ORDER BY p.name, s.active DESC, s.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Subscription{}
	for rows.Next() {
		x, err := scanSub(rows)
		if err != nil {
			return nil, err
		}
		if customer {
			x.CostMinor, x.Notes = 0, nil
		}
		out = append(out, *x)
	}
	return out, rows.Err()
}

func (sv *Service) getSub(ctx context.Context, ws, id string) (*Subscription, error) {
	x, err := scanSub(sv.DB.QueryRowContext(ctx, `SELECT `+subCols+` FROM project_subscriptions s
		JOIN projects p ON p.workspace_id = s.workspace_id AND p.id = s.project_id
		WHERE s.workspace_id = $1 AND s.id = $2`, ws, strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("subscription")
	}
	return x, err
}

func subValues(in SubscriptionInput, p *patch) error {
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if n == "" {
			return invalid("a subscription needs a name")
		}
		p.set("name", truncate(n, 200))
	}
	if in.Category != nil {
		if err := oneOf("category", *in.Category, "infrastructure", "ai", "marketing", "software", "domain", "support", "other"); err != nil {
			return err
		}
		p.set("category", *in.Category)
	}
	if in.Vendor != nil {
		p.set("vendor", nullIfEmpty(strings.TrimSpace(*in.Vendor)))
	}
	for col, v := range map[string]*string{"price_minor": in.Price, "cost_minor": in.Cost} {
		if v != nil {
			m, err := parseMoney(*v)
			if err != nil {
				return err
			}
			p.set(col, m)
		}
	}
	if in.Currency != nil {
		c := strings.ToUpper(strings.TrimSpace(*in.Currency))
		if len(c) != 3 {
			return invalid("currency is a 3-letter code")
		}
		p.set("currency", c)
	}
	if in.Interval != nil {
		if err := oneOf("interval", *in.Interval, "month", "quarter", "year", "one_time"); err != nil {
			return err
		}
		p.set("interval", *in.Interval)
	}
	for col, v := range map[string]*string{"starts_on": in.StartsOn, "ends_on": in.EndsOn} {
		if v == nil {
			continue
		}
		d := strings.TrimSpace(*v)
		if d == "" && col == "ends_on" {
			p.set(col, nil)
			continue
		}
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return invalid("%s is YYYY-MM-DD", col)
		}
		p.set(col, d)
	}
	if in.Billable != nil {
		p.set("billable", *in.Billable)
	}
	if in.Active != nil {
		p.set("active", *in.Active)
	}
	if in.Notes != nil {
		p.set("notes", nullIfEmpty(strings.TrimSpace(*in.Notes)))
	}
	return nil
}

// CreateSubscription adds a subscription to a project (manager+).
func (sv *Service) CreateSubscription(ctx context.Context, projectRef string, in SubscriptionInput) (*Subscription, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.SubscriptionsManage); err != nil {
		return nil, err
	}
	proj, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	if in.Name == nil || strings.TrimSpace(*in.Name) == "" {
		return nil, invalid("a subscription needs a name")
	}
	p := newPatch()
	if err := subValues(in, p); err != nil {
		return nil, err
	}
	p.set("project_id", proj.ID)
	p.set("created_by", s.UserID)
	cols, marks, args := p.insert(s.WorkspaceID)
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO project_subscriptions (`+cols+`) VALUES (`+marks+`) RETURNING id`, args...).Scan(&id); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: proj.ID, Action: "subscription.created", SubjectType: "subscription", SubjectID: id,
			Changes: map[string]any{"name": strings.TrimSpace(*in.Name)}})
	})
	if err != nil {
		return nil, err
	}
	return sv.getSub(ctx, s.WorkspaceID, id)
}

// UpdateSubscription patches a subscription (manager+).
func (sv *Service) UpdateSubscription(ctx context.Context, id string, in SubscriptionInput) (*Subscription, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.SubscriptionsManage); err != nil {
		return nil, err
	}
	x, err := sv.getSub(ctx, s.WorkspaceID, id)
	if err != nil {
		return nil, err
	}
	p := newPatch()
	if err := subValues(in, p); err != nil {
		return nil, err
	}
	if p.empty() {
		return x, nil
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := p.update(ctx, tx, "project_subscriptions", s.WorkspaceID, x.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: x.ProjectID, Action: "subscription.updated", SubjectType: "subscription", SubjectID: x.ID,
			Changes: p.changes})
	})
	if err != nil {
		return nil, err
	}
	return sv.getSub(ctx, s.WorkspaceID, x.ID)
}

// DeleteSubscription removes a never-billed subscription; a billed one must be deactivated
// instead, so invoice history keeps its charges (manager+).
func (sv *Service) DeleteSubscription(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.SubscriptionsManage); err != nil {
		return err
	}
	x, err := sv.getSub(ctx, s.WorkspaceID, id)
	if err != nil {
		return err
	}
	if x.BilledUntil != nil {
		return conflict("this subscription has been billed — deactivate it instead")
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM project_subscriptions WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, x.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: x.ProjectID, Action: "subscription.deleted", SubjectType: "subscription", SubjectID: x.ID,
			Changes: map[string]any{"name": x.Name}})
	})
}

// ---- invoice integration ---------------------------------------------------------------

// extraLine is an invoice line from AI usage or a subscription period.
type extraLine struct {
	desc    string
	amount  int64
	aiIDs   []string
	charges []subCharge
}

type subCharge struct {
	subID, projectID string
	p                period
	amount           int64
}

// gatherExtras collects a client's unbilled AI usage (up to `until`) and due subscription
// periods (starting on or before `until`) in the invoice currency, for the given projects
// (empty = all the client's projects).
func (sv *Service) gatherExtras(ctx context.Context, q querier, ws, clientID, currency string, projIDs []string, from *time.Time,
	until time.Time, withAI, withSubs bool) ([]extraLine, error) {
	out := []extraLine{}
	if withAI {
		args := []any{ws, clientID, currency, until.Format("2006-01-02")}
		where := `u.workspace_id = $1 AND p.client_id = $2 AND u.currency = $3 AND u.day <= $4::date
			AND u.billable AND u.invoice_id IS NULL AND u.locked_at IS NULL`
		if from != nil {
			args = append(args, from.Format("2006-01-02"))
			where += " AND u.day >= $" + itoa(len(args)) + "::date"
		}
		if len(projIDs) > 0 {
			args = append(args, projIDs)
			where += " AND u.project_id = ANY($" + itoa(len(args)) + ")"
		}
		rows, err := q.QueryContext(ctx, `SELECT p.name, u.provider || '/' || u.model, array_agg(u.id),
				sum(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens),
				sum(round(u.cost_minor * (10000 + p.ai_markup_bp) / 10000.0))::bigint,
				to_char(min(u.day), 'YYYY-MM-DD'), to_char(max(u.day), 'YYYY-MM-DD')
			FROM ai_usage u JOIN projects p ON p.workspace_id = u.workspace_id AND p.id = u.project_id
			WHERE `+where+` GROUP BY p.name, 2 ORDER BY p.name, 2`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var proj, model, first, last string
			var ids pqStringArray
			var tokens, amount int64
			if err := rows.Scan(&proj, &model, &ids, &tokens, &amount, &first, &last); err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, extraLine{
				desc:   fmt.Sprintf("AI usage · %s · %s · %s tokens (%s – %s)", proj, model, humanTokens(tokens), first, last),
				amount: amount, aiIDs: ids,
			})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	if withSubs {
		args := []any{ws, clientID, currency}
		where := `s.workspace_id = $1 AND p.client_id = $2 AND s.currency = $3 AND s.active AND s.billable`
		if len(projIDs) > 0 {
			args = append(args, projIDs)
			where += " AND s.project_id = ANY($4)"
		}
		rows, err := q.QueryContext(ctx, `SELECT `+subCols+` FROM project_subscriptions s
			JOIN projects p ON p.workspace_id = s.workspace_id AND p.id = s.project_id
			WHERE `+where+` ORDER BY p.name, s.name`, args...)
		if err != nil {
			return nil, err
		}
		subs := []*Subscription{}
		for rows.Next() {
			x, err := scanSub(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			subs = append(subs, x)
		}
		rows.Close()
		for _, x := range subs {
			for _, per := range duePeriods(x, until, 36) {
				label := per.start.Format("2006-01-02")
				if x.Interval != "one_time" {
					label += " – " + per.end.Format("2006-01-02")
				}
				out = append(out, extraLine{
					desc:    fmt.Sprintf("%s · %s (%s) · %s", x.ProjectName, x.Name, x.Category, label),
					amount:  x.PriceMinor,
					charges: []subCharge{{subID: x.ID, projectID: x.ProjectID, p: per, amount: x.PriceMinor}},
				})
			}
		}
	}
	return out, nil
}

// lockExtras writes the lines' charges and locks the AI usage onto the invoice.
func lockExtras(ctx context.Context, tx *sql.Tx, ws, invID, currency string, lines []extraLine) error {
	for _, l := range lines {
		if len(l.aiIDs) > 0 {
			res, err := tx.ExecContext(ctx, `UPDATE ai_usage SET invoice_id = $2, locked_at = now(), updated_at = now()
				WHERE workspace_id = $1 AND id = ANY($3) AND invoice_id IS NULL`, ws, invID, pqStringArray(l.aiIDs))
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); int(n) != len(l.aiIDs) {
				return conflict("some AI usage was billed while the invoice was being drafted — try again")
			}
		}
		for _, c := range l.charges {
			if _, err := tx.ExecContext(ctx, `INSERT INTO subscription_charges
				(workspace_id, subscription_id, project_id, period_start, period_end, amount_minor, currency, invoice_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, ws, c.subID, c.projectID, c.p.start, c.p.end, c.amount, currency, invID); err != nil {
				return conflict("a subscription period was billed while the invoice was being drafted — try again")
			}
		}
	}
	return nil
}

// releaseExtras undoes lockExtras when an invoice is voided.
func releaseExtras(ctx context.Context, tx *sql.Tx, ws, invID string) error {
	if _, err := tx.ExecContext(ctx, `UPDATE ai_usage SET invoice_id = NULL, locked_at = NULL, updated_at = now()
		WHERE workspace_id = $1 AND invoice_id = $2`, ws, invID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM subscription_charges WHERE workspace_id = $1 AND invoice_id = $2`, ws, invID)
	return err
}

func humanTokens(n int64) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.2fM", float64(n)/1e6)
	case n >= 1_000:
		return fmt.Sprintf("%.1fK", float64(n)/1e3)
	default:
		return strconv.FormatInt(n, 10)
	}
}
