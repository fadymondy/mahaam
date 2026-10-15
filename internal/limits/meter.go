package limits

import (
	"context"
	"sync"
	"time"
)

/*
The API meter: every workspace-tier REST call and every user MCP call is counted per workspace.

  - api_rate_per_minute: a fixed one-minute window per workspace, in memory (per process), always
    a hard cap → 429. It is abuse protection, the same for everyone (AbuseRatePerMinute), not a
    plan.
  - api_calls_per_month: counted in memory and flushed to workspace_usage.api_calls every minute
    (one UPSERT per active workspace, not one per call) for reports only. It never refuses: Mahaam
    is free and open source, so the per-minute rate (abuse protection) is the only cap.

A refused call is not counted.
*/

type meterState struct {
	mu      sync.Mutex
	minute  int64            // unix minute of the rate window
	perMin  map[string]int   // calls this minute
	pending map[string]int64 // calls not yet flushed
	period  time.Time        // month of base
	base    map[string]int64 // flushed api_calls this month (lazily loaded)
}

var meter = &meterState{perMin: map[string]int{}, pending: map[string]int64{}, base: map[string]int64{}}

var flusherOnce sync.Once

func startFlusher(ctx context.Context) {
	flusherOnce.Do(func() {
		go func() {
			t := time.NewTicker(time.Minute)
			defer t.Stop()
			for range t.C {
				Flush(context.Background())
			}
		}()
	})
	_ = ctx
}

func (m *meterState) roll() {
	min := now().Unix() / 60
	if min != m.minute {
		m.minute, m.perMin = min, map[string]int{}
	}
	if p := PeriodOf(now()); !p.Equal(m.period) {
		m.period, m.base = p, map[string]int64{}
	}
}

func meterMinute(ws string) int {
	meter.mu.Lock()
	defer meter.mu.Unlock()
	meter.roll()
	return meter.perMin[ws]
}

func pendingCalls(ws string) int64 {
	meter.mu.Lock()
	defer meter.mu.Unlock()
	return meter.pending[ws]
}

// AbuseRatePerMinute is the one API-call cap left: per workspace, per minute, the same for every
// workspace. It is high enough that no person or agent working normally ever meets it.
const AbuseRatePerMinute = 600

// CountCall counts one API call for ws, refusing it only when the per-minute rate (abuse
// protection) is exhausted. There is no monthly quota.
func CountCall(ctx context.Context, ws string) error {
	e, err := For(ctx, ws)
	if err != nil || e == nil {
		return err
	}
	meter.mu.Lock()
	defer meter.mu.Unlock()
	meter.roll()
	if meter.perMin[ws] >= AbuseRatePerMinute {
		return limitError(e, APIRateMinute, AbuseRatePerMinute)
	}
	meter.perMin[ws]++
	meter.pending[ws]++
	return nil
}

// Flush writes the pending API-call counts to workspace_usage. Called every minute; tests and the
// usage report may call it directly.
func Flush(ctx context.Context) {
	db := pool()
	if db == nil {
		return
	}
	meter.mu.Lock()
	meter.roll()
	pending := meter.pending
	meter.pending = map[string]int64{}
	period := meter.period
	meter.mu.Unlock()

	for ws, n := range pending {
		if n == 0 {
			continue
		}
		_, err := db.ExecContext(ctx, `
			INSERT INTO workspace_usage AS u (workspace_id, period, api_calls) VALUES ($1, $2, $3)
			ON CONFLICT (workspace_id, period) DO UPDATE SET api_calls = u.api_calls + EXCLUDED.api_calls, updated_at = now()`,
			ws, period, n)
		meter.mu.Lock()
		if err != nil {
			meter.pending[ws] += n // retry next minute
		} else if b, have := meter.base[ws]; have && meter.period.Equal(period) {
			meter.base[ws] = b + n
		}
		meter.mu.Unlock()
		if err != nil && logger != nil {
			logger.Warn("limits: api calls not flushed", "workspace", ws, "err", err)
		}
	}
}

// resetMeter clears in-memory state (tests).
func resetMeter() {
	meter.mu.Lock()
	defer meter.mu.Unlock()
	meter.minute, meter.perMin, meter.pending, meter.period, meter.base = 0, map[string]int{}, map[string]int64{}, time.Time{}, map[string]int64{}
}
