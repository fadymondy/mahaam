package admin

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/platform"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
Register mounts:

	GET  /api/me/platform                          signed in: am I a platform admin
	GET  /api/w/plan                               workspace admin+: plan, usage this month, estimate

and the admin panel (guard tier "admin": session + platform admin, 404 to everyone else):

	GET  /api/admin/stats
	GET  /api/admin/users                          ?q&status&page&per_page
	GET  /api/admin/users/{user}
	POST /api/admin/users/{user}/suspend           {reason}
	POST /api/admin/users/{user}/reactivate
	PUT  /api/admin/users/{user}/admin             {admin}
	POST /api/admin/users/{user}/sign-out
	GET  /api/admin/workspaces                     ?q&plan&status&page&per_page
	GET  /api/admin/workspaces/{workspace}
	GET  /api/admin/workspaces/{workspace}/usage   ?month=YYYY-MM
	PUT  /api/admin/workspaces/{workspace}/plan    {plan}
	PUT  /api/admin/workspaces/{workspace}/overrides {limits, features}
	POST /api/admin/workspaces/{workspace}/suspend {reason}
	POST /api/admin/workspaces/{workspace}/reactivate
	POST /api/admin/workspaces/{workspace}/delete  {confirm: slug}
	GET  /api/admin/plans
	POST /api/admin/plans
	PUT  /api/admin/plans/{plan}
	POST /api/admin/plans/{plan}/deactivate
	GET  /api/admin/audit                          ?q&page&per_page

Platform issues are the platform workspace's own /api/w/issues/* (platform admins act there as
workspace admins, tenant.Resolve), so the admin panel reuses the issues board.
*/
func Register(api huma.API, a *app.App) {
	sv := &Service{}
	if a != nil {
		sv.DB, sv.Store = a.SysDB, a.Storage
	}
	const tag = "Platform admin"

	fail := func(err error) error {
		if e, ok := work.AsError(err); ok {
			return huma.NewError(e.Status, e.Msg)
		}
		if a != nil && a.Log != nil {
			a.Log.Error("admin", "err", err)
		}
		return huma.Error500InternalServerError("something went wrong")
	}
	actor := func(ctx context.Context) Actor {
		act := Actor{IP: work.MetaFrom(ctx).IP, Via: "rest"}
		if id, ok := auth.IdentityFrom(ctx); ok && id != nil {
			act.ID, act.Email = id.ID, id.Email
		}
		return act
	}
	reg := func(op huma.Operation) huma.Operation {
		op.Tags = []string{tag}
		return op
	}

	// ---- account + workspace -------------------------------------------------------------------

	huma.Register(api, huma.Operation{OperationID: "me-platform", Method: http.MethodGet, Path: "/api/me/platform",
		Summary: "Whether I am a platform admin (shows the admin panel link)", Tags: []string{"Tenancy"}},
		func(ctx context.Context, _ *struct{}) (*work.Resp[struct {
			IsAdmin bool `json:"is_admin"`
		}], error) {
			out := &work.Resp[struct {
				IsAdmin bool `json:"is_admin"`
			}]{}
			if id, ok := auth.IdentityFrom(ctx); ok && id != nil {
				if u, err := platform.Load(ctx, sv.DB, id.ID); err == nil {
					out.Body.IsAdmin = u.Admin
				}
			}
			return out, nil
		})

	// The owner deletes their own workspace (Settings → Workspace → Danger zone). Same path as the
	// platform admin's delete (cascade, audit, stored files removed), with two extra guards: only
	// the OWNER may, and not while a paid subscription is still running (cancel it first, so the
	// workspace is never deleted while Polar keeps billing it).
	huma.Register(api, huma.Operation{OperationID: "w-delete-workspace", Method: http.MethodDelete, Path: "/api/w/workspace",
		Summary: "Delete this workspace and everything in it (owner only; type the slug to confirm)", Tags: []string{"Plan"},
		DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			work.WS
			Body struct {
				Confirm string `json:"confirm" doc:"The workspace's slug, typed to confirm"`
			}
		}) (*struct{}, error) {
			s, ok := tenant.From(ctx)
			if !ok {
				return nil, huma.Error404NotFound("workspace not found")
			}
			if s.Role != string(authz.Owner) {
				return nil, huma.Error403Forbidden("only the workspace owner can delete it")
			}
			var billing string
			_ = sv.DB.QueryRowContext(ctx, `SELECT COALESCE(billing_status, '') FROM workspaces WHERE id = $1`, s.WorkspaceID).Scan(&billing)
			if billing == "active" || billing == "past_due" {
				return nil, huma.Error409Conflict("cancel the subscription first (Settings → Plan → Manage billing), then delete the workspace")
			}
			if err := sv.DeleteWorkspace(ctx, Actor{ID: s.UserID, Email: s.Email, IP: work.MetaFrom(ctx).IP, Via: "owner"}, s.WorkspaceID, in.Body.Confirm); err != nil {
				return nil, fail(err)
			}
			return nil, nil
		})

	huma.Register(api, huma.Operation{OperationID: "w-plan", Method: http.MethodGet, Path: "/api/w/plan",
		Summary: "The workspace's plan, usage this month and the pay-as-you-go estimate (admins)", Tags: []string{"Plan"}},
		func(ctx context.Context, _ *work.WS) (*work.Resp[*limits.Report], error) {
			s, ok := tenant.From(ctx)
			if !ok {
				return nil, huma.Error404NotFound("workspace not found")
			}
			if !authz.Role(s.Role).AtLeast(authz.Admin) {
				return nil, huma.Error403Forbidden("only workspace owners and admins see the plan")
			}
			r, err := limits.BuildReport(ctx, sv.DB, s.WorkspaceID, time.Now())
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*limits.Report]{Body: r}, nil
		})

	// ---- stats ---------------------------------------------------------------------------------

	huma.Register(api, reg(huma.Operation{OperationID: "admin-stats", Method: http.MethodGet, Path: "/api/admin/stats", Summary: "Platform dashboard"}),
		func(ctx context.Context, _ *struct{}) (*work.Resp[*Stats], error) {
			s, err := sv.PlatformStats(ctx)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*Stats]{Body: s}, nil
		})

	// ---- users ---------------------------------------------------------------------------------

	type PageIn struct {
		Page    int `query:"page" minimum:"0"`
		PerPage int `query:"per_page" minimum:"0" maximum:"200"`
	}
	type userList struct {
		Users   []User `json:"users"`
		Total   int    `json:"total"`
		Page    int    `json:"page"`
		PerPage int    `json:"per_page"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-list-users", Method: http.MethodGet, Path: "/api/admin/users", Summary: "Accounts"}),
		func(ctx context.Context, in *struct {
			Q      string `query:"q"`
			Status string `query:"status" enum:"active,suspended,admin,"`
			PageIn
		}) (*work.Resp[userList], error) {
			list, total, err := sv.ListUsers(ctx, UserFilter{Q: in.Q, Status: in.Status, Page: Page{in.Page, in.PerPage}})
			if err != nil {
				return nil, fail(err)
			}
			per, _ := Page{in.Page, in.PerPage}.norm(25)
			return &work.Resp[userList]{Body: userList{Users: list, Total: total, Page: max(in.Page, 1), PerPage: per}}, nil
		})

	type UserRef struct {
		User string `path:"user" doc:"User id or email"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-get-user", Method: http.MethodGet, Path: "/api/admin/users/{user}", Summary: "One account"}),
		func(ctx context.Context, in *UserRef) (*work.Resp[*UserDetail], error) {
			d, err := sv.GetUser(ctx, in.User)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*UserDetail]{Body: d}, nil
		})
	type reasonBody struct {
		Reason string `json:"reason,omitempty" maxLength:"500"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-suspend-user", Method: http.MethodPost, Path: "/api/admin/users/{user}/suspend", Summary: "Suspend an account"}),
		func(ctx context.Context, in *struct {
			UserRef
			Body reasonBody
		}) (*work.Resp[*UserDetail], error) {
			d, err := sv.SuspendUser(ctx, actor(ctx), in.User, in.Body.Reason)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*UserDetail]{Body: d}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "admin-reactivate-user", Method: http.MethodPost, Path: "/api/admin/users/{user}/reactivate", Summary: "Lift an account's suspension"}),
		func(ctx context.Context, in *UserRef) (*work.Resp[*UserDetail], error) {
			d, err := sv.ReactivateUser(ctx, actor(ctx), in.User)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*UserDetail]{Body: d}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "admin-set-user-admin", Method: http.MethodPut, Path: "/api/admin/users/{user}/admin", Summary: "Grant or revoke platform admin"}),
		func(ctx context.Context, in *struct {
			UserRef
			Body struct {
				Admin bool `json:"admin"`
			}
		}) (*work.Resp[*UserDetail], error) {
			d, err := sv.SetAdmin(ctx, actor(ctx), in.User, in.Body.Admin)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*UserDetail]{Body: d}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "admin-sign-out-user", Method: http.MethodPost, Path: "/api/admin/users/{user}/sign-out", Summary: "End every session of an account"}),
		func(ctx context.Context, in *UserRef) (*work.Resp[*UserDetail], error) {
			d, err := sv.SignOut(ctx, actor(ctx), in.User)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*UserDetail]{Body: d}, nil
		})

	// ---- workspaces ----------------------------------------------------------------------------

	type wsList struct {
		Workspaces []Workspace `json:"workspaces"`
		Total      int         `json:"total"`
		Page       int         `json:"page"`
		PerPage    int         `json:"per_page"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-list-workspaces", Method: http.MethodGet, Path: "/api/admin/workspaces", Summary: "Workspaces with usage vs limits"}),
		func(ctx context.Context, in *struct {
			Q      string `query:"q"`
			Plan   string `query:"plan"`
			Status string `query:"status" enum:"active,suspended,"`
			PageIn
		}) (*work.Resp[wsList], error) {
			list, total, err := sv.ListWorkspaces(ctx, WorkspaceFilter{Q: in.Q, Plan: in.Plan, Status: in.Status, Page: Page{in.Page, in.PerPage}})
			if err != nil {
				return nil, fail(err)
			}
			per, _ := Page{in.Page, in.PerPage}.norm(25)
			return &work.Resp[wsList]{Body: wsList{Workspaces: list, Total: total, Page: max(in.Page, 1), PerPage: per}}, nil
		})

	type WSRef struct {
		Workspace string `path:"workspace" doc:"Workspace id or slug"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-get-workspace", Method: http.MethodGet, Path: "/api/admin/workspaces/{workspace}", Summary: "One workspace: members, usage, overrides"}),
		func(ctx context.Context, in *WSRef) (*work.Resp[*WorkspaceDetail], error) {
			d, err := sv.GetWorkspace(ctx, in.Workspace)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*WorkspaceDetail]{Body: d}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "admin-workspace-usage", Method: http.MethodGet, Path: "/api/admin/workspaces/{workspace}/usage", Summary: "A workspace's usage for a month"}),
		func(ctx context.Context, in *struct {
			WSRef
			Month string `query:"month" doc:"YYYY-MM (default: this month)"`
		}) (*work.Resp[*limits.Report], error) {
			at := time.Now()
			if m := strings.TrimSpace(in.Month); m != "" {
				t, err := time.Parse("2006-01", m)
				if err != nil {
					return nil, huma.Error422UnprocessableEntity("month must be YYYY-MM")
				}
				at = t
			}
			r, err := sv.Usage(ctx, in.Workspace, at)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[*limits.Report]{Body: r}, nil
		})
	type usageOut struct {
		Usage *limits.Report `json:"usage"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-set-workspace-plan", Method: http.MethodPut, Path: "/api/admin/workspaces/{workspace}/plan", Summary: "Move a workspace to another plan"}),
		func(ctx context.Context, in *struct {
			WSRef
			Body struct {
				Plan string `json:"plan" minLength:"1"`
			}
		}) (*work.Resp[usageOut], error) {
			r, err := sv.SetPlan(ctx, actor(ctx), in.Workspace, in.Body.Plan)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[usageOut]{Body: usageOut{Usage: r}}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "admin-set-workspace-overrides", Method: http.MethodPut, Path: "/api/admin/workspaces/{workspace}/overrides", Summary: "Replace a workspace's limit and feature overrides"}),
		func(ctx context.Context, in *struct {
			WSRef
			Body limits.Overrides
		}) (*work.Resp[usageOut], error) {
			r, err := sv.SetOverrides(ctx, actor(ctx), in.Workspace, in.Body)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[usageOut]{Body: usageOut{Usage: r}}, nil
		})
	type wsOut struct {
		Workspace *Workspace `json:"workspace"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-suspend-workspace", Method: http.MethodPost, Path: "/api/admin/workspaces/{workspace}/suspend", Summary: "Suspend a workspace (403 for its members)"}),
		func(ctx context.Context, in *struct {
			WSRef
			Body reasonBody
		}) (*work.Resp[wsOut], error) {
			w, err := sv.SuspendWorkspace(ctx, actor(ctx), in.Workspace, in.Body.Reason)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[wsOut]{Body: wsOut{Workspace: w}}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "admin-reactivate-workspace", Method: http.MethodPost, Path: "/api/admin/workspaces/{workspace}/reactivate", Summary: "Lift a workspace's suspension"}),
		func(ctx context.Context, in *WSRef) (*work.Resp[wsOut], error) {
			w, err := sv.ReactivateWorkspace(ctx, actor(ctx), in.Workspace)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[wsOut]{Body: wsOut{Workspace: w}}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "admin-delete-workspace", Method: http.MethodPost, Path: "/api/admin/workspaces/{workspace}/delete",
		Summary: "Delete a workspace and everything in it (confirm with its slug)", DefaultStatus: http.StatusNoContent}),
		func(ctx context.Context, in *struct {
			WSRef
			Body struct {
				Confirm string `json:"confirm" minLength:"1"`
			}
		}) (*struct{}, error) {
			if err := sv.DeleteWorkspace(ctx, actor(ctx), in.Workspace, in.Body.Confirm); err != nil {
				return nil, fail(err)
			}
			return &struct{}{}, nil
		})

	// ---- plans ---------------------------------------------------------------------------------

	type planList struct {
		Plans        []limits.Plan     `json:"plans"`
		Polar        map[string]string `json:"polar_products" doc:"plan key → Polar product id (after polar-sync)"`
		Catalog      []limits.Def      `json:"catalog"`
		Features     []string          `json:"features"`
		Integrations []string          `json:"integrations"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-list-plans", Method: http.MethodGet, Path: "/api/admin/plans", Summary: "Plans, and the limit catalog"}),
		func(ctx context.Context, _ *struct{}) (*work.Resp[planList], error) {
			list, err := sv.Plans(ctx)
			if err != nil {
				return nil, fail(err)
			}
			ids, err := sv.PolarIDs(ctx)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[planList]{Body: planList{Plans: list, Polar: ids, Catalog: limits.Catalog, Features: limits.FeatureKeys, Integrations: limits.Integrations}}, nil
		})
	type planOut struct {
		Plan *limits.Plan `json:"plan"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-create-plan", Method: http.MethodPost, Path: "/api/admin/plans", Summary: "Create a plan", DefaultStatus: http.StatusCreated}),
		func(ctx context.Context, in *struct{ Body limits.Plan }) (*work.Resp[planOut], error) {
			p, err := sv.CreatePlan(ctx, actor(ctx), in.Body)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[planOut]{Body: planOut{Plan: p}}, nil
		})
	type PlanRef struct {
		Plan string `path:"plan" doc:"Plan key"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-update-plan", Method: http.MethodPut, Path: "/api/admin/plans/{plan}", Summary: "Replace a plan's names, prices, limits and features"}),
		func(ctx context.Context, in *struct {
			PlanRef
			Body limits.Plan
		}) (*work.Resp[planOut], error) {
			p, err := sv.UpdatePlan(ctx, actor(ctx), in.Plan, in.Body)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[planOut]{Body: planOut{Plan: p}}, nil
		})
	huma.Register(api, reg(huma.Operation{OperationID: "admin-deactivate-plan", Method: http.MethodPost, Path: "/api/admin/plans/{plan}/deactivate", Summary: "Deactivate a plan (workspaces on it keep it)"}),
		func(ctx context.Context, in *PlanRef) (*work.Resp[planOut], error) {
			p, err := sv.DeactivatePlan(ctx, actor(ctx), in.Plan)
			if err != nil {
				return nil, fail(err)
			}
			return &work.Resp[planOut]{Body: planOut{Plan: p}}, nil
		})

	// ---- audit ---------------------------------------------------------------------------------

	type auditList struct {
		Entries []AuditEntry `json:"entries"`
		Total   int          `json:"total"`
		Page    int          `json:"page"`
		PerPage int          `json:"per_page"`
	}
	huma.Register(api, reg(huma.Operation{OperationID: "admin-audit", Method: http.MethodGet, Path: "/api/admin/audit", Summary: "What platform admins did"}),
		func(ctx context.Context, in *struct {
			Q string `query:"q"`
			PageIn
		}) (*work.Resp[auditList], error) {
			list, total, err := sv.Audit(ctx, AuditFilter{Q: in.Q, Page: Page{in.Page, in.PerPage}})
			if err != nil {
				return nil, fail(err)
			}
			per, _ := Page{in.Page, in.PerPage}.norm(50)
			return &work.Resp[auditList]{Body: auditList{Entries: list, Total: total, Page: max(in.Page, 1), PerPage: per}}, nil
		})

	registerBilling(api, a, sv, fail, actor)
}
