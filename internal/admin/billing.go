package admin

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/billing/polar"
	"github.com/fadymondy/mahaam/internal/circlexo"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

// Billing is a workspace's subscription state (Polar webhooks).
type Billing struct {
	Status              *string    `json:"status"`
	PeriodEnd           *time.Time `json:"period_end"`
	CancelAtPeriodEnd   bool       `json:"cancel_at_period_end"`
	PolarCustomerID     *string    `json:"polar_customer_id"`
	PolarSubscriptionID *string    `json:"polar_subscription_id"`
	UpdatedAt           *time.Time `json:"updated_at"`
	LastWebhookAt       *time.Time `json:"last_webhook_at"`
	LastWebhookType     *string    `json:"last_webhook_type"`
}

// BillingOf reads a workspace's billing state.
func BillingOf(ctx context.Context, db *sql.DB, ws string) (*Billing, error) {
	b := &Billing{}
	err := db.QueryRowContext(ctx, `SELECT billing_status, billing_period_end, billing_cancel_at_period_end, polar_customer_id,
		polar_subscription_id, billing_updated_at,
		(SELECT received_at FROM polar_webhook_events e WHERE e.workspace_id = w.id ORDER BY received_at DESC LIMIT 1),
		(SELECT type FROM polar_webhook_events e WHERE e.workspace_id = w.id ORDER BY received_at DESC LIMIT 1)
		FROM workspaces w WHERE id = $1`, ws).Scan(&b.Status, &b.PeriodEnd, &b.CancelAtPeriodEnd, &b.PolarCustomerID,
		&b.PolarSubscriptionID, &b.UpdatedAt, &b.LastWebhookAt, &b.LastWebhookType)
	return b, err
}

// BuyablePlan is a plan the workspace can check out.
type BuyablePlan struct {
	Key          string `json:"key"`
	NameEn       string `json:"name_en"`
	NameAr       string `json:"name_ar"`
	PriceLabelEn string `json:"price_label_en"`
	PriceLabelAr string `json:"price_label_ar"`
	BaseFeeMinor int64  `json:"base_fee_minor"`
	Currency     string `json:"currency"`
	Purchasable  bool   `json:"purchasable"`
}

// WorkspaceBilling is GET /api/w/billing.
type WorkspaceBilling struct {
	Configured bool `json:"configured"`
	// HubLinked is true when the CircleXO hub runs this workspace's subscription: the plan and limits
	// come from it and HubBillingURL is where it is managed. Polar is not used for it.
	HubLinked     bool          `json:"hub_linked"`
	HubBillingURL string        `json:"hub_billing_url,omitempty"`
	Billing       *Billing      `json:"billing"`
	Plans         []BuyablePlan `json:"plans"`
}

// SyncPolar runs the Polar sync (dry run or apply), audited.
func (sv *Service) SyncPolar(ctx context.Context, a Actor, c *polar.Client, dryRun bool) (*polar.SyncReport, error) {
	rep, err := polar.Sync(ctx, sv.DB, c, dryRun)
	if err != nil {
		return nil, err
	}
	if !dryRun {
		if err := sv.audit(ctx, sv.DB, a, "billing.polar_synced", "polar", "", "", rep); err != nil {
			return nil, err
		}
	}
	return rep, nil
}

// PolarIDs maps plan key → Polar product id.
func (sv *Service) PolarIDs(ctx context.Context) (map[string]string, error) {
	rows, err := sv.DB.QueryContext(ctx, `SELECT key, polar_product_id FROM plans WHERE polar_product_id IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, id string
		if err := rows.Scan(&k, &id); err != nil {
			return nil, err
		}
		out[k] = id
	}
	return out, rows.Err()
}

func polarErr(err error) error {
	var api *polar.APIError
	switch {
	case errors.Is(err, polar.ErrNotConfigured):
		return errStatus(http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, polar.ErrPlanNotSold):
		return errStatus(http.StatusUnprocessableEntity, err.Error())
	case errors.As(err, &api):
		return errStatus(http.StatusBadGateway, "the payment provider refused the request")
	}
	return err
}

// registerBilling mounts the workspace billing routes and the admin sync.
func registerBilling(api huma.API, a *app.App, sv *Service, fail func(error) error, actor func(context.Context) Actor) {
	client := func() (*polar.Client, error) { return polar.FromEnv() }
	owner := func(ctx context.Context) (*tenant.Scope, error) {
		s, ok := tenant.From(ctx)
		if !ok {
			return nil, huma.Error404NotFound("workspace not found")
		}
		if !authz.Role(s.Role).AtLeast(authz.Admin) {
			return nil, huma.Error403Forbidden("only workspace owners and admins manage billing")
		}
		return s, nil
	}

	huma.Register(api, huma.Operation{OperationID: "w-billing", Method: http.MethodGet, Path: "/api/w/billing",
		Summary: "Subscription state and the plans that can be bought (admins)", Tags: []string{"Plan"}},
		func(ctx context.Context, _ *work.WS) (*work.Resp[WorkspaceBilling], error) {
			s, err := owner(ctx)
			if err != nil {
				return nil, err
			}
			out := WorkspaceBilling{Plans: []BuyablePlan{}}
			if u, ok := circlexo.BillingURL(ctx, s.WorkspaceID); ok {
				out.HubLinked, out.HubBillingURL = true, u
			}
			_, cerr := client()
			out.Configured = cerr == nil
			if out.Billing, err = BillingOf(ctx, sv.DB, s.WorkspaceID); err != nil {
				return nil, fail(err)
			}
			plans, err := limits.ListPlans(ctx, sv.DB)
			if err != nil {
				return nil, fail(err)
			}
			ids, err := sv.PolarIDs(ctx)
			if err != nil {
				return nil, fail(err)
			}
			for _, p := range plans {
				if !p.Active || p.Key == "unlimited" {
					continue
				}
				out.Plans = append(out.Plans, BuyablePlan{Key: p.Key, NameEn: p.NameEn, NameAr: p.NameAr, PriceLabelEn: p.PriceLabelEn,
					PriceLabelAr: p.PriceLabelAr, BaseFeeMinor: p.BaseFeeMinor, Currency: p.Currency,
					Purchasable: out.Configured && ids[p.Key] != "" && polar.Paid(p)})
			}
			return &work.Resp[WorkspaceBilling]{Body: out}, nil
		})

	type urlOut struct {
		URL string `json:"url"`
	}
	huma.Register(api, huma.Operation{OperationID: "w-billing-checkout", Method: http.MethodPost, Path: "/api/w/billing/checkout",
		Summary: "Start a Polar checkout for a plan (owners/admins); returns the URL to redirect to", Tags: []string{"Plan"}},
		func(ctx context.Context, in *struct {
			work.WS
			Body struct {
				Plan   string `json:"plan" minLength:"1"`
				Locale string `json:"locale,omitempty" enum:"en,ar,"`
			}
		}) (*work.Resp[urlOut], error) {
			s, err := owner(ctx)
			if err != nil {
				return nil, err
			}
			if u, ok := circlexo.BillingURL(ctx, s.WorkspaceID); ok {
				return &work.Resp[urlOut]{Body: urlOut{URL: u}}, nil // CircleXO runs this subscription
			}
			c, err := client()
			if err != nil {
				return nil, fail(polarErr(err))
			}
			var email string
			_ = sv.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, s.UserID).Scan(&email)
			u, err := polar.Checkout(ctx, sv.DB, c, polar.CheckoutInput{WorkspaceID: s.WorkspaceID, Slug: s.WorkspaceSlug,
				Plan: strings.ToLower(strings.TrimSpace(in.Body.Plan)), Email: email, Locale: in.Body.Locale})
			if err != nil {
				return nil, fail(polarErr(err))
			}
			return &work.Resp[urlOut]{Body: urlOut{URL: u}}, nil
		})
	huma.Register(api, huma.Operation{OperationID: "w-billing-portal", Method: http.MethodPost, Path: "/api/w/billing/portal",
		Summary: "Open the Polar customer portal (manage billing); returns the URL", Tags: []string{"Plan"}},
		func(ctx context.Context, _ *work.WS) (*work.Resp[urlOut], error) {
			s, err := owner(ctx)
			if err != nil {
				return nil, err
			}
			if u, ok := circlexo.BillingURL(ctx, s.WorkspaceID); ok {
				return &work.Resp[urlOut]{Body: urlOut{URL: u}}, nil // CircleXO runs this subscription
			}
			c, err := client()
			if err != nil {
				return nil, fail(polarErr(err))
			}
			u, err := polar.PortalURL(ctx, c, s.WorkspaceID)
			if err != nil {
				return nil, fail(polarErr(err))
			}
			return &work.Resp[urlOut]{Body: urlOut{URL: u}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "admin-polar-sync", Method: http.MethodPost, Path: "/api/admin/billing/polar-sync",
		Summary: "Map plans onto Polar products and meters (dry_run previews)", Tags: []string{"Platform admin"}},
		func(ctx context.Context, in *struct {
			Body struct {
				DryRun bool `json:"dry_run"`
			}
		}) (*work.Resp[*polar.SyncReport], error) {
			c, err := client()
			if err != nil {
				return nil, fail(polarErr(err))
			}
			rep, err := sv.SyncPolar(ctx, actor(ctx), c, in.Body.DryRun)
			if err != nil {
				return nil, fail(polarErr(err))
			}
			return &work.Resp[*polar.SyncReport]{Body: rep}, nil
		})
	_ = a
}
