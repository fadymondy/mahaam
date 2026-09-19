package polar

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/fadymondy/mahaam/internal/limits"
)

// UsageEvent is the event name every metered usage event carries; meters filter on it plus
// metadata app=mahaam and key=<limit key>, and sum the `units` property.
const UsageEvent = "mahaam.usage"

type price struct {
	ID          string          `json:"id,omitempty"`
	AmountType  string          `json:"amount_type"`
	PriceAmount *int64          `json:"price_amount,omitempty"`
	Currency    string          `json:"price_currency,omitempty"`
	MeterID     string          `json:"meter_id,omitempty"`
	UnitAmount  json.RawMessage `json:"unit_amount,omitempty"`
	IsArchived  bool            `json:"is_archived,omitempty"`
}

type product struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Metadata map[string]any    `json:"metadata"`
	Prices   []price           `json:"prices"`
	Extra    map[string]string `json:"-"`
}

type meter struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Metadata map[string]any `json:"metadata"`
}

type list[T any] struct {
	Items []T `json:"items"`
}

// SyncReport says what a sync did (or, dry run, would do).
type SyncReport struct {
	DryRun  bool     `json:"dry_run"`
	Actions []string `json:"actions"`
}

func (r *SyncReport) add(format string, args ...any) {
	r.Actions = append(r.Actions, fmt.Sprintf(format, args...))
}

func ours(md map[string]any) bool { v, _ := md["app"].(string); return v == App }

// MeteredKeys are the limit keys some active plan bills as overage (limit set, overage policy,
// a unit price), in catalog order.
func MeteredKeys(plans []limits.Plan) []string {
	want := map[string]bool{}
	for _, p := range plans {
		if !p.Active {
			continue
		}
		for k, r := range p.Limits {
			if billable(r) {
				want[k] = true
			}
		}
	}
	out := []string{}
	for _, d := range limits.Catalog {
		if want[d.Key] {
			out = append(out, d.Key)
		}
	}
	return out
}

func billable(r limits.Rule) bool {
	return r.Limit != nil && r.Policy == limits.Overage && r.UnitPriceMinor > 0
}

// Paid reports whether a plan is sold through Polar: active, and a base fee or metered prices.
func Paid(p limits.Plan) bool {
	if !p.Active {
		return false
	}
	if p.BaseFeeMinor > 0 {
		return true
	}
	for _, r := range p.Limits {
		if billable(r) {
			return true
		}
	}
	return false
}

// Sync maps Mahaam's plans onto Polar: one meter per metered limit key, one product per paid plan
// (monthly base price + metered prices), and stores the ids on plans / polar_meters. Idempotent.
// A dry run reads Polar but calls no write endpoint and changes nothing locally.
func Sync(ctx context.Context, db *sql.DB, c *Client, dryRun bool) (*SyncReport, error) {
	rep := &SyncReport{DryRun: dryRun, Actions: []string{}}
	plans, err := limits.ListPlans(ctx, db)
	if err != nil {
		return nil, err
	}

	// ---- meters --------------------------------------------------------------------------------
	stored := map[string]string{}
	rows, err := db.QueryContext(ctx, `SELECT limit_key, meter_id FROM polar_meters`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k, id string
		if err := rows.Scan(&k, &id); err != nil {
			rows.Close()
			return nil, err
		}
		stored[k] = id
	}
	rows.Close()
	var remote list[meter]
	if err := c.Do(ctx, http.MethodGet, "/v1/meters/?limit=100", nil, &remote); err != nil {
		return nil, err
	}
	byKey := map[string]string{}
	for _, m := range remote.Items {
		if ours(m.Metadata) {
			if k, _ := m.Metadata["key"].(string); k != "" {
				byKey[k] = m.ID
			}
		}
	}
	meters := map[string]string{}
	for _, key := range MeteredKeys(plans) {
		id := stored[key]
		if id == "" {
			id = byKey[key]
		}
		if id == "" {
			rep.add("create meter %q (event %s, key %s, sum of units)", meterName(key), UsageEvent, key)
			if dryRun {
				meters[key] = "(new meter " + key + ")"
				continue
			}
			var m meter
			if err := c.Do(ctx, http.MethodPost, "/v1/meters/", meterBody(key), &m); err != nil {
				return nil, err
			}
			id = m.ID
		} else {
			rep.add("meter %s exists (%s)", key, id)
		}
		meters[key] = id
		if !dryRun && stored[key] != id {
			if _, err := db.ExecContext(ctx, `INSERT INTO polar_meters (limit_key, meter_id) VALUES ($1, $2)
				ON CONFLICT (limit_key) DO UPDATE SET meter_id = $2, updated_at = now()`, key, id); err != nil {
				return nil, err
			}
		}
	}

	// ---- products ------------------------------------------------------------------------------
	var remoteProducts list[product]
	if err := c.Do(ctx, http.MethodGet, "/v1/products/?limit=100&is_archived=false", nil, &remoteProducts); err != nil {
		return nil, err
	}
	byPlan := map[string]string{}
	for _, p := range remoteProducts.Items {
		if ours(p.Metadata) {
			if k, _ := p.Metadata["plan"].(string); k != "" {
				byPlan[k] = p.ID
			}
		}
	}
	for _, p := range plans {
		if !Paid(p) {
			continue
		}
		var productID sql.NullString
		if err := db.QueryRowContext(ctx, `SELECT polar_product_id FROM plans WHERE key = $1`, p.Key).Scan(&productID); err != nil {
			return nil, err
		}
		id := productID.String
		if id == "" {
			id = byPlan[p.Key]
		}
		body := productBody(p, meters)
		var out product
		if id == "" {
			rep.add("create product %q: base %d %s/month, metered %s", body["name"], p.BaseFeeMinor, p.Currency, strings.Join(meteredOf(p), ", "))
			if dryRun {
				continue
			}
			body["recurring_interval"] = "month"
			if err := c.Do(ctx, http.MethodPost, "/v1/products/", body, &out); err != nil {
				return nil, err
			}
		} else {
			rep.add("update product %q (%s): base %d %s/month, metered %s", body["name"], id, p.BaseFeeMinor, p.Currency, strings.Join(meteredOf(p), ", "))
			if dryRun {
				continue
			}
			if err := c.Do(ctx, http.MethodPatch, "/v1/products/"+id, body, &out); err != nil {
				return nil, err
			}
		}
		ids := priceIDs(out, meters)
		raw, _ := json.Marshal(ids)
		if _, err := db.ExecContext(ctx, `UPDATE plans SET polar_product_id = $2, polar_price_ids = $3::jsonb, updated_at = now() WHERE key = $1`,
			p.Key, out.ID, string(raw)); err != nil {
			return nil, err
		}
	}
	return rep, nil
}

func meterName(key string) string { return "Mahaam " + key }

func meterBody(key string) map[string]any {
	return map[string]any{
		"name": meterName(key),
		"filter": map[string]any{"conjunction": "and", "clauses": []map[string]any{
			{"property": "name", "operator": "eq", "value": UsageEvent},
			{"property": "app", "operator": "eq", "value": App},
			{"property": "key", "operator": "eq", "value": key},
		}},
		"aggregation": map[string]any{"func": "sum", "property": "units"},
		"metadata":    map[string]any{"app": App, "key": key},
	}
}

func meteredOf(p limits.Plan) []string {
	out := []string{}
	for _, d := range limits.Catalog {
		if r, ok := p.Limits[d.Key]; ok && billable(r) {
			out = append(out, fmt.Sprintf("%s %d/%d", d.Key, r.UnitPriceMinor, r.UnitSize))
		}
	}
	if len(out) == 0 {
		return []string{"none"}
	}
	return out
}

// productBody is the create/update body of a plan's product. Metered prices are per billing
// unit: usage.go reports whole units of unit_size over the limit, so unit_amount is
// unit_price_minor (Polar amounts are in cents).
func productBody(p limits.Plan, meters map[string]string) map[string]any {
	cur := strings.ToLower(p.Currency)
	base := p.BaseFeeMinor
	prices := []map[string]any{{"amount_type": "fixed", "price_amount": base, "price_currency": cur}}
	keys := []string{}
	for k, r := range p.Limits {
		if billable(r) && meters[k] != "" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		prices = append(prices, map[string]any{"amount_type": "metered_unit", "meter_id": meters[k],
			"unit_amount": fmt.Sprintf("%d", p.Limits[k].UnitPriceMinor), "price_currency": cur})
	}
	return map[string]any{
		"name":        "Mahaam " + p.NameEn,
		"description": p.DescriptionEn,
		"prices":      prices,
		"metadata":    map[string]any{"app": App, "plan": p.Key},
	}
}

func priceIDs(p product, meters map[string]string) map[string]string {
	keyOf := map[string]string{}
	for k, id := range meters {
		keyOf[id] = k
	}
	out := map[string]string{}
	for _, pr := range p.Prices {
		if pr.IsArchived {
			continue
		}
		switch pr.AmountType {
		case "fixed":
			out["base"] = pr.ID
		case "metered_unit":
			if k := keyOf[pr.MeterID]; k != "" {
				out[k] = pr.ID
			}
		}
	}
	return out
}
