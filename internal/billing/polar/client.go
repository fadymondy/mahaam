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
// Configuration (never hard-coded): POLAR_ACCESS_TOKEN (organization access token),
// POLAR_API_URL (default https://api.polar.sh), POLAR_WEBHOOK_SECRET, POLAR_SUCCESS_URL.
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

// FromEnv builds a client from POLAR_ACCESS_TOKEN / POLAR_API_URL.
func FromEnv() (*Client, error) {
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
