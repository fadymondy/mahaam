package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/integrations"
)

/*
IntegrationTools expose a project's GitHub / Jira / Linear integrations over the user MCP. Each
calls the same internal/integrations method as the REST API on the token's tenant.Scope, so the
project must be visible and authz.Matrix applies (sync manager+, deploy manager+).
*/
func IntegrationTools() []Tool {
	project := prop("string", "Project id or exact name")
	return []Tool{
		{
			Name:        "list_integrations",
			Description: "A project's integrations (github, jira, linear): status, last sync, last error and non-secret settings.",
			Scope:       "integrations:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": project}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				list, err := integrations.New(a).List(ctx, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No integrations on that project.", nil
				}
				var b strings.Builder
				for _, i := range list {
					fmt.Fprintf(&b, "%s  [%s]", i.Provider, i.Status)
					for _, k := range []string{"repo", "base_url", "project_key", "jql", "team_id"} {
						if v, ok := i.Config[k].(string); ok && v != "" {
							fmt.Fprintf(&b, "  %s=%s", k, v)
						}
					}
					if i.LastSyncedAt != nil {
						fmt.Fprintf(&b, "  last sync %s", i.LastSyncedAt.Format(time.RFC3339))
					}
					if i.LastError != nil {
						fmt.Fprintf(&b, "\n    error: %s", *i.LastError)
					}
					b.WriteString("\n")
				}
				return b.String(), nil
			},
		},
		{
			Name:        "sync_integration",
			Description: "Import now: Jira / Linear issues, or GitHub's open issues (and push Mahaam close/reopen to GitHub). Imported issues become MG issues of the project; re-syncing updates them.",
			Scope:       "integrations:write",
			InputSchema: schema([]string{"project", "provider"}, map[string]any{
				"project":  project,
				"provider": map[string]any{"type": "string", "enum": integrations.Providers},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				res, err := integrations.New(a).Sync(ctx, str(args, "project"), str(args, "provider"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("%s synced: %d fetched, %d created, %d updated, %d mirrored to GitHub.", res.Provider, res.Fetched, res.Created, res.Updated, res.Mirrored), nil
			},
		},
		{
			Name:        "github_list_commits",
			Description: "Recent commits of the project's linked GitHub repository.",
			Scope:       "integrations:read",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": project,
				"branch":  prop("string", "Branch (default: the repository's default branch)"),
				"since":   prop("string", "YYYY-MM-DD or RFC 3339"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				list, err := integrations.New(a).Commits(ctx, str(args, "project"), str(args, "branch"), str(args, "since"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No commits.", nil
				}
				var b strings.Builder
				for _, c := range list {
					fmt.Fprintf(&b, "%s  %s  %s  %s\n", c.SHA[:min(7, len(c.SHA))], c.Date.Format("2006-01-02 15:04"), firstNonEmpty(c.AuthorLogin, c.AuthorName), c.Message)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "github_list_pulls",
			Description: "Pull requests of the project's linked GitHub repository.",
			Scope:       "integrations:read",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": project,
				"state":   map[string]any{"type": "string", "enum": []string{"open", "closed", "all"}},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				list, err := integrations.New(a).Pulls(ctx, str(args, "project"), str(args, "state"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No pull requests.", nil
				}
				var b strings.Builder
				for _, p := range list {
					state := p.State
					if p.MergedAt != nil {
						state = "merged"
					} else if p.Draft {
						state += ", draft"
					}
					fmt.Fprintf(&b, "#%d [%s] %s  (%s → %s, @%s)  %s\n", p.Number, state, p.Title, p.Head, p.Base, p.Author, p.URL)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "github_list_runs",
			Description: "Recent GitHub Actions workflow runs and deployments of the project's linked repository.",
			Scope:       "integrations:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": project}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				sv := integrations.New(a)
				ref := str(decodeArgs(raw), "project")
				runs, err := sv.Runs(ctx, ref)
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%d run(s):\n", len(runs))
				for _, r := range runs {
					fmt.Fprintf(&b, "  %d %s [%s/%s] %s %s\n", r.ID, r.Name, r.Status, r.Conclusion, r.Branch, r.URL)
				}
				if deps, err := sv.Deployments(ctx, ref); err == nil {
					fmt.Fprintf(&b, "%d deployment(s):\n", len(deps))
					for _, d := range deps {
						fmt.Fprintf(&b, "  %s %s [%s] %s\n", d.Environment, d.Ref, d.State, d.CreatedAt.Format(time.RFC3339))
					}
				}
				return b.String(), nil
			},
		},
		{
			Name:        "github_deploy",
			Description: "Trigger a deploy: workflow_dispatch of a workflow (id or file name, e.g. deploy.yml) on a ref, with optional inputs. Manager+.",
			Scope:       "github:write",
			InputSchema: schema([]string{"project", "workflow"}, map[string]any{
				"project":  project,
				"workflow": prop("string", "Workflow id or file name"),
				"ref":      prop("string", "Branch or tag (default: the repository's default branch)"),
				"inputs":   map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "workflow_dispatch inputs"},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				in := integrations.DeployInput{Workflow: str(args, "workflow"), Ref: str(args, "ref"), Inputs: map[string]string{}}
				if m, ok := args["inputs"].(map[string]any); ok {
					for k, v := range m {
						in.Inputs[k] = fmt.Sprint(v)
					}
				}
				if err := integrations.New(a).Deploy(ctx, str(args, "project"), in); err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Dispatched %s. Watch it with github_list_runs.", in.Workflow), nil
			},
		},
		{
			Name:        "github_create_issue_from",
			Description: "File a GitHub issue in the project's linked repository from a Mahaam issue (MG-12) and link them; close/reopen then mirror both ways.",
			Scope:       "github:write",
			InputSchema: schema([]string{"project", "issue"}, map[string]any{
				"project": project,
				"issue":   prop("string", "MG-12 or the issue id"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				rep, url, err := integrations.New(a).CreateIssueFrom(ctx, str(args, "project"), str(args, "issue"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("%s is now %s", rep.Key, url), nil
			},
		},
	}
}
