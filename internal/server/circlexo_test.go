package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	circlexo "github.com/circlexo/circlexo-go"
	"github.com/circlexo/circlexo-go/circlexotest"
	"github.com/circlexo/circlexo-go/oidc"
	"github.com/circlexo/circlexo-go/webhooks"

	"github.com/fadymondy/mahaam/internal/app"
	hub "github.com/fadymondy/mahaam/internal/circlexo"
	"github.com/fadymondy/mahaam/internal/limits"
)

// The CircleXO integration against circlexotest, the SDK's fake hub. The secrets below are
// throwaway values made up for this file: they are not, and never were, a real credential.
const (
	testHubApp        = "app-mahaam-test"
	testWebhookSecret = "whsec_" + "bWFoYWFtLXRlc3Qtd2ViaG9vay1zZWNyZXQtMDEyMzQ1Ng=="
)

type hubStack struct {
	t   *testing.T
	hub *circlexotest.Hub
	a   *app.App
	srv *httptest.Server
	svc *hub.Service
}

// bootHub starts the fake hub and a Mahaam stack configured for it. WEB_URL is a made-up host:
// the OIDC redirect only has to be consistent, and the tests that follow it rewrite the host.
func bootHub(t *testing.T) *hubStack {
	t.Helper()
	h := circlexotest.New(t, testHubApp)
	t.Setenv("CIRCLEXO_ISSUER", h.URL)
	t.Setenv("CIRCLEXO_APP_ID", testHubApp)
	t.Setenv("CIRCLEXO_CLIENT_ID", h.ClientID)
	t.Setenv("CIRCLEXO_CLIENT_SECRET", h.ClientSecret)
	t.Setenv("CIRCLEXO_APP_KEY", h.AppKey)
	t.Setenv("CIRCLEXO_WEBHOOK_SECRET", testWebhookSecret)
	t.Setenv("CIRCLEXO_SESSION_KEY", "test-session-key-not-a-secret")
	t.Setenv("WEB_URL", "http://mahaam.test")
	a, srv := bootStack(t)
	t.Cleanup(func() {
		hub.Install(nil)    // a later test in this process boots without the hub
		_ = a.SysDB.Close() // the shared test database has a small connection budget
	})
	svc := hub.Current()
	if svc == nil {
		t.Fatal("the integration did not start")
	}
	return &hubStack{t: t, hub: h, a: a, srv: srv, svc: svc}
}

// event POSTs a signed webhook and returns the status.
func (s *hubStack) event(typ, org string, data any, id string) int {
	s.t.Helper()
	body, _ := json.Marshal(map[string]any{"id": id, "type": typ, "version": 1, "occurred_at": time.Now().UTC(), "org_id": org, "data": data})
	return s.post(hub.EventsPath, body, id, testWebhookSecret)
}

func (s *hubStack) post(path string, body []byte, id, secret string) int {
	s.t.Helper()
	ts := time.Now()
	req, _ := http.NewRequest(http.MethodPost, s.srv.URL+path, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("webhook-id", id)
	req.Header.Set("webhook-timestamp", strconv.FormatInt(ts.Unix(), 10))
	if secret != "" {
		sig, err := webhooks.Sign(secret, id, ts, body)
		if err != nil {
			s.t.Fatal(err)
		}
		req.Header.Set("webhook-signature", sig)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

func (s *hubStack) provision(org string) (int, map[string]string) {
	s.t.Helper()
	body, _ := json.Marshal(map[string]string{"org_id": org})
	req, _ := http.NewRequest(http.MethodPost, s.srv.URL+hub.ProvisionPath, strings.NewReader(string(body)))
	ts := time.Now()
	id := "prov-" + rnd()
	sig, _ := webhooks.Sign(testWebhookSecret, id, ts, body)
	req.Header.Set("webhook-id", id)
	req.Header.Set("webhook-timestamp", strconv.FormatInt(ts.Unix(), 10))
	req.Header.Set("webhook-signature", sig)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]string{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// install registers an org at the fake hub with these members (hub id, role; the e-mail is derived).
func (s *hubStack) install(org string, members ...[2]string) []circlexo.Member {
	s.hub.Install(org)
	var ms []circlexo.Member
	for _, m := range members {
		ms = append(ms, circlexo.Member{UserID: m[0], Email: m[0] + "@example.test", DisplayName: m[0], Role: m[1]})
	}
	s.hub.Lock()
	s.hub.Members[org] = ms
	s.hub.Unlock()
	return ms
}

func (s *hubStack) roleOf(ws, email string) (role, status string) {
	s.t.Helper()
	err := s.a.SysDB.QueryRow(`SELECT m.role, m.status FROM workspace_members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND lower(u.email) = lower($2)`, ws, email).Scan(&role, &status)
	if err == sql.ErrNoRows {
		return "", ""
	}
	if err != nil {
		s.t.Fatal(err)
	}
	return role, status
}

func (s *hubStack) workspaceOf(org string) (id, slug string, active bool) {
	s.t.Helper()
	err := s.a.SysDB.QueryRow(`SELECT l.workspace_id, w.slug, l.status = 'active' FROM circlexo_org_links l JOIN workspaces w ON w.id = l.workspace_id WHERE l.org_id = $1`, org).Scan(&id, &slug, &active)
	if err != nil {
		s.t.Fatalf("no workspace linked to org %s: %v", org, err)
	}
	return
}

func hubOrg() string { return "org-" + rnd() }

// login is a completed hub sign-in as claims say, through the same code the callback runs.
func (s *hubStack) login(sub, email string, verified bool, org, role, sid string) (*http.Response, string, *hub.LoginError) {
	s.t.Helper()
	id := &circlexo.Claims{Subject: sub, SessionID: sid, Raw: map[string]any{"email": email, "email_verified": verified}}
	at := &circlexo.Claims{Subject: sub, OrgID: org, OrgRole: role, SessionID: sid}
	w := httptest.NewRecorder()
	to, err := s.svc.FinishLogin(context.Background(), w, &oidc.Login{IDClaims: id, AccessClaims: at})
	return w.Result(), to, err
}

func sessionCookie(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == "togo_session" && c.Value != "" {
			return c
		}
	}
	return nil
}

func (s *hubStack) me(c *http.Cookie) int {
	s.t.Helper()
	req, _ := http.NewRequest(http.MethodGet, s.srv.URL+"/api/auth/me", nil)
	req.AddCookie(c)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func (s *hubStack) count(q string, args ...any) int {
	s.t.Helper()
	var n int
	if err := s.a.SysDB.QueryRow(q, args...).Scan(&n); err != nil {
		s.t.Fatal(err)
	}
	return n
}

// roundTrip is the whole browser flow for one hub user: /auth/circlexo/login -> the hub's authorize
// endpoint (which signs the fake user in) -> /auth/circlexo/callback. It returns where the callback
// sent the browser and the cookie jar the flow ran in.
func (s *hubStack) roundTrip(u circlexotest.User, launch string) (string, *http.Client) {
	s.t.Helper()
	s.hub.Lock()
	s.hub.User = u
	s.hub.Unlock()
	noFollow := func() *http.Client {
		return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	browser := noFollow()
	browser.Jar = newClient(s.t, s.srv.URL).http.Jar
	step := func(c *http.Client, u string) *http.Response {
		res, err := c.Get(u)
		if err != nil {
			s.t.Fatal(err)
		}
		res.Body.Close()
		return res
	}
	start := hub.LoginPath
	if launch != "" {
		start = hub.LaunchPath + "?org=" + url.QueryEscape(launch)
	}
	res := step(browser, s.srv.URL+start)
	if launch != "" { // the launch URL bounces to the login route
		res = step(browser, s.srv.URL+res.Header.Get("Location"))
	}
	to := res.Header.Get("Location")
	if res.StatusCode != http.StatusFound || !strings.HasPrefix(to, s.hub.URL) {
		s.t.Fatalf("login should redirect to the hub, got %d %q", res.StatusCode, to)
	}
	res = step(noFollow(), to) // the hub, signed in as u
	cb, err := url.Parse(res.Header.Get("Location"))
	if err != nil || cb.Path != hub.CallbackPath {
		s.t.Fatalf("the hub sent us to %q", res.Header.Get("Location"))
	}
	res = step(browser, s.srv.URL+cb.Path+"?"+cb.RawQuery)
	if res.StatusCode != http.StatusFound {
		s.t.Fatalf("callback: %d", res.StatusCode)
	}
	return res.Header.Get("Location"), browser
}

// signedIn reports whether the browser's session works.
func (s *hubStack) signedIn(b *http.Client) bool {
	s.t.Helper()
	res, err := b.Get(s.srv.URL + "/api/auth/me")
	if err != nil {
		s.t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode == 200
}

// The whole browser round trip against the test hub, which now vouches for the address
// (email_verified) unless the user says otherwise.
func TestCircleXOLoginRoundTrip(t *testing.T) {
	s := bootHub(t)
	if code, b := s.get("/api/circlexo/config"); code != 200 || !strings.Contains(string(b), `"enabled":true`) {
		t.Fatalf("config: %d %s", code, b)
	}

	t.Run("new user is created, linked and signed in", func(t *testing.T) {
		email, sub := "roundtrip-"+rnd()+"@example.test", "sub-"+rnd()
		to, browser := s.roundTrip(circlexotest.User{ID: sub, Email: email, Name: "Round Trip"}, "")
		if to != "/" || !s.signedIn(browser) {
			t.Fatalf("landing %q, signed in %v", to, s.signedIn(browser))
		}
		if n := s.count(`SELECT count(*) FROM circlexo_user_links l JOIN users u ON u.id = l.user_id WHERE l.subject = $1 AND lower(u.email) = $2 AND l.linked_via = 'created'`, sub, email); n != 1 {
			t.Fatalf("expected one created link, got %d", n)
		}
		// Signing in again is the same user, not a second account.
		before := s.count(`SELECT count(*) FROM users`)
		if _, b2 := s.roundTrip(circlexotest.User{ID: sub, Email: email}, ""); !s.signedIn(b2) || s.count(`SELECT count(*) FROM users`) != before {
			t.Fatal("a second sign-in did not reuse the account")
		}
	})

	t.Run("linked by verified e-mail to an existing account", func(t *testing.T) {
		_, uid, email := signup(t, s.a, s.srv.URL, "rtlink")
		if _, err := s.a.SysDB.Exec(`INSERT INTO platform_users (user_id, email_verified_at) VALUES ($1, now())
			ON CONFLICT (user_id) DO UPDATE SET email_verified_at = now()`, uid); err != nil {
			t.Fatal(err)
		}
		sub := "sub-" + rnd()
		before := s.count(`SELECT count(*) FROM users`)
		_, browser := s.roundTrip(circlexotest.User{ID: sub, Email: email}, "")
		if !s.signedIn(browser) || s.count(`SELECT count(*) FROM users`) != before {
			t.Fatal("expected to sign in to the existing account")
		}
		var linked, via string
		if e := s.a.SysDB.QueryRow(`SELECT user_id, linked_via FROM circlexo_user_links WHERE subject = $1`, sub).Scan(&linked, &via); e != nil || linked != uid || via != "email" {
			t.Fatalf("expected an email link to %s, got %s %s %v", uid, linked, via, e)
		}
	})

	t.Run("an unverified address is refused and creates nothing", func(t *testing.T) {
		email := "unverified-" + rnd() + "@example.test"
		to, browser := s.roundTrip(circlexotest.User{ID: "sub-" + rnd(), Email: email, EmailUnverified: true}, "")
		if to != "/login?circlexo_error=email_unverified" || s.signedIn(browser) {
			t.Fatalf("got %q (signed in %v)", to, s.signedIn(browser))
		}
		if n := s.count(`SELECT count(*) FROM users WHERE lower(email) = $1`, email); n != 0 {
			t.Fatalf("a refused sign-in created %d account(s)", n)
		}
	})

	t.Run("launch URL lands in the org's workspace", func(t *testing.T) {
		org := hubOrg()
		s.install(org, [2]string{"own-" + rnd(), "owner"})
		if code, _ := s.provision(org); code != 200 {
			t.Fatal("provision")
		}
		_, slug, _ := s.workspaceOf(org)
		s.hub.Lock()
		delete(s.hub.Entitlements, org)
		s.hub.Unlock()
		to, browser := s.roundTrip(circlexotest.User{ID: "sub-" + rnd(), Email: "launch-" + rnd() + "@example.test", OrgID: org, OrgRole: "member"}, slug)
		if to != "/en/w/"+slug || !s.signedIn(browser) {
			t.Fatalf("launch landed on %q", to)
		}
	})
}

func (s *hubStack) get(path string) (int, []byte) {
	s.t.Helper()
	res, err := http.Get(s.srv.URL + path)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b
}

// Linking: a new user, a link by verified e-mail, and every refusal.
func TestCircleXOLinking(t *testing.T) {
	s := bootHub(t)

	t.Run("new user is created, linked and signed in", func(t *testing.T) {
		email := "new-" + rnd() + "@example.test"
		sub := "sub-" + rnd()
		res, to, err := s.login(sub, email, true, "", "", "sid-"+rnd())
		if err != nil {
			t.Fatal(err)
		}
		if to != "/" {
			t.Fatalf("with no org the user lands on the home page, got %q", to)
		}
		ck := sessionCookie(res)
		if ck == nil || s.me(ck) != 200 {
			t.Fatal("the session cookie does not sign in")
		}
		if n := s.count(`SELECT count(*) FROM circlexo_user_links l JOIN users u ON u.id = l.user_id WHERE l.subject = $1 AND lower(u.email) = $2 AND l.linked_via = 'created'`, sub, email); n != 1 {
			t.Fatalf("expected one created link, got %d", n)
		}
		// The same hub user signing in again is the same Mahaam user, even with another address claim.
		before := s.count(`SELECT count(*) FROM users`)
		if _, _, err := s.login(sub, "other-"+rnd()+"@example.test", true, "", "", "sid-"+rnd()); err != nil {
			t.Fatal(err)
		}
		if s.count(`SELECT count(*) FROM users`) != before {
			t.Fatal("a second sign-in created another account")
		}
	})

	t.Run("linked by verified e-mail to an account that confirmed it", func(t *testing.T) {
		_, uid, email := signup(t, s.a, s.srv.URL, "link")
		// Registered with a password but never confirmed the address: linking would let anyone who
		// registers a stranger's address inherit that stranger's hub sign-in.
		if _, _, err := s.login("sub-"+rnd(), email, true, "", "", "sid-"+rnd()); err == nil || err.Code() != "account_conflict" {
			t.Fatalf("an unconfirmed password account must not be linked, got %v", err)
		}
		if _, err := s.a.SysDB.Exec(`INSERT INTO platform_users (user_id, email_verified_at) VALUES ($1, now())
			ON CONFLICT (user_id) DO UPDATE SET email_verified_at = now()`, uid); err != nil {
			t.Fatal(err)
		}
		sub := "sub-" + rnd()
		res, _, err := s.login(sub, strings.ToUpper(email), true, "", "", "sid-"+rnd())
		if err != nil {
			t.Fatal(err)
		}
		if sessionCookie(res) == nil {
			t.Fatal("no session")
		}
		var linked, via string
		if e := s.a.SysDB.QueryRow(`SELECT user_id, linked_via FROM circlexo_user_links WHERE subject = $1`, sub).Scan(&linked, &via); e != nil || linked != uid || via != "email" {
			t.Fatalf("expected an email link to %s, got %s %s %v", uid, linked, via, e)
		}
		// Another hub user with the same address cannot take the account over.
		if _, _, err := s.login("sub-"+rnd(), email, true, "", "", "sid-"+rnd()); err == nil || err.Code() != "account_conflict" {
			t.Fatalf("a second hub subject must not link to a linked account, got %v", err)
		}
		// The password still works: dual login.
		c := newClient(t, s.srv.URL)
		c.must("POST", "/api/auth/login", map[string]string{"email": email, "password": "correct-horse-9"}, 200)
	})

	t.Run("an unverified hub address is refused", func(t *testing.T) {
		email := "unv-" + rnd() + "@example.test"
		if _, _, err := s.login("sub-"+rnd(), email, false, "", "", "sid-"+rnd()); err == nil || err.Code() != "email_unverified" {
			t.Fatalf("got %v", err)
		}
		if n := s.count(`SELECT count(*) FROM users WHERE lower(email) = $1`, email); n != 0 {
			t.Fatal("an account was created")
		}
	})

	t.Run("a suspended account is refused", func(t *testing.T) {
		_, uid, email := signup(t, s.a, s.srv.URL, "susp")
		s.a.SysDB.Exec(`INSERT INTO platform_users (user_id, email_verified_at, suspended_at) VALUES ($1, now(), now())
			ON CONFLICT (user_id) DO UPDATE SET email_verified_at = now(), suspended_at = now()`, uid)
		if _, _, err := s.login("sub-"+rnd(), email, true, "", "", "sid-"+rnd()); err == nil || err.Code() != "suspended" {
			t.Fatalf("got %v", err)
		}
	})
}

// Provision is idempotent, confirms the tenant to the hub, maps roles, and refuses bad signatures.
func TestCircleXOProvision(t *testing.T) {
	s := bootHub(t)
	org := hubOrg()
	ms := s.install(org, [2]string{"own-" + rnd(), "owner"}, [2]string{"adm-" + rnd(), "admin"}, [2]string{"mem-" + rnd(), "member"}, [2]string{"bil-" + rnd(), "billing"})

	if code := s.post(hub.ProvisionPath, []byte(`{"org_id":"`+org+`"}`), "x", ""); code != http.StatusUnauthorized {
		t.Fatalf("an unsigned provision call must be 401, got %d", code)
	}
	if code := s.post(hub.ProvisionPath, []byte(`{"org_id":"`+org+`"}`), "x", "whsec_"+base64.StdEncoding.EncodeToString([]byte("some-other-secret-not-the-real-one"))); code != http.StatusUnauthorized {
		t.Fatalf("a wrongly signed provision call must be 401, got %d", code)
	}
	if n := s.count(`SELECT count(*) FROM circlexo_org_links WHERE org_id = $1`, org); n != 0 {
		t.Fatal("a refused call provisioned")
	}

	code, first := s.provision(org)
	if code != 200 || first["product_tenant_id"] == "" || first["slug"] == "" {
		t.Fatalf("provision: %d %v", code, first)
	}
	code, second := s.provision(org)
	if code != 200 || second["product_tenant_id"] != first["product_tenant_id"] {
		t.Fatalf("provision must be idempotent: %v then %v", first, second)
	}
	if n := s.count(`SELECT count(*) FROM circlexo_org_links WHERE org_id = $1`, org); n != 1 {
		t.Fatalf("%d links", n)
	}
	ws, slug, active := s.workspaceOf(org)
	if !active || ws != first["product_tenant_id"] || slug != first["slug"] {
		t.Fatalf("link does not match the answer: %s %s %v", ws, slug, active)
	}
	s.hub.Lock()
	tn := s.hub.Tenants[org]
	s.hub.Unlock()
	if tn.ProductTenantID != ws || tn.ProductTenantSlug != slug || tn.Status != "active" {
		t.Fatalf("the hub was not told about the tenant: %+v", tn)
	}

	// Members and the role mapping: owner/admin keep their rank, member and billing are members.
	want := map[string]string{ms[0].Email: "owner", ms[1].Email: "admin", ms[2].Email: "member", ms[3].Email: "member"}
	for email, role := range want {
		if got, st := s.roleOf(ws, email); got != role || st != "active" {
			t.Fatalf("%s: got %q/%q want %q", email, got, st, role)
		}
	}
	if n := s.count(`SELECT count(*) FROM workspace_members WHERE workspace_id = $1`, ws); n != 4 {
		t.Fatalf("%d members", n)
	}

	// The same install by webhook is the same workspace, and a redelivery is dropped by id.
	if code := s.event(webhooks.AppInstalled, org, map[string]any{"slug": "org", "name": "Org"}, "evt-"+rnd()); code != http.StatusNoContent {
		t.Fatalf("install webhook: %d", code)
	}
	if again, _, _ := s.workspaceOf(org); again != ws {
		t.Fatal("the webhook made a second workspace")
	}
	// A webhook with a bad signature never runs.
	other := hubOrg()
	s.install(other, [2]string{"o-" + rnd(), "owner"})
	body, _ := json.Marshal(map[string]any{"id": "evt-bad", "type": webhooks.AppInstalled, "org_id": other, "data": map[string]any{}})
	if code := s.post(hub.EventsPath, body, "evt-bad", "whsec_"+base64.StdEncoding.EncodeToString([]byte("some-other-secret-not-the-real-one"))); code != http.StatusUnauthorized {
		t.Fatalf("bad signature: %d", code)
	}
	if n := s.count(`SELECT count(*) FROM circlexo_org_links WHERE org_id = $1`, other); n != 0 {
		t.Fatal("a badly signed install provisioned")
	}
	if code := s.post(hub.EventsPath, body, "evt-none", ""); code != http.StatusUnauthorized {
		t.Fatalf("unsigned webhook: %d", code)
	}
}

// member.* webhooks, and deprovision (which keeps everything).
func TestCircleXOMemberSync(t *testing.T) {
	s := bootHub(t)
	org := hubOrg()
	owner, mem := "own-"+rnd(), "mem-"+rnd()
	ms := s.install(org, [2]string{owner, "owner"}, [2]string{mem, "member"})
	if code, _ := s.provision(org); code != 200 {
		t.Fatal("provision")
	}
	ws, _, _ := s.workspaceOf(org)
	person := func(id string) map[string]any {
		return map[string]any{"id": id, "email": id + "@example.test", "display_name": id}
	}

	// Promoted in the hub.
	s.event(webhooks.MemberRoleChanged, org, map[string]any{"user": person(mem), "role": "admin", "previous_role": "member"}, "e1-"+rnd())
	if r, st := s.roleOf(ws, ms[1].Email); r != "admin" || st != "active" {
		t.Fatalf("after promotion: %s %s", r, st)
	}
	// A Mahaam-only role survives a hub "member" (the hub cannot express manager).
	s.a.SysDB.Exec(`UPDATE workspace_members m SET role = 'manager' FROM users u WHERE u.id = m.user_id AND m.workspace_id = $1 AND u.email = $2`, ws, ms[1].Email)
	s.event(webhooks.MemberRoleChanged, org, map[string]any{"user": person(mem), "role": "member"}, "e2-"+rnd())
	if r, _ := s.roleOf(ws, ms[1].Email); r != "manager" {
		t.Fatalf("a manager should stay a manager on hub role member, got %s", r)
	}
	// A new member.
	newbie := "new-" + rnd()
	s.event(webhooks.MemberAdded, org, map[string]any{"user": person(newbie), "role": "member"}, "e3-"+rnd())
	if r, st := s.roleOf(ws, newbie+"@example.test"); r != "member" || st != "active" {
		t.Fatalf("added member: %s %s", r, st)
	}
	// Removed: suspended, not deleted.
	s.event(webhooks.MemberRemoved, org, map[string]any{"user": person(newbie)}, "e4-"+rnd())
	if r, st := s.roleOf(ws, newbie+"@example.test"); r != "member" || st != "suspended" {
		t.Fatalf("removed member: %s %s", r, st)
	}
	// Re-added: active again.
	s.event(webhooks.MemberAdded, org, map[string]any{"user": person(newbie), "role": "member"}, "e5-"+rnd())
	if _, st := s.roleOf(ws, newbie+"@example.test"); st != "active" {
		t.Fatalf("re-added member: %s", st)
	}
	// The last owner is never removed or demoted by the hub.
	s.event(webhooks.MemberRemoved, org, map[string]any{"user": person(owner)}, "e6-"+rnd())
	s.event(webhooks.MemberRoleChanged, org, map[string]any{"user": person(owner), "role": "member"}, "e7-"+rnd())
	if r, st := s.roleOf(ws, ms[0].Email); r != "owner" || st != "active" {
		t.Fatalf("the last owner changed: %s %s", r, st)
	}
	// An event for an org that never installed the app is acknowledged and does nothing.
	if code := s.event(webhooks.MemberAdded, hubOrg(), map[string]any{"user": person("x-" + rnd()), "role": "owner"}, "e8-"+rnd()); code != http.StatusNoContent {
		t.Fatalf("unknown org: %d", code)
	}

	// Deprovision marks the link inactive and deletes nothing.
	members := s.count(`SELECT count(*) FROM workspace_members WHERE workspace_id = $1`, ws)
	if code := s.event(webhooks.AppRemoved, org, map[string]any{}, "e9-"+rnd()); code != http.StatusNoContent {
		t.Fatalf("app_removed: %d", code)
	}
	if _, _, active := s.workspaceOf(org); active {
		t.Fatal("the link is still active")
	}
	if s.count(`SELECT count(*) FROM workspaces WHERE id = $1`, ws) != 1 || s.count(`SELECT count(*) FROM workspace_members WHERE workspace_id = $1`, ws) != members {
		t.Fatal("deprovision deleted data")
	}
	// Installing again reactivates the same workspace.
	if code, out := s.provision(org); code != 200 || out["product_tenant_id"] != ws {
		t.Fatalf("re-provision: %d %v", code, out)
	}
	if _, _, active := s.workspaceOf(org); !active {
		t.Fatal("not reactivated")
	}
}

// After sign-in the user lands in the workspace of the token's org, with the hub role.
func TestCircleXOLandingWorkspace(t *testing.T) {
	s := bootHub(t)
	org := hubOrg()
	sub := "sub-" + rnd()
	s.install(org, [2]string{"own-" + rnd(), "owner"})
	email := "land-" + rnd() + "@example.test"

	// Not provisioned yet: the sign-in provisions it (the hub confirms the org has the app).
	res, to, err := s.login(sub, email, true, org, "admin", "sid-"+rnd())
	if err != nil {
		t.Fatal(err)
	}
	ws, slug, _ := s.workspaceOf(org)
	if to != "/en/w/"+slug {
		t.Fatalf("landing: %q want /en/w/%s", to, slug)
	}
	if r, st := s.roleOf(ws, email); r != "admin" || st != "active" {
		t.Fatalf("hub admin should be a workspace admin: %s %s", r, st)
	}
	if sessionCookie(res) == nil {
		t.Fatal("no session")
	}
	// An org the hub does not know lands on the home page, and nothing is created.
	other := hubOrg()
	if _, to, err := s.login(sub, email, true, other, "owner", "sid-"+rnd()); err != nil || to != "/" {
		t.Fatalf("unknown org: %q %v", to, err)
	}
	if s.count(`SELECT count(*) FROM circlexo_org_links WHERE org_id = $1`, other) != 0 {
		t.Fatal("an unknown org was provisioned")
	}
}

// Entitlements: hub-linked workspaces take projects/members/client_portal from the hub; unlinked
// ones keep the Mahaam plan; a hub outage is read-only inside the grace window and closed after.
func TestCircleXOEntitlements(t *testing.T) {
	s := bootHub(t)
	org := hubOrg()
	s.install(org, [2]string{"own-" + rnd(), "owner"})
	if code, _ := s.provision(org); code != 200 {
		t.Fatal("provision")
	}
	ws, _, _ := s.workspaceOf(org)
	ctx := context.Background()
	lim := func(n int64) *int64 { return &n }
	setEnts := func(active bool, projects *int64, portal bool) {
		s.hub.Lock()
		s.hub.Entitlements[org] = circlexo.Entitlements{OrgID: org, AppID: testHubApp, Active: active, Plan: "pro", Status: "active", Version: 2, Features: []circlexo.Entitlement{
			{Key: "projects", Kind: "limit", Enabled: true, Limit: projects},
			{Key: "members", Kind: "limit", Enabled: true},
			{Key: "client_portal", Kind: "flag", Enabled: portal},
		}}
		s.hub.Unlock()
		s.svc.Ents.Invalidate(org, 0)
		limits.Invalidate(ws)
	}
	refused := func(key string) *limits.Exceeded {
		t.Helper()
		x, _ := limits.As(limits.Check(ctx, ws, key, 1))
		return x
	}

	// Unlinked workspaces are untouched: PLAN_DEFAULT is unlimited and the hub has no say.
	_, uid, _ := signup(t, s.a, s.srv.URL, "plain")
	plain := s.plainWorkspace(uid)
	if e, err := limits.For(ctx, plain); err != nil || e.Hub {
		t.Fatalf("an unlinked workspace must not be hub governed: %v %+v", err, e)
	}

	setEnts(true, lim(0), true)
	e, err := limits.For(ctx, ws)
	if err != nil || !e.Hub || e.ReadOnly {
		t.Fatalf("expected a hub governed workspace: %v %+v", err, e)
	}
	if x := refused(limits.Projects); x == nil || x.Code != "plan_limit" {
		t.Fatalf("a projects limit of 0 must refuse the first project: %v", x)
	}
	if x := refused(limits.Members); x != nil {
		t.Fatalf("unlimited members refused: %v", x)
	}
	if !e.Features.CustomerPortal {
		t.Fatal("client_portal should be on")
	}
	setEnts(true, lim(5), false)
	if x := refused(limits.Projects); x != nil {
		t.Fatalf("a limit of 5 refused the first project: %v", x)
	}
	if e, _ := limits.For(ctx, ws); e.Features.CustomerPortal {
		t.Fatal("client_portal should be off")
	}

	// entitlement.changed and subscription.* invalidate: the hub's new answer is seen at once.
	s.hub.Lock()
	ent := s.hub.Entitlements[org]
	ent.Features[0].Limit = lim(0)
	ent.Version = 3
	s.hub.Entitlements[org] = ent
	s.hub.Unlock()
	if x := refused(limits.Projects); x != nil {
		t.Fatal("expected the cached (stale) answer before the event")
	}
	s.event(webhooks.EntitlementChanged, org, map[string]any{"version": 3, "reason": "plan_changed"}, "en-"+rnd())
	if x := refused(limits.Projects); x == nil {
		t.Fatal("entitlement.changed did not invalidate")
	}
	s.hub.Lock()
	ent.Features[0].Limit = lim(9)
	s.hub.Entitlements[org] = ent
	s.hub.Unlock()
	s.event("subscription.updated", org, map[string]any{}, "sub-"+rnd())
	if x := refused(limits.Projects); x != nil {
		t.Fatalf("subscription.* did not invalidate: %v", x)
	}

	// Hub down, inside the grace window: the last answer stands, read-only (adds refused).
	if _, err := s.svc.Ents.Get(ctx, org, 0); err != nil {
		t.Fatal(err)
	}
	s.svc.Ents.Invalidate(org, 0)
	limits.Invalidate(ws)
	s.hub.Lock()
	s.hub.Fail = http.StatusInternalServerError
	s.hub.Unlock()
	if e, err := limits.For(ctx, ws); err != nil || !e.ReadOnly || !e.Hub {
		t.Fatalf("expected read-only grace: %v %+v", err, e)
	}
	if x := refused(limits.Projects); x == nil || x.Code != "plan_read_only" {
		t.Fatalf("read-only must refuse adds, got %v", x)
	}
	if x, _ := limits.As(limits.Check(ctx, ws, limits.Projects, 0)); x != nil {
		t.Fatalf("read-only must still allow reading (n=0): %v", x)
	}
	s.hub.Lock()
	s.hub.Fail = 0
	s.hub.Unlock()

	// An org the hub has no entitlements for fails closed.
	s.hub.Lock()
	delete(s.hub.Entitlements, org)
	s.hub.Unlock()
	s.svc.Ents.Invalidate(org, 0)
	limits.Invalidate(ws)
	if e, _ := limits.For(ctx, ws); !e.ReadOnly || e.Features.CustomerPortal {
		t.Fatalf("no entitlements must fail closed: %+v", e)
	}
	if x := refused(limits.Members); x == nil {
		t.Fatal("no entitlements must refuse adding members")
	}

	// Deprovisioned: back to Mahaam's own plan logic.
	s.event(webhooks.AppRemoved, org, map[string]any{}, "rm-"+rnd())
	if e, err := limits.For(ctx, ws); err != nil || e.Hub || e.ReadOnly {
		t.Fatalf("after deprovision the workspace must be a plain one: %v %+v", err, e)
	}
}

func (s *hubStack) plainWorkspace(userID string) string {
	s.t.Helper()
	var id string
	if err := s.a.SysDB.QueryRow(`INSERT INTO workspaces (slug, name, created_by, plan) VALUES ($1, 'Plain', $2, 'unlimited') RETURNING id`, "plain-"+rnd(), userID).Scan(&id); err != nil {
		s.t.Fatal(err)
	}
	return id
}

// Billing: a linked workspace is pointed at the hub; Polar stays for the others.
func TestCircleXOBillingLink(t *testing.T) {
	s := bootHub(t)
	org := hubOrg()
	own := "own-" + rnd()
	s.install(org, [2]string{own, "owner"})
	if code, _ := s.provision(org); code != 200 {
		t.Fatal("provision")
	}
	ws, _, _ := s.workspaceOf(org)
	u, ok := hub.BillingURL(context.Background(), ws)
	if !ok || u != s.hub.URL+"/orgs/org/billing" {
		t.Fatalf("billing url: %q %v", u, ok)
	}
	_, uid, _ := signup(t, s.a, s.srv.URL, "polar")
	if _, ok := hub.BillingURL(context.Background(), s.plainWorkspace(uid)); ok {
		t.Fatal("an unlinked workspace must keep Polar")
	}
	// The API answers for a linked workspace's owner.
	res, to, err := s.login("sub-"+rnd(), own+"@example.test", true, org, "owner", "sid-"+rnd())
	if err != nil || to == "" {
		t.Fatal(err)
	}
	req, _ := http.NewRequest(http.MethodGet, s.srv.URL+"/api/w/billing", nil)
	req.AddCookie(sessionCookie(res))
	req.Header.Set("X-Workspace-ID", ws)
	r, rerr := http.DefaultClient.Do(req)
	if rerr != nil {
		t.Fatal(rerr)
	}
	defer r.Body.Close()
	var out struct {
		HubLinked     bool   `json:"hub_linked"`
		HubBillingURL string `json:"hub_billing_url"`
	}
	_ = json.NewDecoder(r.Body).Decode(&out)
	if r.StatusCode != 200 || !out.HubLinked || out.HubBillingURL != u {
		t.Fatalf("GET /api/w/billing: %d %+v", r.StatusCode, out)
	}
}

// session.revoked ends the Mahaam session that came from that hub session, and only that one.
func TestCircleXOSessionRevoked(t *testing.T) {
	s := bootHub(t)
	_, uid, email := signup(t, s.a, s.srv.URL, "sess")
	s.a.SysDB.Exec(`INSERT INTO platform_users (user_id, email_verified_at) VALUES ($1, now()) ON CONFLICT (user_id) DO UPDATE SET email_verified_at = now()`, uid)
	sub := "sub-" + rnd()
	res1, _, err := s.login(sub, email, true, "", "", "sid-a-"+rnd())
	if err != nil {
		t.Fatal(err)
	}
	// Distinct iat: the marker is (user, iat) at one-second resolution.
	time.Sleep(1100 * time.Millisecond)
	sidB := "sid-b-" + rnd()
	res2, _, err := s.login(sub, email, true, "", "", sidB)
	if err != nil {
		t.Fatal(err)
	}
	a, b := sessionCookie(res1), sessionCookie(res2)
	if s.me(a) != 200 || s.me(b) != 200 {
		t.Fatal("both sessions should work")
	}
	time.Sleep(1100 * time.Millisecond) // a different second again, or the iat marker would match
	pw := newClient(t, s.srv.URL)
	pw.must("POST", "/api/auth/login", map[string]string{"email": email, "password": "correct-horse-9"}, 200)

	if code := s.event(webhooks.SessionRevoked, "", map[string]any{"user": map[string]any{"id": sub}, "sid": sidB}, "sr-"+rnd()); code != http.StatusNoContent {
		t.Fatalf("session.revoked: %d", code)
	}
	if s.me(b) != http.StatusUnauthorized {
		t.Fatal("the revoked session still works")
	}
	if s.me(a) != 200 {
		t.Fatal("another hub session was revoked too")
	}
	pw.must("GET", "/api/auth/me", nil, 200) // a password session of the same user is untouched
}

// Federated MCP: a hub-issued token reaches /api/mcp as a Mahaam principal.
func TestCircleXOMCP(t *testing.T) {
	s := bootHub(t)
	org := hubOrg()
	ownerEmail := "own-" + rnd()
	s.install(org, [2]string{ownerEmail, "owner"})
	if code, _ := s.provision(org); code != 200 {
		t.Fatal("provision")
	}
	ws, _, _ := s.workspaceOf(org)
	s.hub.Lock()
	s.hub.Entitlements[org] = circlexo.Entitlements{OrgID: org, AppID: testHubApp, Active: true, Plan: "pro", Status: "active", Version: 1, Features: []circlexo.Entitlement{
		{Key: "projects", Kind: "limit", Enabled: true}, {Key: "members", Kind: "limit", Enabled: true},
	}}
	s.hub.Unlock()
	sub := "sub-" + rnd()
	if _, _, err := s.login(sub, ownerEmail+"@example.test", true, org, "owner", "sid-"+rnd()); err != nil {
		t.Fatal(err)
	}
	call := func(token, tool string, args map[string]any) (int, string, bool) {
		c := newClient(t, s.srv.URL)
		c.bearer = token
		return mcpCall(c, "/api/mcp", tool, args)
	}

	// A token naming a tool scope gets exactly that scope.
	readTok := s.hub.AccessToken(map[string]any{"sub": sub, "org_id": org, "scope": "openid projects:read"})
	if code, text, isErr := call(readTok, "list_projects", map[string]any{}); code != 200 || isErr {
		t.Fatalf("an allowed tool: %d %v %s", code, isErr, text)
	}
	if code, text, isErr := call(readTok, "create_project", map[string]any{"name": "nope-" + rnd()}); code != 200 || !isErr || !strings.Contains(text, "projects:write") {
		t.Fatalf("a tool outside the token's scopes must be refused in-band, naming the scope: %d %v %q", code, isErr, text)
	}

	// A token from the hub gateway (it carries an act chain) gets the working set, and the actor is
	// recorded on what it changes.
	agentTok := s.hub.AccessToken(map[string]any{"sub": sub, "org_id": org, "act": map[string]any{"sub": "gateway-1", "agent_id": "agent-7"}})
	name := "hub-" + rnd()
	code, text, isErr := call(agentTok, "create_project", map[string]any{"name": name})
	if code != 200 || isErr {
		t.Fatalf("agent create_project: %d %v %s", code, isErr, text)
	}
	var actors string
	err := s.a.SysDB.QueryRow(`SELECT changes::text FROM activity_logs WHERE workspace_id = $1 AND actor_via = 'mcp' AND changes::text LIKE '%hub_actors%' ORDER BY created_at DESC LIMIT 1`, ws).Scan(&actors)
	if err != nil || !strings.Contains(actors, "gateway-1") {
		t.Fatalf("the actor chain was not recorded: %q %v", actors, err)
	}

	// Unknown org, unlinked user, wrong audience, bad signature: all refused.
	deny := func(what, token string, wantHTTP int) {
		t.Helper()
		if code, text, _ := call(token, "list_projects", map[string]any{}); code != wantHTTP {
			t.Fatalf("%s: got %d %q want %d", what, code, text, wantHTTP)
		}
	}
	deny("unknown org", s.hub.AccessToken(map[string]any{"sub": sub, "org_id": "org-unknown-" + rnd(), "scope": "projects:read"}), http.StatusForbidden)
	deny("unlinked user", s.hub.AccessToken(map[string]any{"sub": "nobody-" + rnd(), "org_id": org, "scope": "projects:read"}), http.StatusForbidden)
	deny("no org", s.hub.AccessToken(map[string]any{"sub": sub, "org_id": nil, "scope": "projects:read"}), http.StatusForbidden)
	deny("wrong audience", s.hub.AccessToken(map[string]any{"sub": sub, "org_id": org, "aud": "some-other-app"}), http.StatusUnauthorized)
	deny("garbage", "not-a-token", http.StatusUnauthorized)
	deny("service token", s.hub.AccessToken(map[string]any{"sub": s.hub.ClientID, "org_id": org}), http.StatusUnauthorized)

	// A deinstalled org is refused too.
	s.event(webhooks.AppRemoved, org, map[string]any{}, "mcp-rm-"+rnd())
	deny("deprovisioned org", readTok, http.StatusForbidden)

	// The protected-resource document lists the hub as an authorization server.
	code2, body := s.get("/.well-known/oauth-protected-resource")
	if code2 != 200 || !strings.Contains(string(body), s.hub.URL) {
		t.Fatalf("protected resource metadata: %d %s", code2, body)
	}
}

// With no CIRCLEXO_ISSUER the integration is off: the config says so and the routes are absent.
func TestCircleXODisabled(t *testing.T) {
	t.Setenv("CIRCLEXO_ISSUER", "")
	_, srv := bootStack(t)
	res, err := http.Get(srv.URL + hub.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || strings.TrimSpace(string(b)) != `{"enabled":false}` {
		t.Fatalf("config: %d %s", res.StatusCode, b)
	}
	for _, p := range []string{hub.LoginPath, hub.LaunchPath} {
		r, _ := http.Get(srv.URL + p)
		r.Body.Close()
		if r.StatusCode != http.StatusNotFound {
			t.Fatalf("%s should not exist with the integration off: %d", p, r.StatusCode)
		}
	}
	if hub.Current() != nil {
		t.Fatal("Current must be nil when off")
	}
	_ = fmt.Sprint
}

// MH-1149: deleting the org's workspace in Mahaam is final. The next sign-in does not make a new
// one; it tells the hub, which shows the app as not installed until it is installed again.
func TestCircleXONoRecreate(t *testing.T) {
	s := bootHub(t)
	org := hubOrg()
	s.install(org, [2]string{"own-" + rnd(), "owner"})
	sub, email := "sub-"+rnd(), "keep-"+rnd()+"@example.test"
	if _, _, err := s.login(sub, email, true, org, "owner", "sid-"+rnd()); err != nil {
		t.Fatal(err)
	}
	ws, _, _ := s.workspaceOf(org)

	// A lost link (the workspace is still there) is restored, not replaced.
	if _, err := s.a.SysDB.Exec(`DELETE FROM circlexo_org_links WHERE org_id = $1`, org); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.login(sub, email, true, org, "owner", "sid-"+rnd()); err != nil {
		t.Fatal(err)
	}
	if again, _, _ := s.workspaceOf(org); again != ws {
		t.Fatalf("relink made a new workspace: %s, had %s", again, ws)
	}

	// The workspace is deleted: the sign-in lands home and creates nothing.
	if _, err := s.a.SysDB.Exec(`DELETE FROM workspaces WHERE id = $1`, ws); err != nil {
		t.Fatal(err)
	}
	before := s.count(`SELECT count(*) FROM workspaces`)
	if _, to, err := s.login(sub, email, true, org, "owner", "sid-"+rnd()); err != nil || to != "/" {
		t.Fatalf("after delete: %q %v", to, err)
	}
	if s.count(`SELECT count(*) FROM workspaces`) != before || s.count(`SELECT count(*) FROM circlexo_org_links WHERE org_id = $1`, org) != 0 {
		t.Fatal("a sign-in re-created the deleted workspace")
	}
	s.hub.Lock()
	t2, still := s.hub.Tenants[org]
	s.hub.Unlock()
	if still && t2.Status != "removed" {
		t.Fatalf("the hub was not told: tenant %q", t2.Status)
	}

	// Installing again from the hub provisions a fresh one.
	s.hub.Install(org)
	if _, _, err := s.login(sub, email, true, org, "owner", "sid-"+rnd()); err != nil {
		t.Fatal(err)
	}
	if fresh, _, _ := s.workspaceOf(org); fresh == ws {
		t.Fatal("reinstall reused the deleted workspace id")
	}
}

// MH-1149: the hub owns the person's name, address, language and timezone; every sign-in and
// every user.updated copies them onto the linked Mahaam account.
func TestCircleXOProfileSync(t *testing.T) {
	s := bootHub(t)
	sub, email := "sub-"+rnd(), "prof-"+rnd()+"@example.test"
	id := &circlexo.Claims{Subject: sub, SessionID: "sid-" + rnd(), Raw: map[string]any{
		"email": email, "email_verified": true, "name": "Hub Name", "locale": "ar", "zoneinfo": "Africa/Cairo",
	}}
	if _, err := s.svc.FinishLogin(context.Background(), httptest.NewRecorder(), &oidc.Login{IDClaims: id, AccessClaims: &circlexo.Claims{Subject: sub}}); err != nil {
		t.Fatal(err)
	}
	profile := func() (name, locale, tz, mail string) {
		t.Helper()
		err := s.a.SysDB.QueryRow(`SELECT p.name, coalesce(p.locale, ''), coalesce(p.timezone, ''), u.email
			FROM circlexo_user_links l JOIN users u ON u.id = l.user_id JOIN user_profiles p ON p.user_id = l.user_id
			WHERE l.subject = $1`, sub).Scan(&name, &locale, &tz, &mail)
		if err != nil {
			t.Fatal(err)
		}
		return
	}
	if n, l, z, m := profile(); n != "Hub Name" || l != "ar" || z != "Africa/Cairo" || m != email {
		t.Fatalf("sign-in sync: %q %q %q %q", n, l, z, m)
	}

	// A verified new address on the hub moves the account, and the next sign-in still lands in it.
	moved := "moved-" + rnd() + "@example.test"
	user := map[string]any{"id": sub, "email": moved, "email_verified": true, "display_name": "Renamed", "locale": "en", "timezone": "Asia/Dubai"}
	if code := s.event(webhooks.UserUpdated, hubOrg(), map[string]any{"user": user}, "evt-"+rnd()); code != http.StatusOK && code != http.StatusNoContent {
		t.Fatalf("user.updated: %d", code)
	}
	if n, l, z, m := profile(); n != "Renamed" || l != "en" || z != "Asia/Dubai" || m != moved {
		t.Fatalf("user.updated sync: %q %q %q %q", n, l, z, m)
	}
	id.Raw["email"], id.Raw["name"] = moved, "Renamed"
	if _, err := s.svc.FinishLogin(context.Background(), httptest.NewRecorder(), &oidc.Login{IDClaims: id, AccessClaims: &circlexo.Claims{Subject: sub}}); err != nil {
		t.Fatalf("sign-in after the address moved: %v", err)
	}

	// An unverified or taken address is not taken.
	user["email"], user["email_verified"] = "unverified-"+rnd()+"@example.test", false
	s.event(webhooks.UserUpdated, hubOrg(), map[string]any{"user": user}, "evt-"+rnd())
	if _, _, _, m := profile(); m != moved {
		t.Fatalf("an unverified address replaced the account's: %q", m)
	}
}
