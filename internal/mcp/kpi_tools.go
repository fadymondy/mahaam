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
KPITools: the employee KPI dossier and manager reviews (internal/work/kpi.go), so an AI can
write a performance report from facts.

	employee_kpi, list_member_reviews   kpi:read   (member+; your own unless manager+, enforced in the domain)
	team_kpi                            kpi:read   (manager+, enforced in the domain)
	add_member_review                   kpi:review (manager+)
*/
func KPITools() []Tool {
	rangeProps := func(extra map[string]any) map[string]any {
		m := map[string]any{
			"from": prop("string", "YYYY-MM-DD, workspace timezone (default: the 1st of this month)"),
			"to":   prop("string", "YYYY-MM-DD inclusive (default: today)"),
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	return []Tool{
		{
			Name: "employee_kpi",
			Description: "An employee's KPI dossier as markdown, for writing their performance report: hours (by project and week), " +
				"tasks completed/open/overdue, issues their AI agent worked (plans, reviews, finishes, agent time, mentions answered), " +
				"AI usage, GitHub commits/PRs/deployments (attributed via their mapped GitHub account), MCP activity and manager reviews. " +
				"Facts only — draw conclusions yourself and say where data is missing. Your own KPI, or anyone's as a manager.",
			Scope:       "kpi:read",
			InputSchema: schema(nil, rangeProps(map[string]any{"user": prop("string", "E-mail, user id or \"me\" (default me)")})),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				k, err := work.New(a).MemberKPI(ctx, str(args, "user"), work.KPIQuery{From: str(args, "from"), To: str(args, "to")})
				if err != nil {
					return "", toolErr(err)
				}
				return work.KPIMarkdown(k), nil
			},
		},
		{
			Name:        "team_kpi",
			Description: "One headline KPI row per employee (hours, tasks, agent issues, AI, GitHub, MCP, reviews) as a markdown table. Manager+.",
			Scope:       "kpi:read",
			InputSchema: schema(nil, rangeProps(nil)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				t, err := work.New(a).TeamKPIs(ctx, work.KPIQuery{From: str(args, "from"), To: str(args, "to")})
				if err != nil {
					return "", toolErr(err)
				}
				return work.TeamKPIMarkdown(t), nil
			},
		},
		{
			Name:        "list_member_reviews",
			Description: "Manager reviews of an employee (all, or those overlapping from..to). Your own, or anyone's as a manager.",
			Scope:       "kpi:read",
			InputSchema: schema(nil, rangeProps(map[string]any{"user": prop("string", "E-mail, user id or \"me\" (default me)")})),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				list, err := work.New(a).ListReviews(ctx, str(args, "user"), str(args, "from"), str(args, "to"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No reviews.", nil
				}
				var b strings.Builder
				for _, r := range list {
					rating := "no rating"
					if r.Rating != nil {
						rating = fmt.Sprintf("%d/5", *r.Rating)
					}
					fmt.Fprintf(&b, "## %s to %s — %s, by %s\n\n%s\n\n(id: %s)\n\n", r.PeriodStart, r.PeriodEnd, rating, r.AuthorEmail, strings.TrimSpace(r.Body), r.ID)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "add_member_review",
			Description: "Write a manager review of an employee for a period (rating 1-5 optional). It appears in their KPI dossier. Manager+.",
			Scope:       "kpi:review",
			InputSchema: schema([]string{"user", "period_start", "period_end", "body"}, map[string]any{
				"user":         prop("string", "E-mail or user id of the employee"),
				"period_start": prop("string", "YYYY-MM-DD"),
				"period_end":   prop("string", "YYYY-MM-DD inclusive"),
				"rating":       prop("integer", "1-5, optional"),
				"body":         prop("string", "The review (markdown)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				in := work.ReviewInput{PeriodStart: str(args, "period_start"), PeriodEnd: str(args, "period_end"), Body: str(args, "body")}
				if n := optInt(args, "rating"); n != nil {
					v := int(*n)
					in.Rating = &v
				}
				r, err := work.New(a).AddReview(ctx, str(args, "user"), in)
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Review %s added for %s to %s.", r.ID, r.PeriodStart, r.PeriodEnd), nil
			},
		},
	}
}
