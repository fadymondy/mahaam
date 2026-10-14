package integrations

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
Hosbah hosting. A project is linked to one or more Hosbah apps of one Hosbah team (MH-1194: its
web, api and mcp are each an app); its customers open those apps' hosting panels from the portal.

Connecting is OAuth (hosbah_oauth.go): through the manager's CircleXO account (the hub issues a
token for Hosbah with Mahaam as the actor; it lists their apps, they pick some and Hosbah mints a
token scoped to each app, hba_…) or through Hosbah's own OAuth (the apps are picked on Hosbah's
consent screen and the token endpoint returns one app token each). The project keeps one hosbah
row: config.apps lists the apps (the top-level app_* fields mirror the first, as before MH-1194)
and the sealed secret is the JSON map {app id: app token}. A secret that is a bare token is a link
from before MH-1194, for config.app_id.

The Hosbah side of the contract (Hosbah's /api/integrations/*):

	GET    /api/integrations/apps                 Bearer hub token → {apps: [App]}
	POST   /api/integrations/apps/{app}/tokens    Bearer hub token  {label} → {token: "hba_…", app: App}
	GET    /api/integrations/app                  Bearer hba_  → {app: App, deployments: [Deployment]}
	POST   /api/integrations/app/deployments      Bearer hba_  → {deployment: Deployment}
	POST   /api/integrations/app/panel-sessions   Bearer hba_  {email, name, locale} → {url, expires_at}
	DELETE /api/integrations/app/token            Bearer hba_  → 204
	GET    /oauth/authorize, POST /oauth/token    authorization code + PKCE →
	                                              {access_token: "hba_…", app, apps: [{access_token, app}]}

panel-sessions returns a single-use, short-lived link that signs the person into the app's page of
the server's customer panel (/{locale}/panel/{server}/apps/{app}) and nothing else. Errors are
Huma problem documents ({detail}).

The base URL is HOSBAH_URL (the server calls it; it is never taken from a request).
*/

// HosbahApp is a Hosbah app as Hosbah describes it.
type HosbahApp struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Title      *string  `json:"title,omitempty"`
	Status     string   `json:"status" doc:"new, deploying, running, failed or stopped"`
	ServerID   string   `json:"server_id"`
	ServerName string   `json:"server_name,omitempty"`
	Domains    []string `json:"domains"`
	LogoURL    *string  `json:"logo_url,omitempty"`
	PanelURL   string   `json:"panel_url,omitempty" doc:"The app's page in the server's customer panel"`
}

// HosbahDeployment is one deploy of the app.
type HosbahDeployment struct {
	ID         string     `json:"id"`
	Number     int        `json:"number"`
	Kind       string     `json:"kind" doc:"deploy, restart or rollback"`
	Status     string     `json:"status"`
	Ref        string     `json:"ref,omitempty"`
	Commit     string     `json:"commit,omitempty"`
	Message    string     `json:"message,omitempty"`
	QueuedAt   time.Time  `json:"queued_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

// HosbahAppsInput lists the apps the caller's CircleXO sign-in can see on Hosbah.
type HosbahAppsInput struct {
	Pending string `json:"pending" doc:"The sealed CircleXO sign-in from the connect redirect (#hosbah=…); never a raw token"`
}

// HosbahInput links the project to Hosbah apps.
type HosbahInput struct {
	HosbahAppsInput
	App  string   `json:"app,omitempty" doc:"A Hosbah app id (or apps)"`
	Apps []string `json:"apps,omitempty" maxItems:"20" doc:"The Hosbah app ids to link (web, api, mcp…); replaces the linked set"`
}

// HostingApp is one linked app with its recent deployments. Error says why Hosbah did not answer
// for it (App is then the last synced copy).
type HostingApp struct {
	App         HosbahApp          `json:"app"`
	Deployments []HosbahDeployment `json:"deployments"`
	Error       string             `json:"error,omitempty"`
}

// Hosting is the project's linked apps. App and Deployments repeat the first app's.
type Hosting struct {
	App         HosbahApp          `json:"app"`
	Deployments []HosbahDeployment `json:"deployments"`
	Apps        []HostingApp       `json:"apps"`
}

// PortalHostingApp is one linked app as a customer sees it.
type PortalHostingApp struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Status  string   `json:"status"`
	Domains []string `json:"domains"`
}

// PortalHosting is what a customer sees of the hosting. Connected=false when the project has none.
// Name, Status and Domains repeat the first app's.
type PortalHosting struct {
	Connected bool               `json:"connected"`
	Name      string             `json:"name,omitempty"`
	Status    string             `json:"status,omitempty"`
	Domains   []string           `json:"domains"`
	Apps      []PortalHostingApp `json:"apps"`
	CanOpen   bool               `json:"can_open" doc:"The caller may open the hosting panel (the project's client contacts, managers and up)"`
}

// PanelLink is a one-time auto-login link into the hosting panel.
type PanelLink struct {
	URL       string     `json:"url"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

// ---- client ---------------------------------------------------------------------------

type hosbahClient struct {
	base, token string
	http        *http.Client
}

func (c *hosbahClient) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return &UpstreamError{Status: http.StatusBadGateway, Msg: "Hosbah is unreachable"}
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		var p struct {
			Detail  string `json:"detail"`
			Title   string `json:"title"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &p)
		msg := p.Detail
		if msg == "" {
			msg = p.Message
		}
		if msg == "" {
			msg = p.Title
		}
		switch {
		case res.StatusCode == http.StatusUnauthorized:
			msg = "Hosbah refused the token (revoked or expired) — connect Hosbah again"
		case res.StatusCode == http.StatusNotFound && msg == "":
			msg = "Hosbah does not know that app, or this Hosbah has no integrations API yet"
		case msg == "":
			msg = res.Status
		}
		return &UpstreamError{Status: res.StatusCode, Msg: "Hosbah: " + msg}
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &UpstreamError{Status: http.StatusBadGateway, Msg: "Hosbah sent an unexpected response"}
	}
	return nil
}

func (c *hosbahClient) apps(ctx context.Context) ([]HosbahApp, error) {
	var out struct {
		Apps []HosbahApp `json:"apps"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/integrations/apps", nil, &out); err != nil {
		return nil, err
	}
	return normApps(out.Apps), nil
}

func (c *hosbahClient) mint(ctx context.Context, app, label string) (string, *HosbahApp, error) {
	var out struct {
		Token string    `json:"token"`
		App   HosbahApp `json:"app"`
	}
	if err := c.do(ctx, http.MethodPost, "/api/integrations/apps/"+url.PathEscape(app)+"/tokens", map[string]string{"label": label}, &out); err != nil {
		return "", nil, err
	}
	if out.Token == "" || out.App.ID == "" {
		return "", nil, &UpstreamError{Status: http.StatusBadGateway, Msg: "Hosbah did not return an app token"}
	}
	a := normApps([]HosbahApp{out.App})[0]
	return out.Token, &a, nil
}

func (c *hosbahClient) app(ctx context.Context) (*HostingApp, error) {
	var out HostingApp
	if err := c.do(ctx, http.MethodGet, "/api/integrations/app", nil, &out); err != nil {
		return nil, err
	}
	out.App = normApps([]HosbahApp{out.App})[0]
	if out.Deployments == nil {
		out.Deployments = []HosbahDeployment{}
	}
	return &out, nil
}

func normApps(l []HosbahApp) []HosbahApp {
	if l == nil {
		return []HosbahApp{}
	}
	for i := range l {
		if l[i].Domains == nil {
			l[i].Domains = []string{}
		}
	}
	return l
}

func (sv *Service) hosbah(base, token string) *hosbahClient {
	return &hosbahClient{base: base, token: token, http: sv.HTTP}
}

// hosbahLinked is one app being linked, with its app token.
type hosbahLinked struct {
	Token string
	App   HosbahApp
}

// hosbahTokens opens r's app tokens by app id.
func (sv *Service) hosbahTokens(r *row) (map[string]string, error) {
	raw, err := sv.secret(r)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(raw, "{") {
		return map[string]string{r.cfg("app_id"): raw}, nil // linked before MH-1194
	}
	var m map[string]string
	if json.Unmarshal([]byte(raw), &m) != nil || len(m) == 0 {
		return nil, invalid("the stored Hosbah tokens cannot be read — reconnect Hosbah")
	}
	return m, nil
}

// hosbahLinkedApps is r's linked apps in link order, as last synced.
func hosbahLinkedApps(r *row) []HosbahApp {
	var out []HosbahApp
	if l, ok := r.Config["apps"].([]any); ok && len(l) > 0 {
		b, _ := json.Marshal(l)
		_ = json.Unmarshal(b, &out)
	}
	if len(out) == 0 && r.cfg("app_id") != "" { // linked before MH-1194
		a := HosbahApp{ID: r.cfg("app_id"), Name: r.cfg("app_name"), Status: r.cfg("app_status"), ServerID: r.cfg("server_id"),
			ServerName: r.cfg("server_name"), PanelURL: r.cfg("panel_url")}
		if t := r.cfg("app_title"); t != "" {
			a.Title = &t
		}
		if d, ok := r.Config["domains"].([]any); ok {
			for _, v := range d {
				if s, ok := v.(string); ok {
					a.Domains = append(a.Domains, s)
				}
			}
		}
		out = []HosbahApp{a}
	}
	return normApps(out)
}

// appClient opens the app token of one of r's apps: app (an id), or the first when empty.
func (sv *Service) appClient(r *row, app string) (*hosbahClient, *HosbahApp, error) {
	base := r.cfg("base_url")
	if base == "" {
		return nil, nil, invalid("the Hosbah integration has no base_url — reconnect it")
	}
	apps := hosbahLinkedApps(r)
	var a *HosbahApp
	for i := range apps {
		if app == "" || apps[i].ID == app {
			a = &apps[i]
			break
		}
	}
	if a == nil {
		return nil, nil, notFound("hosting app")
	}
	toks, err := sv.hosbahTokens(r)
	if err != nil {
		return nil, nil, err
	}
	tok := toks[a.ID]
	if tok == "" {
		return nil, nil, invalid("no app token is stored for %s — reconnect Hosbah", appTitle(a))
	}
	return sv.hosbah(base, tok), a, nil
}

// appTitle is the app's title, or its name.
func appTitle(a *HosbahApp) string {
	if a.Title != nil && strings.TrimSpace(*a.Title) != "" {
		return *a.Title
	}
	return a.Name
}

// hosbahConfig is the row's config for the linked apps (the first mirrored at the top level).
func hosbahConfig(base string, apps []HosbahApp) map[string]any {
	apps = normApps(apps)
	cfg := map[string]any{"base_url": base, "apps": apps}
	if len(apps) > 0 {
		a := &apps[0]
		cfg["app_id"], cfg["app_name"], cfg["app_title"] = a.ID, a.Name, appTitle(a)
		cfg["server_id"], cfg["server_name"], cfg["panel_url"] = a.ServerID, a.ServerName, a.PanelURL
		cfg["app_status"], cfg["domains"] = a.Status, a.Domains
	}
	return cfg
}

// pickedApps is the app ids of a link request, in order and once each.
func pickedApps(app string, apps []string) []string {
	if len(apps) == 0 && strings.TrimSpace(app) != "" {
		apps = []string{app}
	}
	out := make([]string, 0, len(apps))
	seen := map[string]bool{}
	for _, a := range apps {
		if a = strings.TrimSpace(a); a != "" && !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
	}
	return out
}

// ---- connect -------------------------------------------------------------------------

// pendingClient opens the caller's pending CircleXO sign-in as a Hosbah client (manager+).
func (sv *Service) pendingClient(ctx context.Context, projectRef, pending string) (*tenant.Scope, *work.Project, *hosbahClient, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, nil, nil, err
	}
	if err := limits.Integration(ctx, s.WorkspaceID, "hosbah"); err != nil {
		return nil, nil, nil, err
	}
	base := hosbahURL()
	if base == "" {
		return nil, nil, nil, conflict("Hosbah is not configured on this server (HOSBAH_URL)")
	}
	pd, err := openPending(pending, s, p.ID, time.Now())
	if err != nil {
		return nil, nil, nil, err
	}
	return s, p, sv.hosbah(base, pd.Token), nil
}

// HosbahApps lists the Hosbah apps the caller's CircleXO sign-in can see (manager+).
func (sv *Service) HosbahApps(ctx context.Context, projectRef string, in HosbahAppsInput) ([]HosbahApp, error) {
	_, _, c, err := sv.pendingClient(ctx, projectRef, in.Pending)
	if err != nil {
		return nil, err
	}
	l, err := c.apps(ctx)
	if err != nil {
		return nil, upstream(err)
	}
	return l, nil
}

// ConnectHosbah links the project to Hosbah apps after a CircleXO sign-in (manager+): Hosbah
// mints a token scoped to each app, stored sealed. The apps picked replace the linked set.
func (sv *Service) ConnectHosbah(ctx context.Context, projectRef string, in HosbahInput) (*Integration, error) {
	apps := pickedApps(in.App, in.Apps)
	if len(apps) == 0 {
		return nil, invalid("apps is required (the Hosbah app ids)")
	}
	for _, a := range apps {
		if len(a) > 100 {
			return nil, invalid("%q is not a Hosbah app id", a)
		}
	}
	s, p, c, err := sv.pendingClient(ctx, projectRef, in.Pending)
	if err != nil {
		return nil, err
	}
	links := make([]hosbahLinked, 0, len(apps))
	for _, app := range apps {
		tok, a, err := c.mint(ctx, app, "Mahaam · "+p.Name)
		if err != nil {
			for _, l := range links { // don't leave the ones already minted behind
				sv.revokeToken(ctx, c.base, l.Token, "")
			}
			return nil, upstream(err)
		}
		links = append(links, hosbahLinked{Token: tok, App: *a})
	}
	return sv.linkHosbah(ctx, s, p.ID, c.base, links)
}

// linkHosbah stores the apps and their tokens for the project. Relinking revokes the previous app
// tokens that are not kept.
func (sv *Service) linkHosbah(ctx context.Context, s *tenant.Scope, projectID, base string, links []hosbahLinked) (*Integration, error) {
	if len(links) == 0 {
		return nil, invalid("Hosbah linked no app")
	}
	prev, err := sv.load(ctx, sv.DB, s.WorkspaceID, projectID, "hosbah")
	if err != nil && !isNotFound(err) {
		return nil, err
	}
	toks := make(map[string]string, len(links))
	apps := make([]HosbahApp, 0, len(links))
	keep := map[string]bool{}
	for _, l := range links {
		toks[l.App.ID] = l.Token
		apps = append(apps, l.App)
		keep[l.Token] = true
	}
	b, _ := json.Marshal(toks)
	secret := string(b)
	out, err := sv.connect(ctx, s, projectID, "hosbah", hosbahConfig(base, apps), &secret, "an app token")
	if err != nil {
		return nil, err
	}
	if prev != nil && prev.HasSecret {
		if old, err := sv.hosbahTokens(prev); err == nil {
			for _, tok := range old {
				if !keep[tok] {
					sv.revokeToken(ctx, prev.cfg("base_url"), tok, prev.ID)
				}
			}
		}
	}
	return out, nil
}

// revokeHosbah asks Hosbah to drop every app token of r. Best-effort: a dead Hosbah must not keep
// a project from disconnecting.
func (sv *Service) revokeHosbah(ctx context.Context, r *row) {
	toks, err := sv.hosbahTokens(r)
	if err != nil {
		return
	}
	for _, tok := range toks {
		sv.revokeToken(ctx, r.cfg("base_url"), tok, r.ID)
	}
}

func (sv *Service) revokeToken(ctx context.Context, base, tok, integration string) {
	if base == "" || tok == "" {
		return
	}
	if err := sv.hosbah(base, tok).do(ctx, http.MethodDelete, "/api/integrations/app/token", nil, nil); err != nil && sv.Log != nil {
		sv.Log.Warn("hosbah: revoke app token", "integration", integration, "err", err)
	}
}

// fetchApps reads every linked app live from Hosbah, at once. An app Hosbah does not answer for
// keeps its last synced copy and says why.
func (sv *Service) fetchApps(ctx context.Context, r *row) []HostingApp {
	apps := hosbahLinkedApps(r)
	out := make([]HostingApp, len(apps))
	var wg sync.WaitGroup
	for i := range apps {
		out[i] = HostingApp{App: apps[i], Deployments: []HosbahDeployment{}}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c, _, err := sv.appClient(r, apps[i].ID)
			var h *HostingApp
			if err == nil {
				h, err = c.app(ctx)
			}
			if err != nil {
				out[i].Error = err.Error()
				return
			}
			out[i] = *h
		}(i)
	}
	wg.Wait()
	return out
}

// syncHosbah refreshes the apps' names, statuses and domains on the row.
func (sv *Service) syncHosbah(ctx context.Context, s *tenant.Scope, r *row, res *SyncResult) error {
	fetched := sv.fetchApps(ctx, r)
	apps := make([]HosbahApp, len(fetched))
	var failed error
	for i, h := range fetched {
		apps[i] = h.App
		if h.Error == "" {
			res.Fetched++
		} else if failed == nil {
			failed = &UpstreamError{Status: http.StatusBadGateway, Msg: h.Error}
		}
	}
	if res.Fetched == 0 && failed != nil {
		return failed
	}
	cfg, _ := json.Marshal(hosbahConfig(r.cfg("base_url"), apps))
	if _, err := sv.DB.ExecContext(ctx, `UPDATE project_integrations SET config = $3::jsonb WHERE workspace_id = $1 AND id = $2`,
		s.WorkspaceID, r.ID, string(cfg)); err != nil {
		return err
	}
	return failed
}

// ---- hosting -------------------------------------------------------------------------

// hostingRow loads the project's active Hosbah link.
func (sv *Service) hostingRow(ctx context.Context, s *tenant.Scope, projectID string) (*row, error) {
	r, err := sv.load(ctx, sv.DB, s.WorkspaceID, projectID, "hosbah")
	if err != nil {
		return nil, err
	}
	if r.Status == "disabled" {
		return nil, conflict("the Hosbah integration is disabled — reconnect it first")
	}
	return r, nil
}

// Hosting returns the linked apps live from Hosbah (members+).
func (sv *Service) Hosting(ctx context.Context, projectRef string) (*Hosting, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsRead)
	if err != nil {
		return nil, err
	}
	r, err := sv.hostingRow(ctx, s, p.ID)
	if err != nil {
		return nil, err
	}
	apps := sv.fetchApps(ctx, r)
	if len(apps) == 0 {
		return nil, invalid("no Hosbah app is linked — reconnect Hosbah")
	}
	ok := false
	for _, a := range apps {
		ok = ok || a.Error == ""
	}
	if !ok {
		return nil, upstream(&UpstreamError{Status: http.StatusBadGateway, Msg: apps[0].Error})
	}
	return &Hosting{App: apps[0].App, Deployments: apps[0].Deployments, Apps: apps}, nil
}

// HostingDeploy queues a deploy of one linked app, app (an id) or the first (manager+).
func (sv *Service) HostingDeploy(ctx context.Context, projectRef, app string) (*HosbahDeployment, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	if err := limits.Integration(ctx, s.WorkspaceID, "hosbah"); err != nil {
		return nil, err
	}
	r, err := sv.hostingRow(ctx, s, p.ID)
	if err != nil {
		return nil, err
	}
	c, a, err := sv.appClient(r, app)
	if err != nil {
		return nil, err
	}
	var out struct {
		Deployment HosbahDeployment `json:"deployment"`
	}
	if err := c.do(ctx, http.MethodPost, "/api/integrations/app/deployments", map[string]any{}, &out); err != nil {
		return nil, upstream(err)
	}
	_ = work.RecordActivity(ctx, sv.DB, s, work.ActivityEntry{ProjectID: p.ID, Action: "hosting.deployed",
		SubjectType: "integration", SubjectID: r.ID, Changes: map[string]any{"app": a.Name, "deployment": out.Deployment.Number}})
	return &out.Deployment, nil
}

// portalHostingRow resolves a portal reader's project and its Hosbah link (nil when none).
func (sv *Service) portalHostingRow(ctx context.Context, projectRef string) (*tenant.Scope, *work.Project, *row, error) {
	s, ok := tenant.From(ctx)
	if !ok || s.WorkspaceID == "" || s.UserID == "" {
		return nil, nil, nil, notFound("workspace")
	}
	if !authz.Can(s.Role, authz.PortalRead) {
		return nil, nil, nil, notFound("project")
	}
	if err := limits.Feature(ctx, s.WorkspaceID, limits.FeaturePortal); err != nil {
		return nil, nil, nil, err
	}
	p, err := sv.Work.FindProject(ctx, projectRef)
	if err != nil {
		return nil, nil, nil, err
	}
	r, err := sv.load(ctx, sv.DB, s.WorkspaceID, p.ID, "hosbah")
	if isNotFound(err) || (r != nil && r.Status == "disabled") {
		return s, p, nil, nil
	}
	if err != nil {
		return nil, nil, nil, err
	}
	if limits.Integration(ctx, s.WorkspaceID, "hosbah") != nil {
		return s, p, nil, nil
	}
	return s, p, r, nil
}

// canOpenPanel: the project's client's own portal contacts, or a manager and up.
func (sv *Service) canOpenPanel(ctx context.Context, s *tenant.Scope, p *work.Project) bool {
	if authz.Can(s.Role, authz.IntegrationsManage) {
		return true
	}
	if p.ClientID == nil {
		return false
	}
	mine, err := sv.Work.PortalClientID(ctx)
	return err == nil && mine == *p.ClientID
}

// PortalHosting is the customer's view of the project's hosting. It reads the app's state from
// Hosbah and falls back to the last synced copy when Hosbah does not answer.
func (sv *Service) PortalHosting(ctx context.Context, projectRef string) (*PortalHosting, error) {
	s, p, r, err := sv.portalHostingRow(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return &PortalHosting{Domains: []string{}}, nil
	}
	out := &PortalHosting{Connected: true, Domains: []string{}, Apps: []PortalHostingApp{}, CanOpen: sv.canOpenPanel(ctx, s, p)}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for _, h := range sv.fetchApps(cctx, r) {
		out.Apps = append(out.Apps, PortalHostingApp{ID: h.App.ID, Name: appTitle(&h.App), Status: h.App.Status, Domains: h.App.Domains})
	}
	if len(out.Apps) > 0 {
		out.Name, out.Status, out.Domains = out.Apps[0].Name, out.Apps[0].Status, out.Apps[0].Domains
	}
	return out, nil
}

// PortalHostingPanel mints a one-time link that signs the caller into one linked app's hosting
// panel: app (an id), or the first.
func (sv *Service) PortalHostingPanel(ctx context.Context, projectRef, locale, app string) (*PanelLink, error) {
	s, p, r, err := sv.portalHostingRow(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, notFound("hosting")
	}
	if !sv.canOpenPanel(ctx, s, p) {
		return nil, forbidden("only the project's client and its managers can open the hosting panel")
	}
	email, err := sv.userEmail(ctx, s.UserID)
	if err != nil {
		return nil, err
	}
	if locale != "ar" {
		locale = "en"
	}
	c, a, err := sv.appClient(r, app)
	if err != nil {
		return nil, err
	}
	var out PanelLink
	if err := c.do(ctx, http.MethodPost, "/api/integrations/app/panel-sessions",
		map[string]string{"email": email, "name": nameOf(email), "locale": locale}, &out); err != nil {
		return nil, upstream(err)
	}
	if u, err := url.Parse(out.URL); err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, upstream(errors.New("Hosbah did not return a panel link"))
	}
	_ = work.RecordActivity(ctx, sv.DB, s, work.ActivityEntry{ProjectID: p.ID, Action: "hosting.panel_opened",
		SubjectType: "integration", SubjectID: r.ID, Changes: map[string]any{"app": a.Name}})
	return &out, nil
}

func (sv *Service) userEmail(ctx context.Context, userID string) (string, error) {
	if sv.Sys == nil {
		return "", errors.New("integrations: database unavailable")
	}
	var email string
	err := sv.Sys.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && email == "") {
		return "", notFound("user")
	}
	return email, err
}

// nameOf turns "sara.ali@x.com" into "Sara Ali" for the panel account Hosbah creates.
func nameOf(email string) string {
	local, _, _ := strings.Cut(email, "@")
	parts := strings.FieldsFunc(local, func(r rune) bool { return r == '.' || r == '_' || r == '-' || r == '+' })
	for i, w := range parts {
		parts[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	if len(parts) == 0 {
		return email
	}
	return strings.Join(parts, " ")
}
