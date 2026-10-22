// Package polar is Mahaam's billing through Polar (polar.sh, merchant of record) for the
// pay-as-you-go plans:
//
//   - Sync (sync.go): each paid plan becomes a Polar product "Mahaam <Plan>" with a monthly base
//     price and one metered price per overage-billed limit, over one Polar meter per limit key.
//     Everything Mahaam creates carries metadata {"app": "mahaam", ...}; objects without it (the
//     organization's other products, meters and webhooks) are never read as Mahaam's or changed.
//   - Checkout and the customer portal (checkout.go).
//   - Webhooks (webhook.go): Standard Webhooks signatures, deduplicated by webhook-id; they set a
//     workspace's plan and billing status.
//   - Usage (usage.go): overage units from workspace_usage pushed to /v1/events/ingest as deltas.
//
// Configuration (never hard-coded): POLAR_BILLING_ENABLED (master switch, off unless "true"; Polar
// closed the organization on 2026-10-21, so checkout, the portal, sync and the usage push are
// unavailable until it is set), POLAR_ACCESS_TOKEN (organization access token), POLAR_API_URL
// (default https://api.polar.sh), POLAR_WEBHOOK_SECRET, POLAR_SUCCESS_URL.
//
// The webhook stays mounted while billing is off, so subscriptions Polar cancels still move their
// workspaces back to the free plan.
package polar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// App is the metadata tag on everything Mahaam creates in Polar.
const App = "mahaam"

// Client is a minimal Polar API client (stdlib HTTP).
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// ErrNotConfigured is returned when POLAR_ACCESS_TOKEN is not set.
var ErrNotConfigured = errors.New("Polar billing is not configured (POLAR_ACCESS_TOKEN)")

// ErrDisabled is returned while billing is switched off (POLAR_BILLING_ENABLED is not "true").
var ErrDisabled = errors.New("billing unavailable")

// Enabled reports whether Polar billing is switched on. It is off unless POLAR_BILLING_ENABLED is
// "true" (or "1"), so a deploy without the variable cannot open a checkout.
func Enabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("POLAR_BILLING_ENABLED"))) {
	case "true", "1", "yes", "on":
		return true
	}
	return false
}

// FromEnv builds a client from POLAR_ACCESS_TOKEN / POLAR_API_URL. It returns ErrDisabled while
// billing is switched off.
func FromEnv() (*Client, error) {
	if !Enabled() {
		return nil, ErrDisabled
	}
	tok := strings.TrimSpace(os.Getenv("POLAR_ACCESS_TOKEN"))
	if tok == "" {
		return nil, ErrNotConfigured
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("POLAR_API_URL")), "/")
	if base == "" {
		base = "https://api.polar.sh"
	}
	return &Client{BaseURL: base, Token: tok, HTTP: &http.Client{Timeout: 20 * time.Second}}, nil
}

// APIError is a non-2xx answer from Polar. The token is never part of it.
type APIError struct {
	Status int
	Method string
	Path   string
	Body   string
}

func (e *APIError) Error() string {
	b := e.Body
	if len(b) > 300 {
		b = b[:300] + "…"
	}
	return fmt.Sprintf("polar %s %s: %d %s", e.Method, e.Path, e.Status, b)
}

// Do sends a JSON request and decodes a JSON answer into out (when non-nil).
func (c *Client) Do(ctx context.Context, method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	hc := c.HTTP
	if hc == nil {
		hc = http.DefaultClient
	}
	res, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("polar %s %s: %w", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode/100 != 2 {
		return &APIError{Status: res.StatusCode, Method: method, Path: path, Body: string(raw)}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}
