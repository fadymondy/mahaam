// Package integrations connects a Mahaam project to GitHub (a GitHub App: issues both ways,
// pull requests, commits, workflow runs, deployments, workflow_dispatch deploys, webhooks),
// Jira (issue import), Linear (issue import) and Hosbah (hosting: one app per project, opened
// by the customer from the portal — hosbah.go).
//
// Authorization follows internal/work: the caller comes from tenant.Scope on ctx (session or
// MCP token), the project must be visible to them (work.FindProject — 404 otherwise), and the
// action is checked against authz.Matrix (integrations:read member+, integrations:manage
// manager+, github:issues member+, github:deploy manager+). Every query runs on the RLS app
// pool and still carries `workspace_id = $1`. The public webhook and install callback resolve
// their integration on the owner pool with explicit predicates, then act through the app pool
// under a system scope of that integration's workspace.
//
// Credentials (Jira API token, Linear API key) are sealed with internal/secretbox and never
// returned. Imported issues are rows of `reports` (Mahaam issues, MG-n) carrying
// external_source / external_id / external_key / external_url; a unique index on
// (workspace_id, external_source, external_id) makes a re-import an update.
package integrations

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/secretbox"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

// Providers are the integrations a project can have (one of each).
var Providers = []string{"github", "jira", "linear", "hosbah"}

// Service carries the handles the integrations need.
type Service struct {
	DB   *sql.DB // app pool (RLS)
	Sys  *sql.DB // owner pool — webhook/callback routing and the scheduler's cross-workspace scan only
	Log  *slog.Logger
	Work *work.Service
	HTTP *http.Client
	// GitHub returns the App (nil + ErrGitHubNotConfigured when absent). Tests replace it.
	GitHub func() (*GitHubApp, error)
	// LinearURL is the Linear GraphQL endpoint (tests point it at an httptest server).
	LinearURL string
}

// New builds the service. a may be nil (OpenAPI export).
func New(a *app.App) *Service {
	sv := &Service{HTTP: &http.Client{Timeout: 30 * time.Second}, GitHub: GitHub, LinearURL: linearURL, Log: slog.Default()}
	if a == nil {
		sv.Work = work.New(nil)
		return sv
	}
	sv.DB, sv.Sys, sv.Work = a.SQLDB, a.SysDB, work.New(a)
	if a.Log != nil {
		sv.Log = a.Log
	}
	return sv
}

// Integration is a project's connection to one provider, as the API returns it. The sealed
// credential is never included — only whether one is stored.
type Integration struct {
	ID           string         `json:"id"`
	ProjectID    string         `json:"project_id"`
	Provider     string         `json:"provider" doc:"github, jira, linear or hosbah"`
	Status       string         `json:"status" doc:"pending, active, error or disabled"`
	Config       map[string]any `json:"config" doc:"Non-secret settings (repo, installation_id, base_url, project_key, jql, email, team_id, app_id, app_name, server_id, panel_url)"`
	HasSecret    bool           `json:"has_secret"`
	LastSyncedAt *time.Time     `json:"last_synced_at"`
	LastError    *string        `json:"last_error"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

// row is an integration with the fields the API does not return.
type row struct {
	Integration
	WorkspaceID string
	Secret      *string
	CreatedBy   *string
}

func (r *row) cfg(k string) string {
	switch v := r.Config[k].(type) {
	case string:
		return v
	case float64:
		return fmt.Sprintf("%.0f", v)
	}
	return ""
}

const cols = `id, workspace_id, project_id, provider, status, config, secret, last_synced_at, last_error, created_by, created_at, updated_at`

func scanRow(sc interface{ Scan(...any) error }) (*row, error) {
	r := &row{}
	var cfg []byte
	if err := sc.Scan(&r.ID, &r.WorkspaceID, &r.ProjectID, &r.Provider, &r.Status, &cfg, &r.Secret,
		&r.LastSyncedAt, &r.LastError, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	r.Config = map[string]any{}
	_ = json.Unmarshal(cfg, &r.Config)
	r.HasSecret = r.Secret != nil && *r.Secret != ""
	return r, nil
}

// ---- errors (work.Error, so work.AsError and the MCP toolErr map them) ----------

func notFound(what string) error {
	return &work.Error{Status: http.StatusNotFound, Msg: what + " not found"}
}
func forbidden(msg string) error { return &work.Error{Status: http.StatusForbidden, Msg: msg} }
func conflict(msg string) error  { return &work.Error{Status: http.StatusConflict, Msg: msg} }
func invalid(format string, args ...any) error {
	return &work.Error{Status: http.StatusUnprocessableEntity, Msg: fmt.Sprintf(format, args...)}
}
func unavailable(err error) error {
	return &work.Error{Status: http.StatusServiceUnavailable, Msg: err.Error()}
}

// upstream turns a provider failure into a caller-safe 502 (the provider's own message).
func upstream(err error) error {
	var we *work.Error
	if errors.As(err, &we) {
		return err
	}
	var ue *UpstreamError
	if errors.As(err, &ue) {
		return &work.Error{Status: http.StatusBadGateway, Msg: ue.Msg}
	}
	return &work.Error{Status: http.StatusBadGateway, Msg: err.Error()}
}

// ---- caller + project -------------------------------------------------------------

// project resolves the caller and a project they can see, then checks action.
func (sv *Service) project(ctx context.Context, ref, action string) (*tenant.Scope, *work.Project, error) {
	s, ok := tenant.From(ctx)
	if !ok || s.WorkspaceID == "" || s.UserID == "" {
		return nil, nil, notFound("workspace")
	}
	p, err := sv.Work.FindProject(ctx, ref)
	if err != nil {
		return nil, nil, err
	}
	if !authz.Can(s.Role, action) {
		return nil, nil, forbidden(fmt.Sprintf("your role (%s) cannot do this (%s)", s.Role, action))
	}
	return s, p, nil
}

func (sv *Service) load(ctx context.Context, q work.Querier, workspaceID, projectID, provider string) (*row, error) {
	r, err := scanRow(q.QueryRowContext(ctx, `SELECT `+cols+` FROM project_integrations
		WHERE workspace_id = $1 AND project_id = $2 AND provider = $3`, workspaceID, projectID, provider))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound(provider + " integration")
	}
	return r, err
}

func validProvider(p string) error {
	for _, v := range Providers {
		if v == p {
			return nil
		}
	}
	return invalid("provider must be one of: %s", strings.Join(Providers, ", "))
}

// List returns a project's integrations (members+ on a visible project).
func (sv *Service) List(ctx context.Context, projectRef string) ([]Integration, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsRead)
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+cols+` FROM project_integrations
		WHERE workspace_id = $1 AND project_id = $2 ORDER BY provider`, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Integration{}
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r.Integration)
	}
	return out, rows.Err()
}

// ---- connect / disconnect ----------------------------------------------------------

// JiraInput connects (or reconfigures) Jira import. APIToken may be omitted on an update to keep
// the stored one.
type JiraInput struct {
	BaseURL    string  `json:"base_url" doc:"https://your-site.atlassian.net"`
	Email      string  `json:"email" doc:"The Atlassian account the API token belongs to"`
	ProjectKey string  `json:"project_key,omitempty" doc:"Jira project key (or give jql)"`
	JQL        string  `json:"jql,omitempty" doc:"A JQL query that selects the issues to import"`
	APIToken   *string `json:"api_token,omitempty" doc:"Atlassian API token; omit to keep the stored one"`
}

// LinearInput connects (or reconfigures) Linear import.
type LinearInput struct {
	TeamID string  `json:"team_id" doc:"Linear team id (UUID) or team key (e.g. ENG)"`
	APIKey *string `json:"api_key,omitempty" doc:"Linear personal API key; omit to keep the stored one"`
}

// ConnectJira stores the Jira configuration and sealed token (manager+).
func (sv *Service) ConnectJira(ctx context.Context, projectRef string, in JiraInput) (*Integration, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	base, err := validateJiraURL(in.BaseURL)
	if err != nil {
		return nil, err
	}
	email := strings.TrimSpace(in.Email)
	if email == "" || !strings.Contains(email, "@") {
		return nil, invalid("email must be the Atlassian account the API token belongs to")
	}
	key := strings.ToUpper(strings.TrimSpace(in.ProjectKey))
	jql := strings.TrimSpace(in.JQL)
	if key == "" && jql == "" {
		return nil, invalid("give a project_key or a jql query")
	}
	if key != "" && !jiraKeyRe.MatchString(key) {
		return nil, invalid("%q is not a Jira project key", key)
	}
	if len(jql) > 2000 {
		return nil, invalid("jql is too long")
	}
	cfg := map[string]any{"base_url": base, "email": email, "project_key": key, "jql": jql}
	return sv.connect(ctx, s, p.ID, "jira", cfg, in.APIToken, "an API token")
}

// ConnectLinear stores the Linear team and sealed API key (manager+).
func (sv *Service) ConnectLinear(ctx context.Context, projectRef string, in LinearInput) (*Integration, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	team := strings.TrimSpace(in.TeamID)
	if team == "" || len(team) > 100 {
		return nil, invalid("team_id is required (the team's id or key)")
	}
	return sv.connect(ctx, s, p.ID, "linear", map[string]any{"team_id": team}, in.APIKey, "an API key")
}

func (sv *Service) connect(ctx context.Context, s *tenant.Scope, projectID, provider string, cfg map[string]any, secret *string, what string) (*Integration, error) {
	if err := limits.Integration(ctx, s.WorkspaceID, provider); err != nil {
		return nil, err
	}
	var sealed any
	if secret != nil && strings.TrimSpace(*secret) != "" {
		v, err := secretbox.Seal([]byte(strings.TrimSpace(*secret)))
		if err != nil {
			return nil, err
		}
		sealed = v
	}
	cfgJSON, _ := json.Marshal(cfg)
	var out *row
	err := sv.tx(ctx, func(tx *sql.Tx) error {
		existing, err := sv.load(ctx, tx, s.WorkspaceID, projectID, provider)
		if err != nil && !isNotFound(err) {
			return err
		}
		if sealed == nil && (existing == nil || !existing.HasSecret) {
			return invalid("%s is required to connect %s", what, provider)
		}
		out, err = scanRow(tx.QueryRowContext(ctx, `
			INSERT INTO project_integrations (workspace_id, project_id, provider, status, config, secret, created_by)
			VALUES ($1, $2, $3, 'active', $4::jsonb, $5, $6)
			ON CONFLICT (workspace_id, project_id, provider) DO UPDATE SET
				config = EXCLUDED.config, secret = COALESCE(EXCLUDED.secret, project_integrations.secret),
				status = 'active', last_error = NULL, updated_at = now()
			RETURNING `+cols, s.WorkspaceID, projectID, provider, string(cfgJSON), sealed, s.UserID))
		if err != nil {
			return err
		}
		return work.RecordActivity(ctx, tx, s, work.ActivityEntry{ProjectID: projectID, Action: "integration.connected",
			SubjectType: "integration", SubjectID: out.ID, Changes: map[string]any{"provider": provider, "credential_changed": sealed != nil}})
	})
	if err != nil {
		return nil, err
	}
	return &out.Integration, nil
}

// Disconnect removes a project's integration (manager+). Imported issues stay, still carrying
// their external reference; the GitHub App stays installed on GitHub (uninstall it there).
func (sv *Service) Disconnect(ctx context.Context, projectRef, provider string) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if err := validProvider(provider); err != nil {
		return err
	}
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return err
	}
	if provider == "hosbah" {
		if r, err := sv.load(ctx, sv.DB, s.WorkspaceID, p.ID, provider); err == nil {
			sv.revokeHosbah(ctx, r)
		}
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		var id string
		err := tx.QueryRowContext(ctx, `DELETE FROM project_integrations WHERE workspace_id = $1 AND project_id = $2 AND provider = $3 RETURNING id`,
			s.WorkspaceID, p.ID, provider).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return notFound(provider + " integration")
		}
		if err != nil {
			return err
		}
		return work.RecordActivity(ctx, tx, s, work.ActivityEntry{ProjectID: p.ID, Action: "integration.disconnected",
			SubjectType: "integration", SubjectID: id, Changes: map[string]any{"provider": provider}})
	})
}

// ---- sync -----------------------------------------------------------------------------

// SyncResult is what one sync did.
type SyncResult struct {
	Provider string `json:"provider"`
	Fetched  int    `json:"fetched"`
	Created  int    `json:"created"`
	Updated  int    `json:"updated"`
	Mirrored int    `json:"mirrored" doc:"GitHub: Mahaam close/reopen pushed to GitHub"`
}

// Sync imports now (manager+): Jira/Linear issues, or GitHub's open issues plus the mirror of
// Mahaam status changes back to GitHub.
func (sv *Service) Sync(ctx context.Context, projectRef, provider string) (*SyncResult, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if err := validProvider(provider); err != nil {
		return nil, err
	}
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	r, err := sv.load(ctx, sv.DB, s.WorkspaceID, p.ID, provider)
	if err := limits.Integration(ctx, s.WorkspaceID, provider); err != nil {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	res, err := sv.syncRow(ctx, s, r)
	if err != nil {
		return nil, err
	}
	return res, nil
}

var syncLocks sync.Map // integration id -> *sync.Mutex (one sync of an integration at a time)

// syncRow runs one integration's sync as s and records the outcome on the row and in the feed.
func (sv *Service) syncRow(ctx context.Context, s *tenant.Scope, r *row) (*SyncResult, error) {
	mu, _ := syncLocks.LoadOrStore(r.ID, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()

	if r.Status == "disabled" {
		return nil, conflict("the integration is disabled — reconnect it first")
	}
	res := &SyncResult{Provider: r.Provider}
	var err error
	switch r.Provider {
	case "jira":
		err = sv.syncJira(ctx, s, r, res)
	case "linear":
		err = sv.syncLinear(ctx, s, r, res)
	case "github":
		err = sv.syncGitHub(ctx, s, r, res)
	case "hosbah":
		err = sv.syncHosbah(ctx, s, r, res)
	}
	if err != nil {
		msg := truncate(err.Error(), 500)
		_, _ = sv.DB.ExecContext(ctx, `UPDATE project_integrations SET status = 'error', last_error = $3, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, r.ID, msg)
		return nil, upstream(err)
	}
	status := "active"
	if r.Provider == "github" && r.cfg("repo") == "" {
		status = "pending"
	}
	if _, err := sv.DB.ExecContext(ctx, `UPDATE project_integrations SET status = $3, last_error = NULL, last_synced_at = now(), updated_at = now()
		WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, r.ID, status); err != nil {
		return nil, err
	}
	_ = work.RecordActivity(ctx, sv.DB, s, work.ActivityEntry{ProjectID: r.ProjectID, Action: "integration.synced",
		SubjectType: "integration", SubjectID: r.ID, Changes: map[string]any{"provider": r.Provider,
			"fetched": res.Fetched, "created": res.Created, "updated": res.Updated, "mirrored": res.Mirrored}})
	return res, nil
}

func (sv *Service) secret(r *row) (string, error) {
	if !r.HasSecret {
		return "", invalid("no credential is stored — reconnect the integration")
	}
	b, err := secretbox.Open(*r.Secret)
	if err != nil {
		return "", fmt.Errorf("the stored credential cannot be decrypted (was MAHAAM_SECRET_KEY changed?) — reconnect the integration")
	}
	return string(b), nil
}

// ---- system scope (webhook, scheduler, callback) ---------------------------------------

// systemScope acts inside r's workspace for a background job or a webhook: the activity actor
// is the integration's creator, recorded as via=system.
func systemScope(workspaceID string, createdBy *string) *tenant.Scope {
	actor := "system"
	if createdBy != nil && *createdBy != "" {
		actor = *createdBy
	}
	return &tenant.Scope{WorkspaceID: workspaceID, UserID: actor, Role: string(authz.Owner), Via: "system"}
}

// SyncAllImports re-syncs every Jira/Linear integration (the 30-minute scheduler job). It scans
// on the owner pool (explicit predicate) and syncs each inside its own workspace's RLS scope.
func (sv *Service) SyncAllImports(ctx context.Context) (int, error) {
	return sv.forEach(ctx, `provider IN ('jira', 'linear') AND status IN ('active', 'error')`, func(ctx context.Context, s *tenant.Scope, r *row) error {
		_, err := sv.syncRow(ctx, s, r)
		return err
	})
}

// MirrorAllGitHub pushes Mahaam close/reopen of GitHub-linked issues to GitHub (every five minutes).
func (sv *Service) MirrorAllGitHub(ctx context.Context) (int, error) {
	n := 0
	_, err := sv.forEach(ctx, `provider = 'github' AND status IN ('active', 'error') AND COALESCE(config->>'repo', '') <> ''`, func(ctx context.Context, s *tenant.Scope, r *row) error {
		m, err := sv.mirrorGitHub(ctx, s, r)
		n += m
		return err
	})
	return n, err
}

func (sv *Service) forEach(ctx context.Context, where string, fn func(context.Context, *tenant.Scope, *row) error) (int, error) {
	if sv.Sys == nil {
		return 0, nil
	}
	rows, err := sv.Sys.QueryContext(ctx, `SELECT `+cols+` FROM project_integrations WHERE `+where)
	if err != nil {
		return 0, err
	}
	var list []*row
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	done := 0
	var firstErr error
	for _, r := range list {
		s := systemScope(r.WorkspaceID, r.CreatedBy)
		if err := fn(tenant.With(ctx, s), s, r); err != nil {
			sv.Log.Warn("integrations: background sync", "integration", r.ID, "provider", r.Provider, "err", err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		done++
	}
	return done, nil
}

// ---- helpers -------------------------------------------------------------------------

func (sv *Service) tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	if sv.DB == nil {
		return errors.New("integrations: database unavailable")
	}
	tx, err := sv.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func isNotFound(err error) bool {
	var we *work.Error
	return errors.As(err, &we) && we.Status == http.StatusNotFound
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
