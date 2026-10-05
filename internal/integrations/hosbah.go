package integrations

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
Hosbah hosting. A project is linked to ONE Hosbah app; its customers open that app's hosting panel
from the portal.

Connecting is two calls. A manager pastes a Hosbah user token (hbu_…) and Mahaam lists the apps it
can see; they pick one and Mahaam asks Hosbah to mint a token scoped to that app (hba_…). Only the
app token is stored (sealed); the user token is used for those two calls and dropped.

The Hosbah side of the contract (Hosbah's /api/integrations/*):

	GET    /api/integrations/apps                 Bearer hbu_  → {apps: [App]}
	POST   /api/integrations/apps/{app}/tokens    Bearer hbu_  {label} → {token: "hba_…", app: App}
	GET    /api/integrations/app                  Bearer hba_  → {app: App, deployments: [Deployment]}
	POST   /api/integrations/app/deployments      Bearer hba_  → {deployment: Deployment}
	POST   /api/integrations/app/panel-sessions   Bearer hba_  {email, name, locale} → {url, expires_at}
	DELETE /api/integrations/app/token            Bearer hba_  → 204

panel-sessions returns a single-use, short-lived link that signs the person into the app's page of
the server's customer panel (/{locale}/panel/{server}/apps/{app}) and nothing else. Errors are
Huma problem documents ({detail}).

The base URL is HOSBAH_URL; a connect form may name another Hosbah only when its host is listed in
HOSBAH_ALLOWED_HOSTS (the server calls it, so an arbitrary URL would be an SSRF hole).
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

// HosbahAppsInput lists the apps a Hosbah user token can see.
type HosbahAppsInput struct {
	BaseURL string `json:"base_url,omitempty" doc:"The Hosbah to connect to; default HOSBAH_URL"`
	Token   string `json:"token" doc:"A Hosbah user token (hbu_…); used for this call only, never stored"`
}

// HosbahInput links the project to one app.
type HosbahInput struct {
	HosbahAppsInput
	App string `json:"app" doc:"The Hosbah app id"`
}

// Hosting is the project's linked app with its recent deployments.
type Hosting struct {
	App         HosbahApp          `json:"app"`
	Deployments []HosbahDeployment `json:"deployments"`
}

// PortalHosting is what a customer sees of the hosting. Connected=false when the project has none.
type PortalHosting struct {
	Connected bool     `json:"connected"`
	Name      string   `json:"name,omitempty"`
	Status    string   `json:"status,omitempty"`
	Domains   []string `json:"domains"`
	CanOpen   bool     `json:"can_open" doc:"The caller may open the hosting panel (the project's client contacts, managers and up)"`
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
			msg = "Hosbah refused the token (revoked or expired) — reconnect with a new one"
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

func (c *hosbahClient) app(ctx context.Context) (*Hosting, error) {
	var out Hosting
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

// hosbahBase picks the Hosbah to call: HOSBAH_URL, or raw when its host is allowed.
func hosbahBase(raw string) (string, error) {
	env := strings.TrimRight(strings.TrimSpace(os.Getenv("HOSBAH_URL")), "/")
	raw = strings.TrimSpace(raw)
	if raw == "" {
		if env == "" {
			return "", invalid("Hosbah is not configured on this server (HOSBAH_URL) — give base_url")
		}
		return env, nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", invalid("base_url must be your Hosbah, e.g. https://hosbah.example.com")
	}
	host := strings.ToLower(u.Host)
	allowed := false
	if e, err := url.Parse(env); env != "" && err == nil && strings.ToLower(e.Host) == host {
		if u.Scheme == e.Scheme {
			return env, nil
		}
	}
	for _, h := range strings.Split(os.Getenv("HOSBAH_ALLOWED_HOSTS"), ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" && (h == host || h == strings.ToLower(u.Hostname())) {
			allowed = true
		}
	}
	if !allowed {
		return "", invalid("base_url must be this server's Hosbah (HOSBAH_URL) or a host listed in HOSBAH_ALLOWED_HOSTS")
	}
	if u.Scheme != "https" {
		return "", invalid("base_url must use https")
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		return "", invalid("base_url must be a host name")
	}
	return "https://" + u.Host, nil
}

func (sv *Service) hosbah(base, token string) *hosbahClient {
	return &hosbahClient{base: base, token: token, http: sv.HTTP}
}

// appClient opens the stored app token of r.
func (sv *Service) appClient(r *row) (*hosbahClient, error) {
	tok, err := sv.secret(r)
	if err != nil {
		return nil, err
	}
	base := r.cfg("base_url")
	if base == "" {
		return nil, invalid("the Hosbah integration has no base_url — reconnect it")
	}
	return sv.hosbah(base, tok), nil
}

func hosbahConfig(base string, a *HosbahApp) map[string]any {
	name := a.Name
	if a.Title != nil && strings.TrimSpace(*a.Title) != "" {
		name = *a.Title
	}
	return map[string]any{"base_url": base, "app_id": a.ID, "app_name": a.Name, "app_title": name,
		"server_id": a.ServerID, "server_name": a.ServerName, "panel_url": a.PanelURL,
		"app_status": a.Status, "domains": a.Domains}
}

// ---- connect -------------------------------------------------------------------------

// HosbahApps lists the apps a Hosbah user token can see (manager+). The token is not stored.
func (sv *Service) HosbahApps(ctx context.Context, projectRef string, in HosbahAppsInput) ([]HosbahApp, error) {
	s, _, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	if err := limits.Integration(ctx, s.WorkspaceID, "hosbah"); err != nil {
		return nil, err
	}
	base, err := hosbahBase(in.BaseURL)
	if err != nil {
		return nil, err
	}
	tok := strings.TrimSpace(in.Token)
	if tok == "" {
		return nil, invalid("token is required (a Hosbah user token, hbu_…)")
	}
	l, err := sv.hosbah(base, tok).apps(ctx)
	if err != nil {
		return nil, upstream(err)
	}
	return l, nil
}

// ConnectHosbah links the project to one Hosbah app (manager+): Hosbah mints a token scoped to
// that app, which is stored sealed. Relinking revokes the previous app token.
func (sv *Service) ConnectHosbah(ctx context.Context, projectRef string, in HosbahInput) (*Integration, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	if err := limits.Integration(ctx, s.WorkspaceID, "hosbah"); err != nil {
		return nil, err
	}
	base, err := hosbahBase(in.BaseURL)
	if err != nil {
		return nil, err
	}
	tok, app := strings.TrimSpace(in.Token), strings.TrimSpace(in.App)
	if tok == "" {
		return nil, invalid("token is required (a Hosbah user token, hbu_…)")
	}
	if app == "" || len(app) > 100 {
		return nil, invalid("app is required (the Hosbah app id)")
	}
	prev, err := sv.load(ctx, sv.DB, s.WorkspaceID, p.ID, "hosbah")
	if err != nil && !isNotFound(err) {
		return nil, err
	}
	appTok, a, err := sv.hosbah(base, tok).mint(ctx, app, "Mahaam · "+p.Name)
	if err != nil {
		return nil, upstream(err)
	}
	out, err := sv.connect(ctx, s, p.ID, "hosbah", hosbahConfig(base, a), &appTok, "an app token")
	if err != nil {
		return nil, err
	}
	if prev != nil {
		sv.revokeHosbah(ctx, prev)
	}
	return out, nil
}

// revokeHosbah asks Hosbah to drop r's app token. Best-effort: a dead Hosbah must not keep a
// project from disconnecting.
func (sv *Service) revokeHosbah(ctx context.Context, r *row) {
	c, err := sv.appClient(r)
	if err != nil {
		return
	}
	if err := c.do(ctx, http.MethodDelete, "/api/integrations/app/token", nil, nil); err != nil {
		sv.Log.Warn("hosbah: revoke app token", "integration", r.ID, "err", err)
	}
}

// syncHosbah refreshes the app's name, status and domains on the row.
func (sv *Service) syncHosbah(ctx context.Context, s *tenant.Scope, r *row, res *SyncResult) error {
	c, err := sv.appClient(r)
	if err != nil {
		return err
	}
	h, err := c.app(ctx)
	if err != nil {
		return err
	}
	res.Fetched = 1
	cfg, _ := json.Marshal(hosbahConfig(r.cfg("base_url"), &h.App))
	_, err = sv.DB.ExecContext(ctx, `UPDATE project_integrations SET config = $3::jsonb WHERE workspace_id = $1 AND id = $2`,
		s.WorkspaceID, r.ID, string(cfg))
	return err
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

// Hosting returns the linked app live from Hosbah (members+).
func (sv *Service) Hosting(ctx context.Context, projectRef string) (*Hosting, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsRead)
	if err != nil {
		return nil, err
	}
	r, err := sv.hostingRow(ctx, s, p.ID)
	if err != nil {
		return nil, err
	}
	c, err := sv.appClient(r)
	if err != nil {
		return nil, err
	}
	h, err := c.app(ctx)
	if err != nil {
		return nil, upstream(err)
	}
	return h, nil
}

// HostingDeploy queues a deploy of the linked app (manager+).
func (sv *Service) HostingDeploy(ctx context.Context, projectRef string) (*HosbahDeployment, error) {
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
	c, err := sv.appClient(r)
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
		SubjectType: "integration", SubjectID: r.ID, Changes: map[string]any{"app": r.cfg("app_name"), "deployment": out.Deployment.Number}})
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
	out := &PortalHosting{Connected: true, Name: r.cfg("app_title"), Status: r.cfg("app_status"), Domains: []string{},
		CanOpen: sv.canOpenPanel(ctx, s, p)}
	if out.Name == "" {
		out.Name = r.cfg("app_name")
	}
	if d, ok := r.Config["domains"].([]any); ok {
		for _, v := range d {
			if str, ok := v.(string); ok {
				out.Domains = append(out.Domains, str)
			}
		}
	}
	if c, err := sv.appClient(r); err == nil {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if h, err := c.app(cctx); err == nil {
			out.Status, out.Domains = h.App.Status, h.App.Domains
		}
	}
	return out, nil
}

// PortalHostingPanel mints a one-time link that signs the caller into the app's hosting panel.
func (sv *Service) PortalHostingPanel(ctx context.Context, projectRef, locale string) (*PanelLink, error) {
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
	c, err := sv.appClient(r)
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
		SubjectType: "integration", SubjectID: r.ID, Changes: map[string]any{"app": r.cfg("app_name")}})
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
