package polar

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/limits"
)

func headers(id string, ts time.Time, sig string) http.Header {
	h := http.Header{}
	h.Set("webhook-id", id)
	h.Set("webhook-timestamp", fmtInt(ts.Unix()))
	h.Set("webhook-signature", sig)
	return h
}


func fmtInt(n int64) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

func TestVerify(t *testing.T) {
	now := time.Now()
	body := []byte(`{"type":"subscription.active"}`)
	for _, secret := range []string{"polar_whs_plain-secret", "whsec_c2VjcmV0LWJ5dGVz"} {
		sig := Sign(secret, "msg_1", now, body)
		if err := Verify(secret, headers("msg_1", now, sig), body, now); err != nil {
			t.Errorf("%s: a valid signature is refused: %v", secret, err)
		}
		// Several signatures (key rotation): any v1 match passes.
		if err := Verify(secret, headers("msg_1", now, "v1,bm9wZQ== "+sig), body, now); err != nil {
			t.Errorf("rotated signatures: %v", err)
		}
		if err := Verify(secret, headers("msg_1", now, sig), []byte(`{"type":"tampered"}`), now); err != ErrBadSignature {
			t.Errorf("tampered body: %v", err)
		}
		if err := Verify("other", headers("msg_1", now, sig), body, now); err != ErrBadSignature {
			t.Errorf("wrong secret: %v", err)
		}
		old := now.Add(-6 * time.Minute)
		if err := Verify(secret, headers("msg_1", old, Sign(secret, "msg_1", old, body)), body, now); err != ErrStale {
			t.Errorf("replayed old delivery: %v", err)
		}
	}
	if err := Verify("", headers("msg_1", now, "v1,x"), body, now); err != ErrBadSignature {
		t.Errorf("no secret configured must refuse: %v", err)
	}
}

func TestProductBody(t *testing.T) {
	l := int64(10)
	p := limits.Plan{Key: "pro", NameEn: "Pro", Currency: "USD", BaseFeeMinor: 2900, Active: true, Limits: map[string]limits.Rule{
		"projects":   {Limit: &l, Policy: limits.Overage, UnitPriceMinor: 200, UnitSize: 1},
		"teams":      {Limit: &l, Policy: limits.Block},
		"storage_mb": {Limit: &l, Policy: limits.Overage, UnitPriceMinor: 0},
	}}
	if !Paid(p) || Paid(limits.Plan{Active: true}) {
		t.Error("Paid")
	}
	b := productBody(p, map[string]string{"projects": "m1"})
	prices := b["prices"].([]map[string]any)
	if b["name"] != "Mahaam Pro" || len(prices) != 2 || prices[0]["price_amount"] != int64(2900) || prices[1]["meter_id"] != "m1" {
		t.Errorf("product body: %v", b)
	}
	if md := b["metadata"].(map[string]any); md["app"] != "mahaam" || md["plan"] != "pro" {
		t.Errorf("metadata: %v", md)
	}
	if got := MeteredKeys([]limits.Plan{p}); len(got) != 1 || got[0] != "projects" {
		t.Errorf("metered keys: %v", got)
	}
}

// Polar closed the organization: billing stays off unless POLAR_BILLING_ENABLED is explicitly "true".
func TestBillingSwitch(t *testing.T) {
	t.Setenv("POLAR_ACCESS_TOKEN", "test-polar-token")
	for _, v := range []string{"", "false", "0", "no"} {
		t.Setenv("POLAR_BILLING_ENABLED", v)
		if Enabled() {
			t.Errorf("POLAR_BILLING_ENABLED=%q must be off", v)
		}
		if c, err := FromEnv(); c != nil || !errors.Is(err, ErrDisabled) {
			t.Errorf("POLAR_BILLING_ENABLED=%q: want ErrDisabled, got %v %v", v, c, err)
		}
	}
	for _, v := range []string{"true", "TRUE", "1"} {
		t.Setenv("POLAR_BILLING_ENABLED", v)
		if c, err := FromEnv(); err != nil || c == nil {
			t.Errorf("POLAR_BILLING_ENABLED=%q: want a client, got %v", v, err)
		}
	}
}
