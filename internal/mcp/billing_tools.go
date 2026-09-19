package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
BillingTools: AI consumption and project subscriptions (internal/work/billing_sources.go).

	record_ai_usage                              ai:record   (member+) — push a project's daily usage
	ai_usage_summary, set_ai_markup              ai:read     (manager+)
	list_subscriptions, add_subscription,
	update_subscription                          subscriptions:manage (manager+)

Drafting an invoice (draft_invoice) bills unbilled AI usage and due subscription periods
next to time.
*/
func BillingTools() []Tool {
	money := func(minor int64, cur string) string { return fmt.Sprintf("%d.%02d %s", minor/100, minor%100, cur) }
	return []Tool{
		{
			Name: "record_ai_usage",
			Description: "Push a project's AI usage: one row per day + model (+ source), with token counts and what it cost. " +
				"A re-push of the same day/model/source replaces it (idempotent), unless it was already invoiced. Push daily.",
			Scope: "ai:record",
			InputSchema: schema([]string{"project", "rows"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"rows": map[string]any{"type": "array", "items": map[string]any{"type": "object", "required": []string{"day", "model", "cost"},
					"properties": map[string]any{
						"day": prop("string", "YYYY-MM-DD"), "provider": prop("string", "anthropic (default), openai, …"),
						"model": prop("string", "e.g. claude-opus-5"), "source": prop("string", "api (default), claude-code, an agent name"),
						"input_tokens": prop("integer", ""), "output_tokens": prop("integer", ""),
						"cache_read_tokens": prop("integer", ""), "cache_write_tokens": prop("integer", ""),
						"requests": prop("integer", ""), "cost": prop("string", "What it cost, e.g. \"12.34\""),
						"currency": prop("string", "Default USD"), "billable": prop("boolean", "Default true"), "note": prop("string", ""),
					}}},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				var in struct {
					Project string              `json:"project"`
					Rows    []work.AIUsageInput `json:"rows"`
				}
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", fmt.Errorf("rows: %w", err)
				}
				rows, err := work.New(a).RecordAIUsage(ctx, in.Project, in.Rows)
				if err != nil {
					return "", toolErr(err)
				}
				var cost int64
				var tokens int64
				for _, r := range rows {
					cost += r.CostMinor
					tokens += r.InputTokens + r.OutputTokens + r.CacheReadTokens + r.CacheWriteTokens
				}
				cur := "USD"
				if len(rows) > 0 {
					cur = rows[0].Currency
				}
				return fmt.Sprintf("Recorded %d row(s): %d tokens, cost %s.", len(rows), tokens, money(cost, cur)), nil
			},
		},
		{
			Name:        "ai_usage_summary",
			Description: "AI tokens, our cost, the billed amount (with markup) and what is still unbilled — by day, model, project or source.",
			Scope:       "ai:read",
			InputSchema: schema(nil, map[string]any{
				"project":  prop("string", "Project id or name; empty = all"),
				"from":     prop("string", "YYYY-MM-DD"),
				"to":       prop("string", "YYYY-MM-DD"),
				"group_by": map[string]any{"type": "string", "enum": []string{"day", "model", "project", "source"}},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				rows, err := work.New(a).AIUsageSummary(ctx, work.AIUsageFilter{ProjectRef: str(args, "project"), From: str(args, "from"), To: str(args, "to"), GroupBy: str(args, "group_by")})
				if err != nil {
					return "", toolErr(err)
				}
				if len(rows) == 0 {
					return "No AI usage recorded for that filter.", nil
				}
				var b strings.Builder
				b.WriteString("| | input | output | cache | requests | cost | billed | unbilled cost |\n|---|---:|---:|---:|---:|---:|---:|---:|\n")
				for _, r := range rows {
					fmt.Fprintf(&b, "| %s | %d | %d | %d | %d | %s | %s | %s |\n", r.Key, r.InputTokens, r.OutputTokens, r.CacheTokens, r.Requests,
						money(r.CostMinor, r.Currency), money(r.BilledMinor, r.Currency), money(r.UnbilledCost, r.Currency))
				}
				return b.String(), nil
			},
		},
		{
			Name:        "set_ai_markup",
			Description: "Set the markup a project's AI cost is invoiced at, in percent (20 = cost + 20%).",
			Scope:       "ai:read",
			InputSchema: schema([]string{"project", "percent"}, map[string]any{
				"project": prop("string", "Project id or exact name"), "percent": prop("string", "e.g. 20"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				bp, err := work.New(a).SetAIMarkup(ctx, str(args, "project"), str(args, "percent"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("AI markup set to %d.%02d%%.", bp/100, bp%100), nil
			},
		},
		{
			Name:        "list_subscriptions",
			Description: "A project's (or every project's) subscriptions: what we bill, what it costs us, the interval and the next unbilled period.",
			Scope:       "subscriptions:manage",
			InputSchema: schema(nil, map[string]any{"project": prop("string", "Project id or name; empty = all")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				list, err := work.New(a).ListSubscriptions(ctx, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No subscriptions.", nil
				}
				var b strings.Builder
				for _, x := range list {
					state := "active"
					if !x.Active {
						state = "inactive"
					}
					next := "-"
					if x.NextPeriod != nil {
						next = *x.NextPeriod
					}
					fmt.Fprintf(&b, "%s · %s [%s, %s, %s] price %s / cost %s per %s · next %s (id %s)\n", x.ProjectName, x.Name, x.Category, state,
						map[bool]string{true: "billable", false: "not billable"}[x.Billable], money(x.PriceMinor, x.Currency), money(x.CostMinor, x.Currency), x.Interval, next, x.ID)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "add_subscription",
			Description: "Add a subscription to a project (infrastructure, ai, marketing, software, domain, support, other). It is billed per interval on drafted invoices.",
			Scope:       "subscriptions:manage",
			InputSchema: schema([]string{"project", "name", "price"}, subscriptionProps(true)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				x, err := work.New(a).CreateSubscription(ctx, str(args, "project"), subscriptionInput(args))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Added %s to %s (id %s).", x.Name, x.ProjectName, x.ID), nil
			},
		},
		{
			Name:        "update_subscription",
			Description: "Change a subscription (price, cost, interval, dates, active, billable…).",
			Scope:       "subscriptions:manage",
			InputSchema: schema([]string{"id"}, subscriptionProps(false)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				x, err := work.New(a).UpdateSubscription(ctx, str(args, "id"), subscriptionInput(args))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Updated %s.", x.Name), nil
			},
		},
	}
}

func subscriptionProps(create bool) map[string]any {
	p := map[string]any{
		"name":      prop("string", "e.g. Hetzner server, Mautic, Claude API"),
		"category":  map[string]any{"type": "string", "enum": []string{"infrastructure", "ai", "marketing", "software", "domain", "support", "other"}},
		"vendor":    prop("string", ""),
		"price":     prop("string", "Billed per period, e.g. \"49.00\""),
		"cost":      prop("string", "Our cost per period"),
		"currency":  prop("string", "3-letter code, default USD"),
		"interval":  map[string]any{"type": "string", "enum": []string{"month", "quarter", "year", "one_time"}},
		"starts_on": prop("string", "YYYY-MM-DD, default today"),
		"ends_on":   prop("string", "YYYY-MM-DD; \"\" clears"),
		"billable":  prop("boolean", "Default true"),
		"active":    prop("boolean", "Default true"),
		"notes":     prop("string", ""),
	}
	if create {
		p["project"] = prop("string", "Project id or exact name")
	} else {
		p["id"] = prop("string", "Subscription id")
	}
	return p
}

func subscriptionInput(args map[string]any) work.SubscriptionInput {
	in := work.SubscriptionInput{}
	for k, dst := range map[string]**string{"name": &in.Name, "category": &in.Category, "vendor": &in.Vendor, "price": &in.Price,
		"cost": &in.Cost, "currency": &in.Currency, "interval": &in.Interval, "starts_on": &in.StartsOn, "ends_on": &in.EndsOn, "notes": &in.Notes} {
		if v, ok := args[k].(string); ok {
			v := v
			*dst = &v
		}
	}
	for k, dst := range map[string]**bool{"billable": &in.Billable, "active": &in.Active} {
		if v, ok := args[k].(bool); ok {
			v := v
			*dst = &v
		}
	}
	return in
}
