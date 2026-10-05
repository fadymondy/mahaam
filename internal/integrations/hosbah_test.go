package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/tenant"
)

// fakeHosbah serves the /api/integrations contract with one user token and one app.
func fakeHosbah(t *testing.T) *httptest.Server {
	t.Helper()
	app := `{"id":"a1","name":"shop","title":"Shop","status":"running","server_id":"s1","server_name":"edge","domains":["shop.example.com"],"panel_url":"https://h.example/en/panel/s1/apps/a1"}`
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		user, appTok := auth == "Bearer hbu_good", auth == "Bearer hba_minted"
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/oauth/token":
			_ = r.ParseForm()
			f := r.PostForm
			if f.Get("client_id") != "mahaam" || f.Get("client_secret") != "s3cret" || f.Get("code_verifier") == "" ||
				f.Get("redirect_uri") != "https://mahaam.test"+HosbahCallbackPath || f.Get("grant_type") != "authorization_code" {
				t.Errorf("token form: %v", f)
			}
			if f.Get("code") != "good" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"hba_minted","token_type":"Bearer","app":` + app + `}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/integrations/apps" && user:
			_, _ = w.Write([]byte(`{"apps":[` + app + `,{"id":"a2","name":"bare","status":"new","server_id":"s1"}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/integrations/apps/a1/tokens" && user:
			var in struct{ Label string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in.Label == "" {
				t.Error("mint without a label")
			}
			_, _ = w.Write([]byte(`{"token":"hba_minted","app":` + app + `}`))
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/integrations/apps/") && user:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"title":"Not Found","detail":"app not found"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/integrations/app" && appTok:
			_, _ = w.Write([]byte(`{"app":` + app + `,"deployments":[{"id":"d1","number":7,"kind":"deploy","status":"succeeded","queued_at":"2026-10-05T10:00:00Z"}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/integrations/app/panel-sessions" && appTok:
			var in map[string]string
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in["email"] != "sara.ali@client.com" || in["name"] != "Sara Ali" || in["locale"] != "ar" {
				t.Errorf("panel-sessions body: %v", in)
			}
			_, _ = w.Write([]byte(`{"url":"https://h.example/panel/s1/sso?t=once","expires_at":"2026-10-05T10:05:00Z"}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/api/integrations/app/token" && appTok:
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"title":"Unauthorized"}`))
		}
	}))
}

func TestHosbahClient(t *testing.T) {
	srv := fakeHosbah(t)
	defer srv.Close()
	ctx := context.Background()
	sv := &Service{HTTP: srv.Client()}

	apps, err := sv.hosbah(srv.URL, "hbu_good").apps(ctx)
	if err != nil || len(apps) != 2 || apps[0].PanelURL == "" || apps[1].Domains == nil {
		t.Fatalf("apps = %+v, %v (domains must never be null)", apps, err)
	}

	tok, a, err := sv.hosbah(srv.URL, "hbu_good").mint(ctx, "a1", "Mahaam · Shop")
	if err != nil || tok != "hba_minted" || a.ID != "a1" {
		t.Fatalf("mint = %q %+v %v", tok, a, err)
	}
	cfg := hosbahConfig(srv.URL, a)
	if cfg["app_title"] != "Shop" || cfg["server_id"] != "s1" || cfg["base_url"] != srv.URL {
		t.Fatalf("config = %v", cfg)
	}
	for k := range cfg {
		if strings.Contains(strings.ToLower(k), "token") {
			t.Fatalf("config must not carry the token: %v", cfg)
		}
	}

	if _, _, err := sv.hosbah(srv.URL, "hbu_good").mint(ctx, "nope", "x"); err == nil || !strings.Contains(err.Error(), "app not found") {
		t.Fatalf("an unknown app surfaces Hosbah's detail, got %v", err)
	}
	if _, err := sv.hosbah(srv.URL, "hbu_bad").apps(ctx); err == nil || !strings.Contains(err.Error(), "connect Hosbah again") {
		t.Fatalf("a refused token says to connect again, got %v", err)
	}
	if e := upstream(&UpstreamError{Status: 401, Msg: "Hosbah: x"}); !strings.Contains(e.Error(), "Hosbah") {
		t.Fatalf("upstream keeps the message: %v", e)
	}

	app := sv.hosbah(srv.URL, "hba_minted")
	h, err := app.app(ctx)
	if err != nil || h.App.Status != "running" || len(h.Deployments) != 1 || h.Deployments[0].Number != 7 {
		t.Fatalf("app = %+v, %v", h, err)
	}
	var link PanelLink
	if err := app.do(ctx, http.MethodPost, "/api/integrations/app/panel-sessions",
		map[string]string{"email": "sara.ali@client.com", "name": nameOf("sara.ali@client.com"), "locale": "ar"}, &link); err != nil || link.URL == "" || link.ExpiresAt == nil {
		t.Fatalf("panel link = %+v, %v", link, err)
	}
	if err := app.do(ctx, http.MethodDelete, "/api/integrations/app/token", nil, nil); err != nil {
		t.Fatalf("revoke: %v", err)
	}
}

func TestHosbahState(t *testing.T) {
	now := time.Now()
	st := hosbahState{W: "w1", P: "p1", U: "u1", Slug: "acme", L: "ar", Via: "hosbah", Nonce: "n1", Exp: now.Add(time.Minute).Unix()}
	raw := signHosbahState(st)
	got, err := verifyHosbahState(raw, now)
	if err != nil || *got != st {
		t.Fatalf("round trip = %+v, %v", got, err)
	}
	if _, err := verifyHosbahState(raw, now.Add(2*time.Minute)); err == nil {
		t.Error("an expired state must be refused")
	}
	enc, sig, _ := strings.Cut(raw, ".")
	if _, err := verifyHosbahState(enc+"x."+sig, now); err == nil {
		t.Error("a tampered state must be refused")
	}
	// The import state's signature must not validate a connect state (domain separation).
	if _, err := verifyHosbahState(signState(installState{W: "w1", P: "p1", U: "u1", Exp: now.Add(time.Minute).Unix()}), now); err == nil {
		t.Error("a GitHub install state must not pass as a Hosbah state")
	}
	v1, c1 := hosbahPKCE("n1")
	v2, _ := hosbahPKCE("n2")
	if len(v1) < 43 || v1 == v2 || c1 == "" || c1 == v1 {
		t.Errorf("pkce: %q %q %q", v1, v2, c1)
	}
}

func TestOpenPending(t *testing.T) {
	now := time.Now()
	raw, err := sealPending(hosbahPending{W: "w1", P: "p1", U: "u1", Token: "hub", Exp: now.Add(time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	me := &tenant.Scope{WorkspaceID: "w1", UserID: "u1"}
	if pd, err := openPending(raw, me, "p1", now); err != nil || pd.Token != "hub" {
		t.Fatalf("open = %+v, %v", pd, err)
	}
	for name, c := range map[string]struct {
		s   *tenant.Scope
		p   string
		now time.Time
		raw string
	}{
		"other user":      {&tenant.Scope{WorkspaceID: "w1", UserID: "u2"}, "p1", now, raw},
		"other workspace": {&tenant.Scope{WorkspaceID: "w2", UserID: "u1"}, "p1", now, raw},
		"other project":   {me, "p2", now, raw},
		"expired":         {me, "p1", now.Add(2 * time.Minute), raw},
		"empty":           {me, "p1", now, ""},
		"garbage":         {me, "p1", now, "v1:abc"},
	} {
		if _, err := openPending(c.raw, c.s, c.p, c.now); err == nil {
			t.Errorf("%s: want a refusal", name)
		}
	}
}

func TestHosbahCodeToken(t *testing.T) {
	srv := fakeHosbah(t)
	defer srv.Close()
	t.Setenv("HOSBAH_URL", srv.URL)
	t.Setenv("HOSBAH_CLIENT_ID", "mahaam")
	t.Setenv("HOSBAH_CLIENT_SECRET", "s3cret")
	t.Setenv("WEB_URL", "https://mahaam.test")
	sv := &Service{HTTP: srv.Client()}
	tok, app, err := sv.hosbahCodeToken(context.Background(), "good", "verifier")
	if err != nil || tok != "hba_minted" || app.ID != "a1" || len(app.Domains) != 1 {
		t.Fatalf("code token = %q %+v %v", tok, app, err)
	}
	if _, _, err := sv.hosbahCodeToken(context.Background(), "bad", "verifier"); err == nil || !strings.Contains(err.Error(), "invalid_grant") {
		t.Errorf("a refused code: %v", err)
	}
	t.Setenv("HOSBAH_CLIENT_SECRET", "")
	if _, _, err := sv.hosbahCodeToken(context.Background(), "good", "verifier"); err == nil {
		t.Error("no client credentials must refuse")
	}
}

func TestNameOf(t *testing.T) {
	for in, want := range map[string]string{"sara.ali@x.com": "Sara Ali", "bob@x.com": "Bob", "a_b-c+d@x": "A B C D", "@x.com": "@x.com"} {
		if got := nameOf(in); got != want {
			t.Errorf("nameOf(%q) = %q, want %q", in, got, want)
		}
	}
}
