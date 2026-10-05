package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	if _, err := sv.hosbah(srv.URL, "hbu_bad").apps(ctx); err == nil || !strings.Contains(err.Error(), "reconnect") {
		t.Fatalf("a refused token says to reconnect, got %v", err)
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

func TestHosbahBase(t *testing.T) {
	t.Setenv("HOSBAH_URL", "https://dev.hosbah.com/")
	t.Setenv("HOSBAH_ALLOWED_HOSTS", "hosting.partner.io")
	for raw, want := range map[string]string{
		"":                             "https://dev.hosbah.com",
		"https://dev.hosbah.com":       "https://dev.hosbah.com",
		"https://DEV.hosbah.com/en/x":  "https://dev.hosbah.com",
		"https://hosting.partner.io/":  "https://hosting.partner.io",
		"http://hosting.partner.io":    "", // https only
		"https://evil.example.com":     "",
		"https://169.254.169.254":      "",
		"http://dev.hosbah.com":        "", // scheme differs from HOSBAH_URL
		"not a url":                    "",
		"https://localhost:8080/admin": "",
	} {
		got, err := hosbahBase(raw)
		if want == "" {
			if err == nil {
				t.Errorf("%q: want a refusal, got %q", raw, got)
			}
			continue
		}
		if err != nil || got != want {
			t.Errorf("%q = %q, %v; want %q", raw, got, err, want)
		}
	}
	t.Setenv("HOSBAH_URL", "")
	if _, err := hosbahBase(""); err == nil {
		t.Error("no HOSBAH_URL and no base_url must refuse")
	}
}

func TestNameOf(t *testing.T) {
	for in, want := range map[string]string{"sara.ali@x.com": "Sara Ali", "bob@x.com": "Bob", "a_b-c+d@x": "A B C D", "@x.com": "@x.com"} {
		if got := nameOf(in); got != want {
			t.Errorf("nameOf(%q) = %q, want %q", in, got, want)
		}
	}
}
