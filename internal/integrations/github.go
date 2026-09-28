package integrations

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/secretbox"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

var repoRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`)

// ---- install flow -------------------------------------------------------------------

// installState is what the signed install state carries through GitHub and back.
type installState struct {
	W   string `json:"w"` // workspace
	P   string `json:"p"` // project
	U   string `json:"u"` // user who started the install
	L   string `json:"l"` // UI locale for the redirect back
	Exp int64  `json:"e"`
}

const stateTTL = 30 * time.Minute

func signState(st installState) string {
	b, _ := json.Marshal(st)
	payload := base64.RawURLEncoding.EncodeToString(b)
	return payload + "." + secretbox.Sign([]byte(payload))
}

func parseState(raw string, now time.Time) (*installState, error) {
	payload, sig, ok := strings.Cut(raw, ".")
	if !ok || !secretbox.Verify([]byte(payload), sig) {
		return nil, errors.New("the install link is invalid — start again from the project settings")
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, errors.New("the install link is invalid")
	}
	var st installState
	if json.Unmarshal(b, &st) != nil || st.W == "" || st.P == "" || st.U == "" {
		return nil, errors.New("the install link is invalid")
	}
	if now.Unix() > st.Exp {
		return nil, errors.New("the install link expired — start again from the project settings")
	}
	return &st, nil
}

// InstallURL returns the GitHub page that installs the App, with a signed state naming the
// project (manager+).
func (sv *Service) InstallURL(ctx context.Context, projectRef, locale string) (string, error) {
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return "", err
	}
	if err := limits.Integration(ctx, s.WorkspaceID, "github"); err != nil {
		return "", err
	}
	g, err := sv.GitHub()
	if err != nil {
		return "", unavailable(err)
	}
	if locale != "ar" {
		locale = "en"
	}
	st := signState(installState{W: s.WorkspaceID, P: p.ID, U: s.UserID, L: locale, Exp: time.Now().Add(stateTTL).Unix()})
	return g.WebURL + "/apps/" + url.PathEscape(g.Slug) + "/installations/new?state=" + url.QueryEscape(st), nil
}

// CompleteInstall is the public setup callback: verify the state, prove (when the App's OAuth
// credentials are configured) that the installing GitHub user can access the installation,
// re-check the Mahaam user may still manage the project, and store the installation id.
// It returns the web path to send the browser back to.
func (sv *Service) CompleteInstall(ctx context.Context, installationID, state, code string) (string, error) {
	st, err := parseState(state, time.Now())
	if err != nil {
		return "", invalid("%s", err.Error())
	}
	if _, err := strconv.ParseInt(installationID, 10, 64); err != nil {
		return "", invalid("GitHub sent no installation id")
	}
	g, err := sv.GitHub()
	if err != nil {
		return "", unavailable(err)
	}
	if g.ClientID != "" && g.ClientSecret != "" {
		if code == "" {
			return "", invalid("GitHub sent no authorization code — enable \"Request user authorization (OAuth) during installation\" on the App")
		}
		tok, err := g.exchangeCode(ctx, code)
		if err != nil {
			return "", upstream(err)
		}
		ids, err := g.userInstallations(ctx, tok)
		if err != nil {
			return "", upstream(err)
		}
		if !ids[installationID] {
			return "", forbidden("that GitHub installation is not accessible to the GitHub account that completed the install")
		}
	} else if strings.EqualFold(os.Getenv("APP_ENV"), "production") {
		return "", unavailable(errors.New("GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET are required in production to verify who owns an installation"))
	} else {
		sv.Log.Warn("github: installation ownership NOT verified (GITHUB_APP_CLIENT_ID/SECRET unset) — development only", "installation", installationID)
	}

	// The person who started the install must still be a manager+ member of the workspace.
	var role, slug string
	err = sv.Sys.QueryRowContext(ctx, `SELECT m.role, w.slug FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
		WHERE m.workspace_id = $1 AND m.user_id = $2`, st.W, st.U).Scan(&role, &slug)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !authz.Can(role, authz.IntegrationsManage)) {
		return "", forbidden("you can no longer manage this project's integrations")
	}
	if err != nil {
		return "", err
	}
	s := &tenant.Scope{WorkspaceID: st.W, WorkspaceSlug: slug, UserID: st.U, Role: role, Via: "session"}
	ctx = tenant.With(ctx, s)
	p, err := sv.Work.FindProject(ctx, st.P)
	if err != nil {
		return "", err
	}
	cfg, _ := json.Marshal(map[string]any{"installation_id": installationID})
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		var id string
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO project_integrations (workspace_id, project_id, provider, status, config, created_by)
			VALUES ($1, $2, 'github', 'pending', $3::jsonb, $4)
			ON CONFLICT (workspace_id, project_id, provider) DO UPDATE SET
				config = CASE WHEN project_integrations.config->>'installation_id' = EXCLUDED.config->>'installation_id'
				              THEN project_integrations.config ELSE EXCLUDED.config END,
				status = CASE WHEN project_integrations.config->>'installation_id' = EXCLUDED.config->>'installation_id'
				                   AND COALESCE(project_integrations.config->>'repo', '') <> '' THEN 'active' ELSE 'pending' END,
				last_error = NULL, updated_at = now()
			RETURNING id`, st.W, p.ID, string(cfg), st.U).Scan(&id); err != nil {
			return err
		}
		return work.RecordActivity(ctx, tx, s, work.ActivityEntry{ProjectID: p.ID, Action: "integration.github_installed",
			SubjectType: "integration", SubjectID: id, Changes: map[string]any{"installation_id": installationID}})
	})
	if err != nil {
		return "", err
	}
	return "/" + st.L + "/w/" + slug + "/projects/" + p.ID + "/settings?integration=github#integrations", nil
}

// ---- repositories ---------------------------------------------------------------------

// Repo is a repository the installation can access.
type Repo struct {
	FullName      string `json:"full_name"`
	Private       bool   `json:"private"`
	DefaultBranch string `json:"default_branch"`
	HTMLURL       string `json:"html_url"`
}

// github resolves the caller, project, GitHub row and App. needRepo demands a linked repo.
func (sv *Service) github(ctx context.Context, projectRef, action string, needRepo bool) (*tenant.Scope, *row, *GitHubApp, error) {
	s, p, err := sv.project(ctx, projectRef, action)
	if err != nil {
		return nil, nil, nil, err
	}
	r, err := sv.load(ctx, sv.DB, s.WorkspaceID, p.ID, "github")
	if err != nil {
		return nil, nil, nil, err
	}
	if r.Status == "disabled" {
		return nil, nil, nil, conflict("the GitHub App was uninstalled or suspended — install it again")
	}
	if needRepo && r.cfg("repo") == "" {
		return nil, nil, nil, conflict("pick a repository for this project first")
	}
	g, err := sv.GitHub()
	if err != nil {
		return nil, nil, nil, unavailable(err)
	}
	return s, r, g, nil
}

func (g *GitHubApp) repos(ctx context.Context, installationID string) ([]Repo, error) {
	out := []Repo{}
	for page := 1; page <= 10; page++ {
		var res struct {
			Repositories []Repo `json:"repositories"`
		}
		if _, err := g.api(ctx, installationID, http.MethodGet, fmt.Sprintf("/installation/repositories?per_page=100&page=%d", page), nil, &res); err != nil {
			return nil, err
		}
		out = append(out, res.Repositories...)
		if len(res.Repositories) < 100 {
			break
		}
	}
	return out, nil
}

// Repos lists the repositories the project's installation can access (manager+).
func (sv *Service) Repos(ctx context.Context, projectRef string) ([]Repo, error) {
	_, inst, g, err := sv.installation(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	list, err := g.repos(ctx, inst)
	if err != nil {
		return nil, upstream(err)
	}
	return list, nil
}

// installation resolves the GitHub App installation a manager+ may pick a repository from: the
// project's own, or, when the project has none yet, the one another project in the same workspace
// already installed. GitHub installs an App once per account; installing it again only shows
// "already configured" and never calls back, so a second project must reuse the first install.
// The reused installation was verified for this workspace when it was installed. It returns the
// project's row, nil when it has none.
func (sv *Service) installation(ctx context.Context, projectRef string) (*row, string, *GitHubApp, error) {
	_, r, g, err := sv.github(ctx, projectRef, authz.IntegrationsManage, false)
	if err == nil {
		return r, r.cfg("installation_id"), g, nil
	}
	if e, ok := work.AsError(err); !ok || e.Status != http.StatusNotFound {
		return nil, "", nil, err
	}
	if _, _, err = sv.project(ctx, projectRef, authz.IntegrationsManage); err != nil {
		return nil, "", nil, err
	}
	sc, _ := tenant.From(ctx)
	var inst string
	err = sv.DB.QueryRowContext(ctx, `SELECT config->>'installation_id' FROM project_integrations
		WHERE workspace_id = $1 AND provider = 'github' AND status <> 'disabled' AND COALESCE(config->>'installation_id', '') <> ''
		ORDER BY (status = 'active') DESC, updated_at DESC LIMIT 1`, sc.WorkspaceID).Scan(&inst)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", nil, notFound("github integration")
	}
	if err != nil {
		return nil, "", nil, err
	}
	if g, err = sv.GitHub(); err != nil {
		return nil, "", nil, unavailable(err)
	}
	return nil, inst, g, nil
}

// LinkRepo links one of the installation's repositories to the project (manager+).
func (sv *Service) LinkRepo(ctx context.Context, projectRef, fullName string) (*Integration, error) {
	r, inst, g, err := sv.installation(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	s, p, err := sv.project(ctx, projectRef, authz.IntegrationsManage)
	if err != nil {
		return nil, err
	}
	fullName = strings.TrimSpace(fullName)
	if err := limits.Integration(ctx, s.WorkspaceID, "github"); err != nil {
		return nil, err
	}
	if !repoRe.MatchString(fullName) {
		return nil, invalid("repo must be owner/name")
	}
	list, err := g.repos(ctx, inst)
	if err != nil {
		return nil, upstream(err)
	}
	var found *Repo
	for i := range list {
		if strings.EqualFold(list[i].FullName, fullName) {
			found = &list[i]
		}
	}
	if found == nil {
		return nil, invalid("the GitHub App installation cannot access %s — grant it the repository on GitHub first", fullName)
	}
	var out *row
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		patch, _ := json.Marshal(map[string]any{"repo": found.FullName, "default_branch": found.DefaultBranch})
		if r == nil {
			// The workspace's installation, adopted by this project on its first repository.
			cfg, _ := json.Marshal(map[string]any{"installation_id": inst, "repo": found.FullName, "default_branch": found.DefaultBranch})
			out, err = scanRow(tx.QueryRowContext(ctx, `INSERT INTO project_integrations (workspace_id, project_id, provider, status, config, created_by)
				VALUES ($1, $2, 'github', 'active', $3::jsonb, $4) RETURNING `+cols, s.WorkspaceID, p.ID, string(cfg), s.UserID))
		} else {
			out, err = scanRow(tx.QueryRowContext(ctx, `UPDATE project_integrations SET config = config || $3::jsonb,
				status = 'active', last_error = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING `+cols,
				s.WorkspaceID, r.ID, string(patch)))
		}
		if err != nil {
			return err
		}
		return work.RecordActivity(ctx, tx, s, work.ActivityEntry{ProjectID: p.ID, Action: "integration.github_repo_linked",
			SubjectType: "integration", SubjectID: out.ID, Changes: map[string]any{"repo": found.FullName}})
	})
	if err != nil {
		return nil, err
	}
	return &out.Integration, nil
}

// ---- read: commits, pulls, runs, deployments, workflows -------------------------------

// Commit is one commit of the linked repository.
type Commit struct {
	SHA         string    `json:"sha"`
	Message     string    `json:"message"`
	AuthorName  string    `json:"author_name"`
	AuthorEmail string    `json:"author_email"`
	AuthorLogin string    `json:"author_login"`
	Date        time.Time `json:"date"`
	URL         string    `json:"url"`
}

// Commits lists recent commits (branch default: the repo's default; since: RFC 3339 or date).
func (sv *Service) Commits(ctx context.Context, projectRef, branch, since string) ([]Commit, error) {
	_, r, g, err := sv.github(ctx, projectRef, authz.IntegrationsRead, true)
	if err != nil {
		return nil, err
	}
	q := url.Values{"per_page": {"50"}}
	if b := strings.TrimSpace(branch); b != "" {
		q.Set("sha", b)
	}
	if s := strings.TrimSpace(since); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			if t, err = time.Parse("2006-01-02", s); err != nil {
				return nil, invalid("since must be a date (YYYY-MM-DD) or RFC 3339")
			}
		}
		q.Set("since", t.UTC().Format(time.RFC3339))
	}
	var raw []struct {
		SHA     string `json:"sha"`
		HTMLURL string `json:"html_url"`
		Commit  struct {
			Message string `json:"message"`
			Author  struct {
				Name  string    `json:"name"`
				Email string    `json:"email"`
				Date  time.Time `json:"date"`
			} `json:"author"`
		} `json:"commit"`
		Author *struct {
			Login string `json:"login"`
		} `json:"author"`
	}
	if _, err := g.api(ctx, r.cfg("installation_id"), http.MethodGet, "/repos/"+r.cfg("repo")+"/commits?"+q.Encode(), nil, &raw); err != nil {
		return nil, upstream(err)
	}
	out := make([]Commit, 0, len(raw))
	for _, c := range raw {
		x := Commit{SHA: c.SHA, Message: firstLine(c.Commit.Message), AuthorName: c.Commit.Author.Name,
			AuthorEmail: c.Commit.Author.Email, Date: c.Commit.Author.Date, URL: c.HTMLURL}
		if c.Author != nil {
			x.AuthorLogin = c.Author.Login
		}
		out = append(out, x)
	}
	return out, nil
}

// Pull is one pull request.
type Pull struct {
	Number    int        `json:"number"`
	Title     string     `json:"title"`
	State     string     `json:"state"`
	Draft     bool       `json:"draft"`
	Author    string     `json:"author"`
	Head      string     `json:"head"`
	Base      string     `json:"base"`
	URL       string     `json:"url"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	MergedAt  *time.Time `json:"merged_at"`
}

// Pulls lists pull requests (state open|closed|all; default open).
func (sv *Service) Pulls(ctx context.Context, projectRef, state string) ([]Pull, error) {
	_, r, g, err := sv.github(ctx, projectRef, authz.IntegrationsRead, true)
	if err != nil {
		return nil, err
	}
	switch state {
	case "open", "closed", "all":
	case "":
		state = "open"
	default:
		return nil, invalid("state must be open, closed or all")
	}
	var raw []struct {
		Number    int        `json:"number"`
		Title     string     `json:"title"`
		State     string     `json:"state"`
		Draft     bool       `json:"draft"`
		HTMLURL   string     `json:"html_url"`
		CreatedAt time.Time  `json:"created_at"`
		UpdatedAt time.Time  `json:"updated_at"`
		MergedAt  *time.Time `json:"merged_at"`
		User      struct {
			Login string `json:"login"`
		} `json:"user"`
		Head struct {
			Ref string `json:"ref"`
		} `json:"head"`
		Base struct {
			Ref string `json:"ref"`
		} `json:"base"`
	}
	if _, err := g.api(ctx, r.cfg("installation_id"), http.MethodGet, "/repos/"+r.cfg("repo")+"/pulls?per_page=50&sort=updated&direction=desc&state="+state, nil, &raw); err != nil {
		return nil, upstream(err)
	}
	out := make([]Pull, 0, len(raw))
	for _, p := range raw {
		out = append(out, Pull{Number: p.Number, Title: p.Title, State: p.State, Draft: p.Draft, Author: p.User.Login,
			Head: p.Head.Ref, Base: p.Base.Ref, URL: p.HTMLURL, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt, MergedAt: p.MergedAt})
	}
	return out, nil
}

// Run is one GitHub Actions workflow run.
type Run struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	Branch     string    `json:"branch"`
	Event      string    `json:"event"`
	Status     string    `json:"status"`
	Conclusion string    `json:"conclusion"`
	SHA        string    `json:"sha"`
	Actor      string    `json:"actor"`
	URL        string    `json:"url"`
	CreatedAt  time.Time `json:"created_at"`
}

// Runs lists recent workflow runs.
func (sv *Service) Runs(ctx context.Context, projectRef string) ([]Run, error) {
	_, r, g, err := sv.github(ctx, projectRef, authz.IntegrationsRead, true)
	if err != nil {
		return nil, err
	}
	var raw struct {
		WorkflowRuns []struct {
			ID         int64     `json:"id"`
			Name       string    `json:"name"`
			HeadBranch string    `json:"head_branch"`
			HeadSHA    string    `json:"head_sha"`
			Event      string    `json:"event"`
			Status     string    `json:"status"`
			Conclusion *string   `json:"conclusion"`
			HTMLURL    string    `json:"html_url"`
			CreatedAt  time.Time `json:"created_at"`
			Actor      *struct {
				Login string `json:"login"`
			} `json:"actor"`
		} `json:"workflow_runs"`
	}
	if _, err := g.api(ctx, r.cfg("installation_id"), http.MethodGet, "/repos/"+r.cfg("repo")+"/actions/runs?per_page=30", nil, &raw); err != nil {
		return nil, upstream(err)
	}
	out := make([]Run, 0, len(raw.WorkflowRuns))
	for _, x := range raw.WorkflowRuns {
		run := Run{ID: x.ID, Name: x.Name, Branch: x.HeadBranch, Event: x.Event, Status: x.Status, Conclusion: deref(x.Conclusion),
			SHA: x.HeadSHA, URL: x.HTMLURL, CreatedAt: x.CreatedAt}
		if x.Actor != nil {
			run.Actor = x.Actor.Login
		}
		out = append(out, run)
	}
	return out, nil
}

// Deployment is one deployment with its latest status.
type Deployment struct {
	ID          int64     `json:"id"`
	Environment string    `json:"environment"`
	Ref         string    `json:"ref"`
	SHA         string    `json:"sha"`
	Creator     string    `json:"creator"`
	State       string    `json:"state"`
	URL         string    `json:"url"`
	CreatedAt   time.Time `json:"created_at"`
}

// Deployments lists recent deployments; the latest status is fetched for the first ten.
func (sv *Service) Deployments(ctx context.Context, projectRef string) ([]Deployment, error) {
	_, r, g, err := sv.github(ctx, projectRef, authz.IntegrationsRead, true)
	if err != nil {
		return nil, err
	}
	inst, repo := r.cfg("installation_id"), r.cfg("repo")
	var raw []struct {
		ID          int64     `json:"id"`
		Environment string    `json:"environment"`
		Ref         string    `json:"ref"`
		SHA         string    `json:"sha"`
		CreatedAt   time.Time `json:"created_at"`
		Creator     *struct {
			Login string `json:"login"`
		} `json:"creator"`
	}
	if _, err := g.api(ctx, inst, http.MethodGet, "/repos/"+repo+"/deployments?per_page=20", nil, &raw); err != nil {
		return nil, upstream(err)
	}
	out := make([]Deployment, 0, len(raw))
	for i, d := range raw {
		x := Deployment{ID: d.ID, Environment: d.Environment, Ref: d.Ref, SHA: d.SHA, CreatedAt: d.CreatedAt}
		if d.Creator != nil {
			x.Creator = d.Creator.Login
		}
		if i < 10 {
			var st []struct {
				State     string `json:"state"`
				TargetURL string `json:"target_url"`
				LogURL    string `json:"log_url"`
			}
			if _, err := g.api(ctx, inst, http.MethodGet, fmt.Sprintf("/repos/%s/deployments/%d/statuses?per_page=1", repo, d.ID), nil, &st); err == nil && len(st) > 0 {
				x.State, x.URL = st[0].State, firstNonEmpty(st[0].LogURL, st[0].TargetURL)
			}
		}
		out = append(out, x)
	}
	return out, nil
}

// Workflow is one GitHub Actions workflow (a deploy target when it has workflow_dispatch).
type Workflow struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Path  string `json:"path"`
	State string `json:"state"`
	URL   string `json:"url"`
}

// Workflows lists the repository's workflows.
func (sv *Service) Workflows(ctx context.Context, projectRef string) ([]Workflow, error) {
	_, r, g, err := sv.github(ctx, projectRef, authz.IntegrationsRead, true)
	if err != nil {
		return nil, err
	}
	var raw struct {
		Workflows []struct {
			ID      int64  `json:"id"`
			Name    string `json:"name"`
			Path    string `json:"path"`
			State   string `json:"state"`
			HTMLURL string `json:"html_url"`
		} `json:"workflows"`
	}
	if _, err := g.api(ctx, r.cfg("installation_id"), http.MethodGet, "/repos/"+r.cfg("repo")+"/actions/workflows?per_page=100", nil, &raw); err != nil {
		return nil, upstream(err)
	}
	out := make([]Workflow, 0, len(raw.Workflows))
	for _, w := range raw.Workflows {
		out = append(out, Workflow{ID: w.ID, Name: w.Name, Path: w.Path, State: w.State, URL: w.HTMLURL})
	}
	return out, nil
}

// DeployInput triggers a workflow_dispatch.
type DeployInput struct {
	Workflow string            `json:"workflow" doc:"Workflow id or file name (deploy.yml)"`
	Ref      string            `json:"ref,omitempty" doc:"Branch or tag; default the repository's default branch"`
	Inputs   map[string]string `json:"inputs,omitempty" doc:"workflow_dispatch inputs"`
}

var workflowRe = regexp.MustCompile(`^([0-9]+|[A-Za-z0-9_.-]+\.ya?ml)$`)

// Deploy triggers a workflow_dispatch on the linked repository (github:deploy, manager+).
func (sv *Service) Deploy(ctx context.Context, projectRef string, in DeployInput) error {
	s, r, g, err := sv.github(ctx, projectRef, authz.GitHubDeploy, true)
	if err != nil {
		return err
	}
	wf := strings.TrimSpace(in.Workflow)
	if strings.Contains(wf, "/") {
		wf = wf[strings.LastIndex(wf, "/")+1:]
	}
	if !workflowRe.MatchString(wf) {
		return invalid("workflow must be a workflow id or its file name (deploy.yml)")
	}
	ref := firstNonEmpty(in.Ref, r.cfg("default_branch"), "main")
	if len(in.Inputs) > 10 {
		return invalid("at most 10 inputs")
	}
	body := map[string]any{"ref": ref}
	if len(in.Inputs) > 0 {
		body["inputs"] = in.Inputs
	}
	if _, err := g.api(ctx, r.cfg("installation_id"), http.MethodPost, "/repos/"+r.cfg("repo")+"/actions/workflows/"+url.PathEscape(wf)+"/dispatches", body, nil); err != nil {
		return upstream(err)
	}
	return work.RecordActivity(ctx, sv.DB, s, work.ActivityEntry{ProjectID: r.ProjectID, Action: "github.deploy",
		SubjectType: "integration", SubjectID: r.ID, Changes: map[string]any{"workflow": wf, "ref": ref, "repo": r.cfg("repo")}})
}

// ---- issues ----------------------------------------------------------------------------

// CreateIssueFrom files a GitHub issue for a Mahaam issue of the project and links them
// (github:issues, member+). Afterwards close/reopen mirror both ways.
func (sv *Service) CreateIssueFrom(ctx context.Context, projectRef, issueRef string) (*reports.Report, string, error) {
	s, r, g, err := sv.github(ctx, projectRef, authz.GitHubIssueWrite, true)
	if err != nil {
		return nil, "", err
	}
	rep, err := reports.Find(ctx, sv.DB, s.WorkspaceID, issueRef)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", notFound("issue")
	}
	if err != nil {
		return nil, "", err
	}
	if rep.ProjectID == nil || *rep.ProjectID != r.ProjectID {
		return nil, "", invalid("%s is not an issue of this project", rep.Key)
	}
	var src *string
	if err := sv.DB.QueryRowContext(ctx, `SELECT external_source FROM reports WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, rep.ID).Scan(&src); err != nil {
		return nil, "", err
	}
	if src != nil && *src != "" {
		return nil, "", conflict(fmt.Sprintf("%s is already linked to %s", rep.Key, *src))
	}
	body := strings.TrimSpace(deref(rep.Body))
	body += fmt.Sprintf("\n\n---\nFiled from Mahaam %s", rep.Key)
	var gi ghIssue
	if _, err := g.api(ctx, r.cfg("installation_id"), http.MethodPost, "/repos/"+r.cfg("repo")+"/issues",
		map[string]any{"title": rep.Title, "body": strings.TrimSpace(body)}, &gi); err != nil {
		return nil, "", upstream(err)
	}
	state := "open"
	if rep.State == "closed" {
		state = "open" // mirror pushes the close on the next pass
	}
	if _, err := sv.DB.ExecContext(ctx, `UPDATE reports SET external_source = 'github', external_id = $3, external_key = $4,
		external_url = $5, external_state = $6 WHERE workspace_id = $1 AND id = $2`,
		s.WorkspaceID, rep.ID, strconv.FormatInt(gi.ID, 10), fmt.Sprintf("%s#%d", r.cfg("repo"), gi.Number), gi.HTMLURL, state); err != nil {
		return nil, "", err
	}
	_ = work.RecordActivity(ctx, sv.DB, s, work.ActivityEntry{ProjectID: r.ProjectID, Action: "github.issue_created",
		SubjectType: "issue", SubjectID: rep.ID, Changes: map[string]any{"key": rep.Key, "url": gi.HTMLURL}})
	return rep, gi.HTMLURL, nil
}

type ghIssue struct {
	ID          int64           `json:"id"`
	Number      int             `json:"number"`
	Title       string          `json:"title"`
	Body        *string         `json:"body"`
	State       string          `json:"state"`
	HTMLURL     string          `json:"html_url"`
	PullRequest json.RawMessage `json:"pull_request"`
	Labels      []struct {
		Name string `json:"name"`
	} `json:"labels"`
}

func mapGitHub(repo string, i ghIssue) ExternalIssue {
	x := ExternalIssue{Source: "github", ExternalID: strconv.FormatInt(i.ID, 10), Key: fmt.Sprintf("%s#%d", repo, i.Number),
		URL: i.HTMLURL, Title: i.Title, Body: deref(i.Body), Status: "backlog", IssueType: "task", Priority: "medium", OpenClosedOnly: true}
	if i.State == "closed" {
		x.Status = "done"
	}
	for _, l := range i.Labels {
		switch strings.ToLower(l.Name) {
		case "bug":
			x.IssueType = "bug"
		case "enhancement", "feature":
			if x.IssueType == "task" {
				x.IssueType = "feature"
			}
		}
	}
	return x
}

// syncGitHub pushes Mahaam close/reopen first (so an import never undoes a local change), then
// imports every open issue of the linked repository.
func (sv *Service) syncGitHub(ctx context.Context, s *tenant.Scope, r *row, res *SyncResult) error {
	if r.cfg("repo") == "" {
		return nil
	}
	m, err := sv.mirrorGitHub(ctx, s, r)
	res.Mirrored = m
	if err != nil {
		return err
	}
	g, err := sv.GitHub()
	if err != nil {
		return err
	}
	var all []ExternalIssue
	for page := 1; page <= 50; page++ {
		var list []ghIssue
		if _, err := g.api(ctx, r.cfg("installation_id"), http.MethodGet, fmt.Sprintf("/repos/%s/issues?state=open&per_page=100&page=%d", r.cfg("repo"), page), nil, &list); err != nil {
			return err
		}
		for _, i := range list {
			if len(i.PullRequest) > 0 && string(i.PullRequest) != "null" {
				continue // the issues API also lists pull requests
			}
			all = append(all, mapGitHub(r.cfg("repo"), i))
		}
		if len(list) < 100 {
			break
		}
	}
	return sv.importAll(ctx, s, r, all, res)
}

// mirrorGitHub pushes Mahaam's open/closed state to GitHub for linked issues whose state differs
// from the last state seen on GitHub.
func (sv *Service) mirrorGitHub(ctx context.Context, s *tenant.Scope, r *row) (int, error) {
	repo := r.cfg("repo")
	if repo == "" {
		return 0, nil
	}
	g, err := sv.GitHub()
	if err != nil {
		return 0, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, state, external_key FROM reports
		WHERE workspace_id = $1 AND project_id = $2 AND external_source = 'github' AND external_key LIKE $3
		  AND external_state IS DISTINCT FROM state LIMIT 200`, s.WorkspaceID, r.ProjectID, likeEscape(repo)+"#%")
	if err != nil {
		return 0, err
	}
	type item struct{ id, state, key string }
	var list []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.state, &it.key); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, it)
	}
	rows.Close()
	n := 0
	for _, it := range list {
		num := it.key[strings.LastIndex(it.key, "#")+1:]
		if _, err := strconv.Atoi(num); err != nil {
			continue
		}
		if _, err := g.api(ctx, r.cfg("installation_id"), http.MethodPatch, "/repos/"+repo+"/issues/"+num, map[string]any{"state": it.state}, nil); err != nil {
			return n, err
		}
		if _, err := sv.DB.ExecContext(ctx, `UPDATE reports SET external_state = $3 WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, it.id, it.state); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(s)
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return strings.TrimSpace(s)
}
