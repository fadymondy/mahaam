package limits

import (
	"context"
	"sync"
	"time"
)

/*
The API meter: every workspace-tier REST call and every user MCP call is counted per workspace.

  - api_rate_per_minute: a fixed one-minute window per workspace, in memory (per process), always
    a hard cap → 429.
  - api_calls_per_month: counted in memory and flushed to workspace_usage.api_calls every minute
    (one UPSERT per active workspace, not one per call). A block policy refuses once the flushed
    count + what is pending reaches the limit → 402; an overage policy lets the call through.

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

// CountCall meters one API call for ws, refusing it when the plan's rate or a block-policy
// monthly quota is exhausted.
func CountCall(ctx context.Context, ws string) error {
	e, err := For(ctx, ws)
	if err != nil || e == nil {
		return err
	}
	rate, month := e.Rule(APIRateMinute), e.Rule(APICallsMonth)

	// The flushed base is read outside the lock (a DB round trip), once per workspace per month.
	needBase := false
	if month.Limit != nil && month.Policy == Block {
		meter.mu.Lock()
		meter.roll()
		_, have := meter.base[ws]
		meter.mu.Unlock()
		needBase = !have
	}
	if needBase {
		var n int64
		if db := pool(); db != nil {
			_ = db.QueryRowContext(ctx, `SELECT COALESCE((SELECT api_calls FROM workspace_usage WHERE workspace_id = $1 AND period = $2), 0)`,
				ws, PeriodOf(now())).Scan(&n)
		}
		meter.mu.Lock()
		if _, have := meter.base[ws]; !have {
			meter.base[ws] = n
		}
		meter.mu.Unlock()
	}

	meter.mu.Lock()
	defer meter.mu.Unlock()
	meter.roll()
	if rate.Limit != nil && int64(meter.perMin[ws]) >= *rate.Limit {
		return limitError(e, APIRateMinute, *rate.Limit)
	}
	if month.Limit != nil && month.Policy == Block && meter.base[ws]+meter.pending[ws] >= *month.Limit {
		return limitError(e, APICallsMonth, *month.Limit)
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
