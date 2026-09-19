package polar

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"
)

// ErrPlanNotSold is a plan that has no Polar product (not paid, or not synced yet).
var ErrPlanNotSold = errors.New("this plan cannot be bought online yet — contact us to upgrade")

// SuccessURL is where Polar sends the customer after paying (POLAR_SUCCESS_URL; {locale} and
// {slug} are filled in).
func SuccessURL(locale, slug string) string {
	u := strings.TrimSpace(os.Getenv("POLAR_SUCCESS_URL"))
	if u == "" {
		u = "https://console.mahaam.app/{locale}/w/{slug}/settings/plan?paid=1"
	}
	if locale != "ar" {
		locale = "en"
	}
	return strings.NewReplacer("{locale}", locale, "{slug}", slug).Replace(u)
}

// CheckoutInput is who is buying what.
type CheckoutInput struct {
	WorkspaceID, Slug, Plan, Email, Locale string
}

// Checkout opens a Polar checkout for a workspace moving to plan and returns its URL. The
// workspace is the Polar customer (external_customer_id = workspace id).
func Checkout(ctx context.Context, db *sql.DB, c *Client, in CheckoutInput) (string, error) {
	var productID sql.NullString
	var active bool
	err := db.QueryRowContext(ctx, `SELECT polar_product_id, active FROM plans WHERE key = $1`, in.Plan).Scan(&productID, &active)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (!active || productID.String == "")) {
		return "", ErrPlanNotSold
	}
	if err != nil {
		return "", err
	}
	body := map[string]any{
		"products":             []string{productID.String},
		"external_customer_id": in.WorkspaceID,
		"success_url":          SuccessURL(in.Locale, in.Slug),
		"metadata":             map[string]any{"app": App, "workspace_id": in.WorkspaceID, "plan": in.Plan},
	}
	if in.Email != "" {
		body["customer_email"] = in.Email
	}
	var out struct {
		URL string `json:"url"`
	}
	if err := c.Do(ctx, http.MethodPost, "/v1/checkouts/", body, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", errors.New("polar returned no checkout url")
	}
	return out.URL, nil
}

// PortalURL opens a Polar customer portal session for the workspace ("Manage billing").
func PortalURL(ctx context.Context, c *Client, workspaceID string) (string, error) {
	var out struct {
		URL string `json:"customer_portal_url"`
	}
	if err := c.Do(ctx, http.MethodPost, "/v1/customer-sessions/", map[string]any{"external_customer_id": workspaceID}, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", errors.New("polar returned no portal url")
	}
	return out.URL, nil
}

// WebhookEvents are the deliveries Mahaam handles.
var WebhookEvents = []string{"subscription.created", "subscription.active", "subscription.updated",
	"subscription.canceled", "subscription.revoked", "subscription.uncanceled", "order.paid"}

// EnsureWebhook creates the webhook endpoint for url unless one exists, and returns its secret
// when it created one ("" when it already existed — the secret is only shown at creation).
func EnsureWebhook(ctx context.Context, c *Client, url string) (created bool, secret string, err error) {
	var existing list[struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}]
	if err := c.Do(ctx, http.MethodGet, "/v1/webhooks/endpoints?limit=100", nil, &existing); err != nil {
		return false, "", err
	}
	for _, e := range existing.Items {
		if e.URL == url {
			return false, "", nil
		}
	}
	var out struct {
		Secret string `json:"secret"`
	}
	if err := c.Do(ctx, http.MethodPost, "/v1/webhooks/endpoints", map[string]any{
		"url": url, "format": "raw", "events": WebhookEvents,
	}, &out); err != nil {
		return false, "", err
	}
	return true, out.Secret, nil
}
