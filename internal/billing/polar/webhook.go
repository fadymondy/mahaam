package polar

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/platform"
)

// WebhookPath is the public webhook endpoint (an exact path on the guard's public allowlist).
const WebhookPath = "/api/billing/polar/webhook"

// MaxSkew is how far a webhook-timestamp may be from now.
const MaxSkew = 5 * time.Minute

var (
	ErrBadSignature = errors.New("invalid webhook signature")
	ErrStale        = errors.New("webhook timestamp outside the allowed window")
)

// signingKey follows Standard Webhooks: a "whsec_" secret is base64 after the prefix; Polar's own
// secrets are used as their raw bytes (its SDK base64-encodes them before verifying).
func signingKey(secret string) []byte {
	secret = strings.TrimSpace(secret)
	if strings.HasPrefix(secret, "whsec_") {
		if k, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_")); err == nil {
			return k
		}
	}
	return []byte(secret)
}

// Sign returns the webhook-signature header value for a delivery (used by the tests and by any
// tool that replays a delivery).
func Sign(secret, id string, ts time.Time, body []byte) string {
	mac := hmac.New(sha256.New, signingKey(secret))
	mac.Write([]byte(id + "." + strconv.FormatInt(ts.Unix(), 10) + "." + string(body)))
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// Verify checks a Standard Webhooks delivery: the HMAC-SHA256 of "id.timestamp.body" against any
// v1 signature in the header, and the timestamp within MaxSkew of now.
func Verify(secret string, h http.Header, body []byte, now time.Time) error {
	id, tsRaw, sigs := h.Get("webhook-id"), h.Get("webhook-timestamp"), h.Get("webhook-signature")
	if secret == "" || id == "" || tsRaw == "" || sigs == "" {
		return ErrBadSignature
	}
	ts, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		return ErrBadSignature
	}
	if d := now.Sub(time.Unix(ts, 0)); d > MaxSkew || d < -MaxSkew {
		return ErrStale
	}
	want := Sign(secret, id, time.Unix(ts, 0), body)
	for _, s := range strings.Fields(sigs) {
		if strings.HasPrefix(s, "v1,") && hmac.Equal([]byte(s), []byte(want)) {
			return nil
		}
	}
	return ErrBadSignature
}

type subscription struct {
	ID                string         `json:"id"`
	Status            string         `json:"status"`
	CurrentPeriodEnd  *time.Time     `json:"current_period_end"`
	CancelAtPeriodEnd bool           `json:"cancel_at_period_end"`
	CustomerID        string         `json:"customer_id"`
	ProductID         string         `json:"product_id"`
	SubscriptionID    string         `json:"subscription_id"` // on an order
	Metadata          map[string]any `json:"metadata"`
	Customer          struct {
		ID         string `json:"id"`
		ExternalID string `json:"external_id"`
	} `json:"customer"`
}

type delivery struct {
	Type string       `json:"type"`
	Data subscription `json:"data"`
}

// Outcome is what a delivery did.
type Outcome struct {
	Duplicate   bool   `json:"duplicate"`
	Ignored     string `json:"ignored,omitempty"`
	WorkspaceID string `json:"workspace_id,omitempty"`
	Plan        string `json:"plan,omitempty"`
	Status      string `json:"billing_status,omitempty"`
}

// Apply records delivery id and applies it to its workspace, in one transaction. A delivery seen
// before is a no-op.
func Apply(ctx context.Context, db *sql.DB, id string, body []byte) (*Outcome, error) {
	var d delivery
	if err := json.Unmarshal(body, &d); err != nil {
		return nil, err
	}
	out := &Outcome{}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck

	s := d.Data
	ws := firstString(s.Metadata["workspace_id"], s.Customer.ExternalID)
	res, err := tx.ExecContext(ctx, `INSERT INTO polar_webhook_events (id, type, workspace_id) VALUES ($1, $2, NULLIF($3, '')) ON CONFLICT (id) DO NOTHING`, id, d.Type, ws)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		out.Duplicate = true
		return out, tx.Commit()
	}

	plan := firstString(s.Metadata["plan"])
	if plan == "" && s.ProductID != "" {
		_ = tx.QueryRowContext(ctx, `SELECT key FROM plans WHERE polar_product_id = $1`, s.ProductID).Scan(&plan)
	}
	var exists bool
	if ws != "" {
		_ = tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = $1)`, ws).Scan(&exists)
	}
	switch {
	case !strings.HasPrefix(d.Type, "subscription.") && d.Type != "order.paid":
		out.Ignored = "event type " + d.Type
	case !exists:
		out.Ignored = "not a Mahaam workspace"
	case plan == "" && firstString(s.Metadata["app"]) != App && d.Type != "order.paid":
		out.Ignored = "not a Mahaam product"
	}
	if out.Ignored != "" {
		return out, tx.Commit()
	}
	out.WorkspaceID = ws
	subID := firstString(s.ID)
	if d.Type == "order.paid" {
		subID = s.SubscriptionID
	}

	status, setPlan := "", ""
	switch {
	case d.Type == "order.paid":
		status = "active"
	case d.Type == "subscription.revoked" || s.Status == "unpaid" || s.Status == "incomplete_expired":
		status, setPlan = "revoked", "free" // access ends now
	case d.Type == "subscription.canceled" || s.Status == "canceled" || s.CancelAtPeriodEnd:
		status = "canceled" // keeps the plan until the period ends (ExpireCanceled)
	case s.Status == "past_due":
		status = "past_due"
	case s.Status == "active" || s.Status == "trialing":
		status, setPlan = "active", plan
	default:
		status = s.Status
	}
	cancel := status == "canceled"
	if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET
			billing_status = $2,
			plan = COALESCE(NULLIF($3, ''), plan),
			billing_period_end = COALESCE($4, billing_period_end),
			billing_cancel_at_period_end = $5,
			polar_customer_id = COALESCE(NULLIF($6, ''), polar_customer_id),
			polar_subscription_id = COALESCE(NULLIF($7, ''), polar_subscription_id),
			billing_updated_at = now(), updated_at = now()
		WHERE id = $1`, ws, status, setPlan, s.CurrentPeriodEnd, cancel, firstString(s.CustomerID, s.Customer.ID), subID); err != nil {
		return nil, err
	}
	if err := platform.Audit(ctx, tx, platform.Entry{ActorID: "polar", ActorEmail: "polar webhook", Action: "billing." + d.Type,
		TargetType: "workspace", TargetID: ws, Changes: map[string]any{"status": status, "plan": setPlan, "subscription": subID}, Via: "webhook"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	limits.Invalidate(ws)
	out.Plan, out.Status = setPlan, status
	return out, nil
}

// ExpireCanceled moves workspaces whose canceled subscription has reached its period end to the
// free plan. Run by the billing job.
func ExpireCanceled(ctx context.Context, db *sql.DB, now time.Time) (int, error) {
	res, err := db.ExecContext(ctx, `UPDATE workspaces SET plan = 'free', billing_status = 'expired', billing_cancel_at_period_end = false,
			billing_updated_at = now(), updated_at = now()
		WHERE billing_status = 'canceled' AND billing_period_end IS NOT NULL AND billing_period_end <= $1 AND plan <> 'free'`, now)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		limits.Invalidate("")
	}
	return int(n), nil
}

func firstString(vs ...any) string {
	for _, v := range vs {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// WebhookHandler verifies and applies deliveries. PUBLIC (the signature is the authentication).
func WebhookHandler(db *sql.DB, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "use POST", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		secret := os.Getenv("POLAR_WEBHOOK_SECRET")
		if err := Verify(secret, r.Header, body, time.Now()); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		out, err := Apply(r.Context(), db, r.Header.Get("webhook-id"), body)
		if err != nil {
			if log != nil {
				log.Error("polar webhook", "err", err)
			}
			http.Error(w, "could not apply the webhook", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
}
