package polar

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/fadymondy/mahaam/internal/limits"
)

// usageEvent is one event for /v1/events/ingest.
type usageEvent struct {
	Name               string         `json:"name"`
	ExternalCustomerID string         `json:"external_customer_id"`
	ExternalID         string         `json:"external_id"`
	Timestamp          time.Time      `json:"timestamp"`
	Metadata           map[string]any `json:"metadata"`
}

type pending struct {
	ws, key string
	period  time.Time
	total   int64
}

// PushUsage sends every subscribed workspace's overage, in billing units (whole unit_size blocks
// over the limit), for this month and last month, as deltas against what was already sent. The
// event's external_id is derived from the cumulative total, so a batch retried after a crash is
// deduplicated by Polar; what was sent is recorded only after Polar accepted it.
func PushUsage(ctx context.Context, db *sql.DB, c *Client, now time.Time) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id FROM workspaces
		WHERE polar_subscription_id IS NOT NULL AND billing_status IN ('active', 'past_due', 'canceled')`)
	if err != nil {
		return 0, err
	}
	var wss []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		wss = append(wss, id)
	}
	rows.Close()

	var events []usageEvent
	var todo []pending
	periods := []time.Time{limits.PeriodOf(now).AddDate(0, -1, 0), limits.PeriodOf(now)}
	for _, ws := range wss {
		for _, period := range periods {
			r, err := limits.BuildReport(ctx, db, ws, period)
			if err != nil {
				return 0, err
			}
			for _, it := range r.Items {
				if it.Policy != limits.Overage || it.UnitPriceMinor == 0 || it.Over == 0 {
					continue
				}
				size := it.UnitSize
				if size <= 0 {
					size = 1
				}
				units := (it.Over + size - 1) / size
				var sent int64
				_ = db.QueryRowContext(ctx, `SELECT units_sent FROM polar_usage_sent WHERE workspace_id = $1 AND period = $2 AND limit_key = $3`,
					ws, period, it.Key).Scan(&sent)
				if units <= sent {
					continue
				}
				p := period.Format("2006-01")
				events = append(events, usageEvent{
					Name: UsageEvent, ExternalCustomerID: ws, Timestamp: now.UTC(),
					ExternalID: fmt.Sprintf("mahaam:%s:%s:%s:%d", ws, p, it.Key, units),
					Metadata:   map[string]any{"app": App, "key": it.Key, "units": units - sent, "period": p},
				})
				todo = append(todo, pending{ws: ws, key: it.Key, period: period, total: units})
			}
		}
	}
	if len(events) == 0 {
		return 0, nil
	}
	for start := 0; start < len(events); start += 100 {
		end := min(start+100, len(events))
		if err := c.Do(ctx, http.MethodPost, "/v1/events/ingest", map[string]any{"events": events[start:end]}, nil); err != nil {
			return start, err
		}
		for _, p := range todo[start:end] {
			if _, err := db.ExecContext(ctx, `INSERT INTO polar_usage_sent (workspace_id, period, limit_key, units_sent) VALUES ($1, $2, $3, $4)
				ON CONFLICT (workspace_id, period, limit_key) DO UPDATE SET units_sent = GREATEST(polar_usage_sent.units_sent, $4), updated_at = now()`,
				p.ws, p.period, p.key, p.total); err != nil {
				return end, err
			}
		}
	}
	return len(events), nil
}
