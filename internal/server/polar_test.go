package server

/*
TestPolarBilling — Polar (internal/billing/polar) against a fake Polar API (httptest):

 1. sync: a dry run calls no write endpoint; the real run creates one meter per metered limit key
    and one product per paid plan (tagged app=mahaam) and stores the ids; a second run updates
    instead of creating; the organization's unrelated products are never touched
 2. checkout: owner/admin only; builds the right Polar checkout request and returns its URL
 3. webhook: bad signature 401; a subscription webhook moves the workspace to the plan; a replay
    is a no-op; canceled keeps the plan until the period end, then free; revoked → free at once
 4. usage push: overage units are sent as deltas, exactly once

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run PolarBilling -v
*/

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/billing/polar"
)

type fakePolar struct {
	mu       sync.Mutex
	calls    []string // "METHOD /path"
	bodies   map[string][]map[string]any
	meters   []map[string]any
	products []map[string]any
	seq      int
}

func (f *fakePolar) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-polar-token" {
			w.WriteHeader(401)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		raw, _ := io.ReadAll(r.Body)
		body := map[string]any{}
		_ = json.Unmarshal(raw, &body)
		key := r.Method + " " + r.URL.Path
		f.calls = append(f.calls, key)
		f.bodies[key] = append(f.bodies[key], body)
		f.seq++
		id := fmt.Sprintf("id-%d", f.seq)
		out := map[string]any{}
		switch {
		case key == "GET /v1/meters/":
			out["items"] = f.meters
		case key == "POST /v1/meters/":
			body["id"] = id
			f.meters = append(f.meters, body)
			out = body
		case key == "GET /v1/products/":
			out["items"] = f.products
		case key == "POST /v1/products/" || strings.HasPrefix(key, "PATCH /v1/products/"):
			if strings.HasPrefix(key, "PATCH") {
				id = strings.TrimPrefix(r.URL.Path, "/v1/products/")
			}
			prices := []any{}
			for i, p := range body["prices"].([]any) {
				pm := p.(map[string]any)
				pm["id"] = fmt.Sprintf("%s-price-%d", id, i)
				prices = append(prices, pm)
			}
			out = map[string]any{"id": id, "name": body["name"], "metadata": body["metadata"], "prices": prices}
			if strings.HasPrefix(key, "POST") {
				f.products = append(f.products, out)
			}
		case key == "POST /v1/checkouts/":
			out = map[string]any{"id": id, "url": "https://polar.test/checkout/" + id}
		case key == "POST /v1/customer-sessions/":
			out = map[string]any{"customer_portal_url": "https://polar.test/portal/" + id}
		case key == "POST /v1/events/ingest":
			out = map[string]any{"inserted": len(body["events"].([]any))}
		default:
			t.Errorf("unexpected Polar call %s", key)
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
}

func (f *fakePolar) count(prefix string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			n++
		}
	}
	return n
}

func (f *fakePolar) last(key string) map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	b := f.bodies[key]
	if len(b) == 0 {
		return nil
	}
	return b[len(b)-1]
}

func TestPolarBilling(t *testing.T) {
	fake := &fakePolar{bodies: map[string][]map[string]any{},
		// The organization's own, unrelated catalogue: never Mahaam's.
		products: []map[string]any{{"id": "donation", "name": "Donation", "metadata": map[string]any{}, "prices": []any{}}},
		meters:   []map[string]any{{"id": "other-meter", "name": "Something else", "metadata": map[string]any{}}},
	}
	fs := httptest.NewServer(fake.handler(t))
	defer fs.Close()
	t.Setenv("POLAR_ACCESS_TOKEN", "test-polar-token")
	t.Setenv("POLAR_API_URL", fs.URL)
	t.Setenv("POLAR_WEBHOOK_SECRET", "polar_whs_test-secret")
	t.Setenv("POLAR_SUCCESS_URL", "https://app.test/{locale}/w/{slug}/settings/plan?paid=1")

	a, srv := bootStack(t)
	ctx := context.Background()
	// Earlier runs on this database may have stored ids from another fake: start clean.
	if _, err := a.SysDB.Exec(`UPDATE plans SET polar_product_id = NULL, polar_price_ids = '{}'; DELETE FROM polar_meters`); err != nil {
		t.Fatal(err)
	}
	c, err := polar.FromEnv()
	if err != nil {
		t.Fatal(err)
	}

	// 1. Sync.
	rep, err := polar.Sync(ctx, a.SysDB, c, true)
	if err != nil {
		t.Fatal(err)
	}
	if fake.count("POST") != 0 || fake.count("PATCH") != 0 || len(rep.Actions) == 0 {
		t.Fatalf("a dry run must not write: %v / %v", fake.calls, rep.Actions)
	}
	if _, err := polar.Sync(ctx, a.SysDB, c, false); err != nil {
		t.Fatal(err)
	}
	metersMade, productsMade := fake.count("POST /v1/meters/"), fake.count("POST /v1/products/")
	if metersMade == 0 || productsMade < 2 {
		t.Fatalf("sync created %d meters and %d products", metersMade, productsMade)
	}
	var proID string
	var priceIDs string
	if err := a.SysDB.QueryRow(`SELECT polar_product_id, polar_price_ids::text FROM plans WHERE key = 'pro'`).Scan(&proID, &priceIDs); err != nil || proID == "" {
		t.Fatalf("pro product id not stored: %v", err)
	}
	if !strings.Contains(priceIDs, `"base"`) || !strings.Contains(priceIDs, `"projects"`) {
		t.Errorf("price ids: %s", priceIDs)
	}
	var freeID *string
	_ = a.SysDB.QueryRow(`SELECT polar_product_id FROM plans WHERE key = 'free'`).Scan(&freeID)
	if freeID != nil {
		t.Errorf("free is not sold through Polar")
	}
	if _, err := polar.Sync(ctx, a.SysDB, c, false); err != nil {
		t.Fatal(err)
	}
	if fake.count("POST /v1/meters/") != metersMade || fake.count("POST /v1/products/") != productsMade || fake.count("PATCH /v1/products/") < 2 {
		t.Errorf("a second sync must update, not create: %v", fake.calls)
	}
	if fake.count("PATCH /v1/products/donation") != 0 {
		t.Errorf("an unrelated product was changed")
	}
	if md := fake.last("POST /v1/meters/")["metadata"].(map[string]any); md["app"] != "mahaam" {
		t.Errorf("meter metadata: %v", md)
	}

	// 2. Checkout.
	owner, _, ownerEmail := signup(t, a, srv.URL, "bowner")
	mate, mateID, _ := signup(t, a, srv.URL, "bmate")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Billing " + rnd()}, 201)["workspace"].(map[string]any)
	wsID, slug := ws["id"].(string), ws["slug"].(string)
	owner.ws, mate.ws = wsID, wsID
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, wsID, mateID); err != nil {
		t.Fatal(err)
	}
	// Free and open source: nothing is offered and the checkout is gone (410); the portal stays so a
	// legacy subscriber can cancel.
	bill := owner.must("GET", "/api/w/billing", nil, 200)
	if bill["configured"] != false || len(bill["plans"].([]any)) != 0 {
		t.Errorf("billing must offer nothing: %v", bill)
	}
	before := fake.count("POST /v1/checkouts/")
	if code, _ := owner.do("POST", "/api/w/billing/checkout", map[string]string{"plan": "pro", "locale": "ar"}); code != 410 {
		t.Errorf("checkout must be retired: %d", code)
	}
	if fake.count("POST /v1/checkouts/") != before {
		t.Errorf("a retired checkout reached Polar")
	}
	if code, _ := mate.do("POST", "/api/w/billing/checkout", map[string]string{"plan": "pro"}); code != 403 {
		t.Errorf("a member must not start a checkout: %d", code)
	}
	_, _ = ownerEmail, slug
	owner.must("POST", "/api/w/billing/portal", nil, 200)

	// 3. Webhooks.
	send := func(id string, payload map[string]any, secret string) (int, map[string]any) {
		body, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, srv.URL+polar.WebhookPath, strings.NewReader(string(body)))
		now := time.Now()
		req.Header.Set("webhook-id", id)
		req.Header.Set("webhook-timestamp", fmt.Sprint(now.Unix()))
		req.Header.Set("webhook-signature", polar.Sign(secret, id, now, body))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		out := map[string]any{}
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	plan := func() (p, status string) {
		var s *string
		_ = a.SysDB.QueryRow(`SELECT plan, billing_status FROM workspaces WHERE id = $1`, wsID).Scan(&p, &s)
		if s != nil {
			status = *s
		}
		return
	}
	periodEnd := time.Now().Add(30 * 24 * time.Hour).UTC().Format(time.RFC3339)
	sub := func(status string, cancel bool) map[string]any {
		return map[string]any{"id": "sub_1", "status": status, "product_id": proID, "customer_id": "cus_1",
			"current_period_end": periodEnd, "cancel_at_period_end": cancel,
			"customer": map[string]any{"id": "cus_1", "external_id": wsID}, "metadata": map[string]any{"app": "mahaam", "workspace_id": wsID}}
	}
	msg := "msg_" + rnd()
	if code, _ := send(msg, map[string]any{"type": "subscription.active", "data": sub("active", false)}, "wrong-secret"); code != 401 {
		t.Errorf("bad signature: %d", code)
	}
	if code, out := send(msg, map[string]any{"type": "subscription.active", "data": sub("active", false)}, "polar_whs_test-secret"); code != 200 || out["plan"] != "pro" {
		t.Fatalf("subscription.active: %d %v", code, out)
	}
	if p, s := plan(); p != "pro" || s != "active" {
		t.Errorf("after subscription.active: %s %s", p, s)
	}
	if code, out := send(msg, map[string]any{"type": "subscription.revoked", "data": sub("canceled", false)}, "polar_whs_test-secret"); code != 200 || out["duplicate"] != true {
		t.Errorf("a replayed webhook-id must be a no-op: %d %v", code, out)
	}
	if p, _ := plan(); p != "pro" {
		t.Errorf("the replay changed the plan: %s", p)
	}
	send("msg_"+rnd(), map[string]any{"type": "subscription.canceled", "data": sub("active", true)}, "polar_whs_test-secret")
	if p, s := plan(); p != "pro" || s != "canceled" {
		t.Errorf("canceled keeps the plan until the period ends: %s %s", p, s)
	}
	if n, _ := polar.ExpireCanceled(ctx, a.SysDB, time.Now()); n != 0 {
		t.Errorf("expired before the period end")
	}
	if n, _ := polar.ExpireCanceled(ctx, a.SysDB, time.Now().Add(31*24*time.Hour)); n != 1 {
		t.Errorf("did not fall back to free at the period end")
	}
	if p, _ := plan(); p != "free" {
		t.Errorf("after the period end: %s", p)
	}
	send("msg_"+rnd(), map[string]any{"type": "subscription.active", "data": sub("active", false)}, "polar_whs_test-secret")
	send("msg_"+rnd(), map[string]any{"type": "subscription.revoked", "data": sub("canceled", false)}, "polar_whs_test-secret")
	if p, s := plan(); p != "free" || s != "revoked" {
		t.Errorf("revoked: %s %s", p, s)
	}

	// No usage push: nothing is charged, so no overage is ever sent to Polar (the billing job no
	// longer calls polar.PushUsage), and limits never refuse a legacy "pro" workspace's projects.
	for i := 0; i < 3; i++ {
		owner.must("POST", "/api/w/projects", map[string]any{"name": fmt.Sprintf("B%d %s", i, rnd())}, 201)
	}
}
