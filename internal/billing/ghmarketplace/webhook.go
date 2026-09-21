// Package ghmarketplace records GitHub Marketplace purchase events (a listing sold and billed by
// GitHub, distinct from Mahaam's own Polar billing). It is intake-only for now: every verified
// delivery is stored, deduplicated by delivery id, for a human to match to a workspace/plan and
// mark handled — there is no GitHub Marketplace pricing plan wired to Mahaam's plans yet.
package ghmarketplace

import (
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/fadymondy/mahaam/internal/integrations"
)

// WebhookPath is the public endpoint (guard allowlist) — set as the GitHub Marketplace listing's
// webhook URL, with content type application/json. Verified by its own secret,
// GITHUB_MARKETPLACE_WEBHOOK_SECRET, deliberately separate from the App's repo GITHUB_WEBHOOK_SECRET
// since GitHub issues them independently.
const WebhookPath = "/api/integrations/github/marketplace-webhook"

const maxBody = 1 << 20

type purchaseEvent struct {
	Action string `json:"action"`
	Sender struct {
		Login string `json:"login"`
	} `json:"sender"`
	MarketplacePurchase struct {
		Account struct {
			ID    int64  `json:"id"`
			Login string `json:"login"`
			Type  string `json:"type"`
		} `json:"account"`
		BillingCycle string `json:"billing_cycle"`
		UnitCount    int64  `json:"unit_count"`
		OnFreeTrial  bool   `json:"on_free_trial"`
		Plan         struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"plan"`
	} `json:"marketplace_purchase"`
}

func secret() string { return strings.TrimSpace(os.Getenv("GITHUB_MARKETPLACE_WEBHOOK_SECRET")) }

// Handler verifies and records a GitHub Marketplace purchase webhook delivery. sysDB is the owner
// pool (this is platform data, not tenant data).
func Handler(sysDB *sql.DB, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sec := secret()
		if sec == "" {
			http.Error(w, `{"error":"not configured (GITHUB_MARKETPLACE_WEBHOOK_SECRET)"}`, http.StatusServiceUnavailable)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
		if err != nil || len(body) > maxBody {
			http.Error(w, `{"error":"body too large"}`, http.StatusRequestEntityTooLarge)
			return
		}
		if !integrations.VerifyWebhookSignature(sec, body, r.Header.Get("X-Hub-Signature-256")) {
			http.Error(w, `{"error":"invalid signature"}`, http.StatusUnauthorized)
			return
		}
		delivery := r.Header.Get("X-GitHub-Delivery")
		var ev purchaseEvent
		if err := json.Unmarshal(body, &ev); err != nil {
			http.Error(w, `{"error":"malformed payload"}`, http.StatusBadRequest)
			return
		}
		if delivery != "" && sysDB != nil {
			_, err := sysDB.ExecContext(r.Context(), `
				INSERT INTO github_marketplace_events
					(delivery_id, action, account_login, account_id, account_type, sender_login,
					 plan_id, plan_name, unit_count, billing_cycle, on_free_trial, payload)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				ON CONFLICT (delivery_id) DO NOTHING`,
				delivery, ev.Action, ev.MarketplacePurchase.Account.Login, ev.MarketplacePurchase.Account.ID,
				ev.MarketplacePurchase.Account.Type, ev.Sender.Login, ev.MarketplacePurchase.Plan.ID,
				ev.MarketplacePurchase.Plan.Name, ev.MarketplacePurchase.UnitCount, ev.MarketplacePurchase.BillingCycle,
				ev.MarketplacePurchase.OnFreeTrial, string(body))
			if err != nil && log != nil {
				log.Error("github marketplace webhook: store", "err", err, "delivery", delivery)
			}
		}
		if log != nil {
			log.Info("github marketplace webhook", "action", ev.Action, "account", ev.MarketplacePurchase.Account.Login, "plan", ev.MarketplacePurchase.Plan.Name)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
}
