package limits

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func i64(n int64) *int64 { return &n }

func freePlan() Plan {
	return Plan{Key: "free", NameEn: "Free", Currency: "USD", Limits: map[string]Rule{
		Projects:      {Limit: i64(2), Policy: Block},
		Members:       {Limit: i64(3), Policy: Overage, UnitPriceMinor: 800},
		StorageMB:     {Limit: i64(100), Policy: Overage, UnitPriceMinor: 100},
		IssuesMonth:   {Limit: i64(50), Policy: Overage, UnitPriceMinor: 500},
		APIRateMinute: {Limit: i64(3), Policy: Overage}, // a rate is always a hard cap
		APICallsMonth: {Limit: i64(5), Policy: Block},
	}, Features: Features{Integrations: []string{"github", "nope"}}}
}

func TestMergeAndNormalize(t *testing.T) {
	e, err := Merge(freePlan(), Overrides{
		Limits:   map[string]Rule{Projects: {Limit: i64(10)}},
		Features: map[string]json.RawMessage{"vault": json.RawMessage(`true`), "integrations": json.RawMessage(`["jira","github","bogus"]`)},
	})
	if err != nil {
		t.Fatal(err)
	}
	if r := e.Rule(Projects); *r.Limit != 10 || r.Policy != Block || !e.Overridden[Projects] {
		t.Errorf("override must replace the plan rule: %+v", r)
	}
	if r := e.Rule(Clients); r.Limit != nil || r.UnitSize != 1 {
		t.Errorf("an unset key is unlimited: %+v", r)
	}
	if r := e.Rule(StorageMB); r.UnitSize != 1024 {
		t.Errorf("storage bills per GB by default: %+v", r)
	}
	if r := e.Rule(APIRateMinute); r.Policy != Block {
		t.Errorf("the rate is always block: %+v", r)
	}
	if !e.Features.Vault || e.Features.KPI {
		t.Errorf("features merge key by key: %+v", e.Features)
	}
	if strings.Join(e.Features.Integrations, ",") != "github,jira" {
		t.Errorf("integrations are validated and sorted: %v", e.Features.Integrations)
	}
	if !e.Features.Has("jira") || e.Features.Has("linear") {
		t.Errorf("Has on integrations: %+v", e.Features)
	}
}

func TestRuleMath(t *testing.T) {
	block := Rule{Limit: i64(2), Policy: Block, UnitSize: 1}
	if !block.Allows(1, 1) || block.Allows(2, 1) {
		t.Error("block: 2 of 2 allowed, a 3rd refused")
	}
	if (Rule{Policy: Block}).Allows(1e9, 1) != true {
		t.Error("nil limit is unlimited")
	}
	over := Rule{Limit: i64(100), Policy: Overage, UnitSize: 1024, UnitPriceMinor: 100}
	if !over.Allows(5000, 1) {
		t.Error("overage always allows")
	}
	if got := over.OverageMinor(100); got != 0 {
		t.Errorf("at the limit nothing is billed: %d", got)
	}
	if got := over.OverageMinor(101); got != 100 {
		t.Errorf("one MB over bills one whole unit: %d", got)
	}
	if got := over.OverageMinor(100 + 1024 + 1); got != 200 {
		t.Errorf("1025 MB over bills two units: %d", got)
	}
	if got := block.OverageMinor(10); got != 0 {
		t.Errorf("block never bills: %d", got)
	}
}

func TestPeriodRollsOverByMonth(t *testing.T) {
	a := PeriodOf(time.Date(2026, 9, 30, 23, 59, 0, 0, time.UTC))
	b := PeriodOf(time.Date(2026, 10, 1, 0, 0, 1, 0, time.UTC))
	if a.Format("2006-01-02") != "2026-09-01" || b.Format("2006-01-02") != "2026-10-01" {
		t.Errorf("periods: %s %s", a, b)
	}
	// Cairo just after local midnight on Oct 1 is still September in UTC: periods are UTC.
	cairo, _ := time.LoadLocation("Africa/Cairo")
	if cairo != nil {
		if p := PeriodOf(time.Date(2026, 10, 1, 1, 0, 0, 0, cairo)); p.Month() != time.September {
			t.Errorf("periods are UTC months: %s", p)
		}
	}
}

func TestMessages(t *testing.T) {
	e, _ := Merge(freePlan(), Overrides{})
	x := limitError(e, Projects, 2)
	if x.Status != http.StatusPaymentRequired || x.Msg != "Your plan (Free) allows 2 projects — upgrade in Settings → Plan" {
		t.Errorf("message: %d %q", x.Status, x.Msg)
	}
	if x := limitError(e, APIRateMinute, 60); x.Status != http.StatusTooManyRequests {
		t.Errorf("rate is 429: %d", x.Status)
	}
	if f := featureError(e, FeaturePortal); !strings.Contains(f.Msg, "customer portal") || f.Code != "plan_feature" {
		t.Errorf("feature message: %q", f.Msg)
	}
	if _, ok := As(error(x)); !ok {
		t.Error("As finds a refusal")
	}
	if err := ValidateRules(map[string]Rule{"bogus": {}}); err == nil {
		t.Error("unknown keys are refused")
	}
	if err := ValidateRules(map[string]Rule{Projects: {Policy: "maybe"}}); err == nil {
		t.Error("unknown policies are refused")
	}
}

// The meter, with the plan served from the cache (no database): only the abuse rate refuses (a
// new minute resets it); there is no monthly quota, whatever the plan says.
func TestMeter(t *testing.T) {
	resetMeter()
	defer resetMeter()
	clock := time.Date(2026, 9, 19, 10, 0, 0, 0, time.UTC)
	now = func() time.Time { return clock }
	defer func() { now = time.Now }()

	e, _ := Merge(freePlan(), Overrides{})
	mu.Lock()
	cache["ws1"] = cached{e: e, at: clock}
	mu.Unlock()
	defer Invalidate("")
	ctx := context.Background()

	for i := 0; i < AbuseRatePerMinute; i++ {
		if err := CountCall(ctx, "ws1"); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if x, ok := As(CountCall(ctx, "ws1")); !ok || x.Status != http.StatusTooManyRequests {
		t.Fatalf("one call over the abuse rate must be refused: %v", x)
	}
	clock = clock.Add(time.Minute)
	mu.Lock()
	cache["ws1"] = cached{e: e, at: clock}
	mu.Unlock()
	if err := CountCall(ctx, "ws1"); err != nil {
		t.Fatalf("a new minute resets the rate (and there is no monthly quota): %v", err)
	}
	if pendingCalls("ws1") != AbuseRatePerMinute+1 {
		t.Errorf("refused calls are not counted: %d", pendingCalls("ws1"))
	}
	// The plan's checks never refuse.
	if err := Check(ctx, "ws1", Projects, 1000); err != nil {
		t.Errorf("Check: %v", err)
	}
	if err := Feature(ctx, "ws1", FeatureVault); err != nil {
		t.Errorf("Feature: %v", err)
	}
}
