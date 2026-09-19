package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
POST /api/integrations/github/webhook — PUBLIC (guard allowlist); the only credential is the
X-Hub-Signature-256 HMAC under GITHUB_WEBHOOK_SECRET, checked over the raw body before
anything is parsed. Deliveries are routed to integrations by (installation id, repository
full_name) on the owner pool, then handled inside each integration's workspace on the RLS app
pool under a system scope. Redeliveries are harmless: issues upsert, comments/commits/runs are
deduped by github_events (workspace, project, kind, external_id).
*/

const maxWebhookBody = 10 << 20

// WebhookHandler handles GitHub webhook deliveries.
func (sv *Service) WebhookHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secret := WebhookSecret()
		if secret == "" {
			http.Error(w, `{"error":"webhooks are not configured (GITHUB_WEBHOOK_SECRET)"}`, http.StatusServiceUnavailable)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, maxWebhookBody+1))
		if err != nil || len(body) > maxWebhookBody {
			http.Error(w, `{"error":"body too large"}`, http.StatusRequestEntityTooLarge)
			return
		}
		if !VerifyWebhookSignature(secret, body, r.Header.Get("X-Hub-Signature-256")) {
			http.Error(w, `{"error":"invalid signature"}`, http.StatusUnauthorized)
			return
		}
		n, err := sv.HandleEvent(r.Context(), r.Header.Get("X-GitHub-Event"), body)
		if err != nil {
			sv.Log.Warn("github webhook", "event", r.Header.Get("X-GitHub-Event"), "delivery", r.Header.Get("X-GitHub-Delivery"), "err", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = fmt.Fprintf(w, `{"ok":true,"integrations":%d}`, n)
	})
}

type ghEnvelope struct {
	Action       string `json:"action"`
	Installation *struct {
		ID int64 `json:"id"`
	} `json:"installation"`
	Repository *struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
	Sender *struct {
		Login string `json:"login"`
	} `json:"sender"`
}

// HandleEvent applies one verified delivery and returns how many integrations it reached.
func (sv *Service) HandleEvent(ctx context.Context, event string, body []byte) (int, error) {
	var env ghEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return 0, err
	}
	if env.Installation == nil {
		return 0, nil // ping without an installation, etc.
	}
	inst := strconv.FormatInt(env.Installation.ID, 10)
	if sv.Sys == nil {
		return 0, errors.New("database unavailable")
	}
	if event == "installation" {
		switch env.Action {
		case "deleted", "suspend":
			_, err := sv.Sys.ExecContext(ctx, `UPDATE project_integrations SET status = 'disabled',
				last_error = 'The GitHub App was uninstalled or suspended on GitHub', updated_at = now()
				WHERE provider = 'github' AND config->>'installation_id' = $1`, inst)
			return 0, err
		case "unsuspend":
			_, err := sv.Sys.ExecContext(ctx, `UPDATE project_integrations SET status = CASE WHEN COALESCE(config->>'repo','') = '' THEN 'pending' ELSE 'active' END,
				last_error = NULL, updated_at = now() WHERE provider = 'github' AND config->>'installation_id' = $1`, inst)
			return 0, err
		}
		return 0, nil
	}
	if env.Repository == nil || env.Repository.FullName == "" {
		return 0, nil
	}
	rows, err := sv.Sys.QueryContext(ctx, `SELECT `+cols+` FROM project_integrations
		WHERE provider = 'github' AND status IN ('active', 'error') AND config->>'installation_id' = $1
		  AND lower(config->>'repo') = lower($2)`, inst, env.Repository.FullName)
	if err != nil {
		return 0, err
	}
	var targets []*row
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			rows.Close()
			return 0, err
		}
		targets = append(targets, r)
	}
	rows.Close()
	var firstErr error
	for _, r := range targets {
		s := systemScope(r.WorkspaceID, r.CreatedBy)
		if err := sv.apply(tenant.With(ctx, s), s, r, event, env, body); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return len(targets), firstErr
}

func (sv *Service) apply(ctx context.Context, s *tenant.Scope, r *row, event string, env ghEnvelope, body []byte) error {
	repo := r.cfg("repo")
	sender := ""
	if env.Sender != nil {
		sender = env.Sender.Login
	}
	act := func(action string, changes map[string]any) {
		changes["repo"] = repo
		if sender != "" {
			changes["github_user"] = sender
		}
		_ = work.RecordActivity(ctx, sv.DB, s, work.ActivityEntry{ProjectID: r.ProjectID, Action: action,
			SubjectType: "integration", SubjectID: r.ID, Changes: changes})
	}
	switch event {
	case "issues":
		var p struct {
			Issue ghIssue `json:"issue"`
		}
		if err := json.Unmarshal(body, &p); err != nil {
			return err
		}
		if env.Action == "deleted" || (len(p.Issue.PullRequest) > 0 && string(p.Issue.PullRequest) != "null") {
			return nil
		}
		created, rep, err := sv.upsertIssue(ctx, s, r.ProjectID, mapGitHub(repo, p.Issue))
		if err != nil {
			return err
		}
		act("github.issue_"+env.Action, map[string]any{"issue": rep.Key, "created": created, "number": p.Issue.Number})

	case "issue_comment":
		if env.Action != "created" {
			return nil
		}
		var p struct {
			Issue   ghIssue `json:"issue"`
			Comment struct {
				ID      int64  `json:"id"`
				Body    string `json:"body"`
				HTMLURL string `json:"html_url"`
				User    struct {
					Login string `json:"login"`
					Type  string `json:"type"`
				} `json:"user"`
				CreatedAt time.Time `json:"created_at"`
			} `json:"comment"`
		}
		if err := json.Unmarshal(body, &p); err != nil {
			return err
		}
		if len(p.Issue.PullRequest) > 0 && string(p.Issue.PullRequest) != "null" {
			return nil
		}
		fresh, err := sv.logEvent(ctx, s, r, ghEvent{Kind: "comment", ExternalID: strconv.FormatInt(p.Comment.ID, 10),
			Author: p.Comment.User.Login, Title: truncate(p.Comment.Body, 200), URL: p.Comment.HTMLURL, At: p.Comment.CreatedAt})
		if err != nil || !fresh {
			return err
		}
		_, rep, err := sv.upsertIssue(ctx, s, r.ProjectID, mapGitHub(repo, p.Issue))
		if err != nil {
			return err
		}
		text := fmt.Sprintf("**@%s** on GitHub:\n\n%s", p.Comment.User.Login, truncate(p.Comment.Body, 20_000))
		if err := reports.AddComment(ctx, sv.DB, rep, "", "user", text); err != nil {
			return err
		}
		act("github.issue_comment", map[string]any{"issue": rep.Key})

	case "push":
		var p struct {
			Ref     string `json:"ref"`
			Commits []struct {
				ID        string    `json:"id"`
				Message   string    `json:"message"`
				URL       string    `json:"url"`
				Timestamp time.Time `json:"timestamp"`
				Author    struct {
					Name     string `json:"name"`
					Email    string `json:"email"`
					Username string `json:"username"`
				} `json:"author"`
			} `json:"commits"`
		}
		if err := json.Unmarshal(body, &p); err != nil {
			return err
		}
		branch := strings.TrimPrefix(p.Ref, "refs/heads/")
		n := 0
		for _, c := range p.Commits {
			fresh, err := sv.logEvent(ctx, s, r, ghEvent{Kind: "commit", ExternalID: c.ID, Ref: branch, SHA: c.ID,
				Author: firstNonEmpty(c.Author.Username, c.Author.Name), Email: c.Author.Email, Title: firstLine(c.Message), URL: c.URL, At: c.Timestamp})
			if err != nil {
				return err
			}
			if fresh {
				n++
			}
		}
		if n > 0 {
			act("github.push", map[string]any{"branch": branch, "commits": n})
		}

	case "pull_request":
		var p struct {
			PullRequest struct {
				ID      int64  `json:"id"`
				Number  int    `json:"number"`
				Title   string `json:"title"`
				HTMLURL string `json:"html_url"`
				Merged  bool   `json:"merged"`
				Head    struct {
					Ref string `json:"ref"`
					SHA string `json:"sha"`
				} `json:"head"`
				User struct {
					Login string `json:"login"`
				} `json:"user"`
				UpdatedAt time.Time `json:"updated_at"`
			} `json:"pull_request"`
		}
		if err := json.Unmarshal(body, &p); err != nil {
			return err
		}
		status := env.Action
		if env.Action == "closed" && p.PullRequest.Merged {
			status = "merged"
		}
		if _, err := sv.logEvent(ctx, s, r, ghEvent{Kind: "pull_request", ExternalID: strconv.FormatInt(p.PullRequest.ID, 10),
			Ref: p.PullRequest.Head.Ref, SHA: p.PullRequest.Head.SHA, Author: p.PullRequest.User.Login,
			Title: fmt.Sprintf("#%d %s", p.PullRequest.Number, p.PullRequest.Title), Status: status, URL: p.PullRequest.HTMLURL, At: p.PullRequest.UpdatedAt}); err != nil {
			return err
		}
		switch status {
		case "opened", "merged", "closed", "reopened":
			act("github.pull_request_"+status, map[string]any{"number": p.PullRequest.Number, "title": p.PullRequest.Title})
		}

	case "deployment_status":
		var p struct {
			DeploymentStatus struct {
				ID        int64     `json:"id"`
				State     string    `json:"state"`
				TargetURL string    `json:"target_url"`
				LogURL    string    `json:"log_url"`
				CreatedAt time.Time `json:"created_at"`
			} `json:"deployment_status"`
			Deployment struct {
				ID          int64  `json:"id"`
				Ref         string `json:"ref"`
				SHA         string `json:"sha"`
				Environment string `json:"environment"`
				Creator     struct {
					Login string `json:"login"`
				} `json:"creator"`
			} `json:"deployment"`
		}
		if err := json.Unmarshal(body, &p); err != nil {
			return err
		}
		if _, err := sv.logEvent(ctx, s, r, ghEvent{Kind: "deployment", ExternalID: strconv.FormatInt(p.Deployment.ID, 10),
			Ref: p.Deployment.Ref, SHA: p.Deployment.SHA, Author: p.Deployment.Creator.Login, Title: p.Deployment.Environment,
			Status: p.DeploymentStatus.State, URL: firstNonEmpty(p.DeploymentStatus.LogURL, p.DeploymentStatus.TargetURL), At: p.DeploymentStatus.CreatedAt}); err != nil {
			return err
		}
		switch p.DeploymentStatus.State {
		case "success", "failure", "error":
			act("github.deployment_"+p.DeploymentStatus.State, map[string]any{"environment": p.Deployment.Environment, "ref": p.Deployment.Ref})
		}

	case "workflow_run":
		var p struct {
			WorkflowRun struct {
				ID         int64     `json:"id"`
				Name       string    `json:"name"`
				HeadBranch string    `json:"head_branch"`
				HeadSHA    string    `json:"head_sha"`
				Status     string    `json:"status"`
				Conclusion *string   `json:"conclusion"`
				HTMLURL    string    `json:"html_url"`
				UpdatedAt  time.Time `json:"updated_at"`
				Actor      struct {
					Login string `json:"login"`
				} `json:"actor"`
			} `json:"workflow_run"`
		}
		if err := json.Unmarshal(body, &p); err != nil {
			return err
		}
		wr := p.WorkflowRun
		status := firstNonEmpty(deref(wr.Conclusion), wr.Status)
		if _, err := sv.logEvent(ctx, s, r, ghEvent{Kind: "workflow_run", ExternalID: strconv.FormatInt(wr.ID, 10), Ref: wr.HeadBranch,
			SHA: wr.HeadSHA, Author: wr.Actor.Login, Title: wr.Name, Status: status, URL: wr.HTMLURL, At: wr.UpdatedAt}); err != nil {
			return err
		}
		if env.Action == "completed" {
			act("github.workflow_run", map[string]any{"workflow": wr.Name, "branch": wr.HeadBranch, "conclusion": status})
		}
	}
	return nil
}

type ghEvent struct {
	Kind, ExternalID, Ref, SHA, Author, Email, Title, Status, URL string
	At                                                            time.Time
}

// logEvent records (or, for PRs / runs / deployments, updates the status of) one event. fresh
// reports whether it was new — the dedupe for redelivered comments and commits.
func (sv *Service) logEvent(ctx context.Context, s *tenant.Scope, r *row, e ghEvent) (bool, error) {
	if e.At.IsZero() {
		e.At = time.Now().UTC()
	}
	var inserted bool
	err := sv.DB.QueryRowContext(ctx, `
		INSERT INTO github_events (workspace_id, project_id, kind, external_id, repo, ref, sha, author_login, author_email, title, status, url, occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		ON CONFLICT (workspace_id, project_id, kind, external_id) DO UPDATE SET
			status = EXCLUDED.status, url = CASE WHEN EXCLUDED.url <> '' THEN EXCLUDED.url ELSE github_events.url END,
			occurred_at = GREATEST(github_events.occurred_at, EXCLUDED.occurred_at)
		RETURNING (xmax = 0)`,
		s.WorkspaceID, r.ProjectID, e.Kind, e.ExternalID, r.cfg("repo"), truncate(e.Ref, 250), e.SHA, truncate(e.Author, 100),
		truncate(e.Email, 200), truncate(e.Title, 500), truncate(e.Status, 50), truncate(e.URL, 1000), e.At).Scan(&inserted)
	return inserted, err
}
