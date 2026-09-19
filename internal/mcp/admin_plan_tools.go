package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/admin"
	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
adminPlanTools are the admin MCP mirror of the admin panel's plan, quota and suspension actions.
They call internal/admin, the same functions as /api/admin/*, so both write the same audit rows
(via "mcp").
*/
func adminPlanTools() []Tool {
	sv := func(a *app.App) *admin.Service { return &admin.Service{DB: a.SysDB} }
	actor := func(ctx context.Context) admin.Actor {
		c := callerFrom(ctx)
		return admin.Actor{ID: c.UserID, Email: c.Email, IP: work.MetaFrom(ctx).IP, Via: "mcp"}
	}
	onOff := map[string]any{"type": "string", "enum": []string{"suspend", "reactivate"}}
	month := prop("string", "YYYY-MM (default: this month)")

	return []Tool{
		{
			Name:        "platform_stats",
			Description: "Platform dashboard: users, workspaces, active users and workspaces (7/30 days), projects, tasks, issues, time tracked, storage, workspaces per plan and signups over the last 30 days.",
			Scope:       "admin:stats:read",
			InputSchema: schema(nil, map[string]any{}),
			Run: func(ctx context.Context, a *app.App, _ json.RawMessage) (string, error) {
				s, err := sv(a).PlatformStats(ctx)
				if err != nil {
					return "", err
				}
				var b strings.Builder
				fmt.Fprintf(&b, "users %d (admins %d, suspended %d; active 7d %d, 30d %d)\n", s.Users, s.Admins, s.SuspendedUsers, s.ActiveUsers7d, s.ActiveUsers30d)
				fmt.Fprintf(&b, "workspaces %d (suspended %d; active 7d %d, 30d %d)\n", s.Workspaces, s.SuspendedWorkspaces, s.ActiveWorkspaces7d, s.ActiveWorkspaces30d)
				fmt.Fprintf(&b, "projects %d, tasks %d, issues %d, time tracked %.1f h, storage %.1f MB\n", s.Projects, s.Tasks, s.Issues,
					float64(s.TimeSeconds)/3600, float64(s.StorageBytes)/(1<<20))
				b.WriteString("plans:")
				for _, p := range s.Plans {
					fmt.Fprintf(&b, " %s=%d", p.Plan, p.Count)
				}
				users, wss := 0, 0
				for _, d := range s.Signups {
					users += d.Users
					wss += d.Workspaces
				}
				fmt.Fprintf(&b, "\nsignups (30 days): %d users, %d workspaces\n", users, wss)
				return b.String(), nil
			},
		},
		{
			Name:        "list_plans",
			Description: "Every plan with its base fee, quotas (limit / policy block|overage / overage unit price), features and how many workspaces are on it.",
			Scope:       "admin:plans:read",
			InputSchema: schema(nil, map[string]any{}),
			Run: func(ctx context.Context, a *app.App, _ json.RawMessage) (string, error) {
				plans, err := sv(a).Plans(ctx)
				if err != nil {
					return "", err
				}
				var b strings.Builder
				for _, p := range plans {
					state := "active"
					if !p.Active {
						state = "inactive"
					}
					fmt.Fprintf(&b, "%s — %s (%s, %s, base %s, %d workspace(s))\n", p.Key, p.NameEn, state, p.Currency, money(p.BaseFeeMinor), p.Workspaces)
					for _, d := range limits.Catalog {
						r := p.Limits[d.Key]
						fmt.Fprintf(&b, "  %-20s %s\n", d.Key, ruleText(r))
					}
					f, _ := json.Marshal(p.Features)
					fmt.Fprintf(&b, "  features %s\n\n", f)
				}
				return b.String(), nil
			},
		},
		{
			Name: "update_plan",
			Description: "Change a plan's quotas and/or base fee or active flag. limits maps limit keys to {limit (null = unlimited), policy block|overage, unit_price_minor, unit_size}; " +
				"only the keys given change. Keys: " + catalogKeys() + ".",
			Scope: "admin:plans:write",
			InputSchema: schema([]string{"plan"}, map[string]any{
				"plan":           prop("string", "Plan key"),
				"limits":         map[string]any{"type": "object", "description": "limit key → rule"},
				"base_fee_minor": prop("integer", "Base monthly fee in minor units (cents)"),
				"active":         prop("boolean", ""),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				var in struct {
					Plan         string                 `json:"plan"`
					Limits       map[string]limits.Rule `json:"limits"`
					BaseFeeMinor *int64                 `json:"base_fee_minor"`
					Active       *bool                  `json:"active"`
				}
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", fmt.Errorf("invalid arguments: %w", err)
				}
				p, err := sv(a).PatchPlan(ctx, actor(ctx), in.Plan, in.Limits, in.Active, in.BaseFeeMinor)
				if err != nil {
					return "", err
				}
				return fmt.Sprintf("Updated plan %s (%d workspace(s) on it).", p.Key, p.Workspaces), nil
			},
		},
		{
			Name:        "set_workspace_plan",
			Description: "Move a workspace (slug or id) to another active plan. Its quotas apply at once.",
			Scope:       "admin:workspaces:write",
			InputSchema: schema([]string{"workspace", "plan"}, map[string]any{"workspace": prop("string", "Slug or id"), "plan": prop("string", "Plan key")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := sv(a).SetPlan(ctx, actor(ctx), str(args, "workspace"), str(args, "plan"))
				if err != nil {
					return "", err
				}
				return fmt.Sprintf("%s is now on %s.\n\n%s", r.Workspace.Slug, r.Plan.NameEn, usageText(r)), nil
			},
		},
		{
			Name:        "suspend_workspace",
			Description: "Suspend a workspace (its members get 403 with the reason; platform admins still see it) or reactivate it.",
			Scope:       "admin:workspaces:write",
			InputSchema: schema([]string{"workspace"}, map[string]any{"workspace": prop("string", "Slug or id"), "action": onOff, "reason": prop("string", "Shown to members")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				var w *admin.Workspace
				var err error
				if str(args, "action") == "reactivate" {
					w, err = sv(a).ReactivateWorkspace(ctx, actor(ctx), str(args, "workspace"))
				} else {
					w, err = sv(a).SuspendWorkspace(ctx, actor(ctx), str(args, "workspace"), str(args, "reason"))
				}
				if err != nil {
					return "", err
				}
				return fmt.Sprintf("%s is %s.", w.Slug, w.Status), nil
			},
		},
		{
			Name:        "suspend_user",
			Description: "Suspend an account (every session and MCP token call answers 403; sign-in is refused) or reactivate it.",
			Scope:       "admin:users:write",
			InputSchema: schema([]string{"user"}, map[string]any{"user": prop("string", "Email or id"), "action": onOff, "reason": prop("string", "Shown to the user")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				var d *admin.UserDetail
				var err error
				if str(args, "action") == "reactivate" {
					d, err = sv(a).ReactivateUser(ctx, actor(ctx), str(args, "user"))
				} else {
					d, err = sv(a).SuspendUser(ctx, actor(ctx), str(args, "user"), str(args, "reason"))
				}
				if err != nil {
					return "", err
				}
				return fmt.Sprintf("%s is %s.", d.User.Email, d.User.Status), nil
			},
		},
		{
			Name:        "billing_status",
			Description: "A workspace's Polar subscription: billing status, period end, cancel flag, Polar customer and subscription ids, and the last webhook.",
			Scope:       "admin:workspaces:read",
			InputSchema: schema([]string{"workspace"}, map[string]any{"workspace": prop("string", "Slug or id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				d, err := sv(a).GetWorkspace(ctx, str(decodeArgs(raw), "workspace"))
				if err != nil {
					return "", err
				}
				b, _ := json.MarshalIndent(d.Billing, "", "  ")
				return fmt.Sprintf("%s on %s\n%s", d.Workspace.Slug, d.Workspace.Plan, b), nil
			},
		},
		{
			Name:        "workspace_usage",
			Description: "A workspace's usage for a month against its plan: every quota with usage, limit, policy and overage.",
			Scope:       "admin:workspaces:read",
			InputSchema: schema([]string{"workspace"}, map[string]any{"workspace": prop("string", "Slug or id"), "month": month}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				r, err := reportFor(ctx, a, decodeArgs(raw))
				if err != nil {
					return "", err
				}
				return usageText(r), nil
			},
		},
		{
			Name:        "estimate_bill",
			Description: "The pay-as-you-go bill of a workspace for a month: base fee + overage per quota (so far, for the current month).",
			Scope:       "admin:workspaces:read",
			InputSchema: schema([]string{"workspace"}, map[string]any{"workspace": prop("string", "Slug or id"), "month": month}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				r, err := reportFor(ctx, a, decodeArgs(raw))
				if err != nil {
					return "", err
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%s — %s, %s (%s)\n  base fee   %s\n", r.Workspace.Slug, r.Plan.NameEn, r.Period[:7], r.Currency, money(r.BaseFeeMinor))
				for _, it := range r.Items {
					if it.OverageMinor > 0 {
						fmt.Fprintf(&b, "  %-20s %d over → %s\n", it.Key, it.Over, money(it.OverageMinor))
					}
				}
				fmt.Fprintf(&b, "  total      %s\n", money(r.EstimateMinor))
				return b.String(), nil
			},
		},
	}
}

func reportFor(ctx context.Context, a *app.App, args map[string]any) (*limits.Report, error) {
	at := time.Now()
	if m := strings.TrimSpace(str(args, "month")); m != "" {
		t, err := time.Parse("2006-01", m)
		if err != nil {
			return nil, errors.New("month must be YYYY-MM")
		}
		at = t
	}
	return (&admin.Service{DB: a.SysDB}).Usage(ctx, str(args, "workspace"), at)
}

func money(minor int64) string { return fmt.Sprintf("%d.%02d", minor/100, minor%100) }

func ruleText(r limits.Rule) string {
	if r.Limit == nil {
		return "unlimited"
	}
	s := fmt.Sprintf("%d (%s)", *r.Limit, r.Policy)
	if r.Policy == limits.Overage && r.UnitPriceMinor > 0 {
		s += fmt.Sprintf(", %s per %d over", money(r.UnitPriceMinor), r.UnitSize)
	}
	return s
}

func usageText(r *limits.Report) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s (%s) on %s, %s — status %s\n", r.Workspace.Slug, r.Workspace.Name, r.Plan.NameEn, r.Period[:7], r.Workspace.Status)
	for _, it := range r.Items {
		limit := "∞"
		if it.Limit != nil {
			limit = fmt.Sprint(*it.Limit)
		}
		line := fmt.Sprintf("  %-20s %d / %s (%s)", it.Key, it.Usage, limit, it.Policy)
		if it.Over > 0 {
			line += fmt.Sprintf(" — %d over", it.Over)
			if it.OverageMinor > 0 {
				line += ", " + money(it.OverageMinor)
			}
		}
		if it.Overridden {
			line += " [override]"
		}
		b.WriteString(line + "\n")
	}
	fmt.Fprintf(&b, "estimate: base %s + overage %s = %s %s\n", money(r.BaseFeeMinor), money(r.OverageMinor), money(r.EstimateMinor), r.Currency)
	return b.String()
}

func catalogKeys() string {
	keys := make([]string, 0, len(limits.Catalog))
	for _, d := range limits.Catalog {
		keys = append(keys, d.Key)
	}
	return strings.Join(keys, ", ")
}
