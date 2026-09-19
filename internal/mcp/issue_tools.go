package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
IssueTools are the per-workspace issue tools of the user MCP. They operate on the
token's CURRENT workspace (tenant.Scope), NOT the platform workspace: the
workspace's own issues, filed by the in-app "Report a problem" dialog, the client
portal, the embeddable Feedback widget and the server SDKs.

	list_issues, get_issue, list_mentions                     issues:read
	create_issue, comment_issue, update_issue, reorder_issue  issues:write
	start_issue, review_issue, finish_issue, request_approval issues:write

The lifecycle tools are the fadymondy.com-v2 agent loop (see internal/reports/
lifecycle.go and .claude/skills/issues): an agent starts an issue with a plan,
hands it to review with a note, or parks it on a question. Their comments carry
author_kind=agent, which is what answers a mention.

They run on the RLS app pool (a.SQLDB), and reports.* still carries an explicit
workspace_id predicate. A project argument goes through work.FindProject, so an
agent can only name a project its user can see.
*/
func IssueTools() []Tool {
	return []Tool{
		{
			Name:        "list_issues",
			Description: "The workspace's issues in board order (the order to work them in). Filter by project, status, state, priority, type or a title search. human_only issues are hidden unless include_human_only.",
			Scope:       "issues:read",
			InputSchema: schema(nil, map[string]any{
				"project":            prop("string", "Project id or exact name"),
				"status":             prop("string", "backlog, todo, in_progress, waiting_approval, in_review, done"),
				"state":              prop("string", "open or closed"),
				"priority":           prop("string", "Filter on priority"),
				"type":               prop("string", "bug, feature, task, story or epic"),
				"q":                  prop("string", "Title contains"),
				"include_human_only": prop("boolean", "Also list issues reserved for humans"),
				"limit":              prop("integer", "Default 50"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				projectID, err := projectArg(ctx, a, str(args, "project"))
				if err != nil {
					return "", err
				}
				rows, err := reports.List(ctx, a.SQLDB, tenant.WorkspaceID(ctx), reports.Filter{
					Status: str(args, "status"), State: str(args, "state"), IssueType: str(args, "type"),
					Q: str(args, "q"), ProjectID: projectID, HideHumanOnly: !boolArg(args, "include_human_only"),
					Limit: intArg(args, "limit", 50),
				})
				if err != nil {
					return "", err
				}
				if p := str(args, "priority"); p != "" {
					kept := rows[:0]
					for _, r := range rows {
						if r.Priority == p {
							kept = append(kept, r)
						}
					}
					rows = kept
				}
				return reports.FormatList(rows), nil
			},
		},
		{
			Name:        "get_issue",
			Description: "One workspace issue in full with its comment thread and the captured page, selector, console and network logs. Accepts the key (MG-12) or the id.",
			Scope:       "issues:read",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "MG-12 or id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				r, err := findIssue(ctx, a, str(decodeArgs(raw), "key"))
				if err != nil {
					return "", err
				}
				comments, _ := reports.Comments(ctx, a.SQLDB, r.WorkspaceID, r.ID)
				return reports.FormatOne(r, comments), nil
			},
		},
		{
			Name:        "list_mentions",
			Description: "Unanswered comments addressed to the agent (@agent, @claude, @ai) on open issues, oldest first. Check these before the board: a mention outranks it.",
			Scope:       "issues:read",
			InputSchema: schema(nil, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"limit":   prop("integer", "Default 20"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				projectID, err := projectArg(ctx, a, str(args, "project"))
				if err != nil {
					return "", err
				}
				ms, err := reports.Mentions(ctx, a.SQLDB, tenant.WorkspaceID(ctx), projectID, intArg(args, "limit", 20))
				if err != nil {
					return "", err
				}
				return reports.FormatMentions(ms), nil
			},
		},
		{
			Name:        "create_issue",
			Description: "File a new issue into the workspace, optionally in a project. The server allocates the MG-n key.",
			Scope:       "issues:write",
			InputSchema: schema([]string{"title"}, map[string]any{
				"title":      prop("string", "Short summary"),
				"body":       prop("string", "Markdown details"),
				"project":    prop("string", "Project id or exact name"),
				"issue_type": map[string]any{"type": "string", "enum": []string{"bug", "feature", "task", "story", "epic"}},
				"priority":   map[string]any{"type": "string", "enum": []string{"highest", "high", "medium", "low", "lowest"}},
				"status":     map[string]any{"type": "string", "enum": reports.Statuses},
				"route":      prop("string", "App route the issue is about"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				s, _ := tenant.From(ctx)
				title := strings.TrimSpace(str(args, "title"))
				if title == "" {
					return "", errors.New("title is required")
				}
				projectID, err := projectArg(ctx, a, str(args, "project"))
				if err != nil {
					return "", err
				}
				r, err := reports.Create(ctx, a.SQLDB, s.WorkspaceID, reports.NewReport{
					Title: truncateStr(title, 200), Body: str(args, "body"), IssueType: firstOf(str(args, "issue_type"), "task"),
					Priority: str(args, "priority"), Status: str(args, "status"), Route: str(args, "route"),
					ReporterID: s.UserID, ProjectID: projectID, Source: "mcp",
				})
				if err != nil {
					return "", err
				}
				return fmt.Sprintf("Created %s: %s", r.Key, r.Title), nil
			},
		},
		{
			Name:        "comment_issue",
			Description: "Reply on a workspace issue as the token's user. as_agent=true records it as the agent (answers a mention).",
			Scope:       "issues:write",
			InputSchema: schema([]string{"key", "body"}, map[string]any{
				"key": prop("string", "MG-12 or id"), "body": prop("string", "Markdown"),
				"as_agent": prop("boolean", "Record with author_kind=agent"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				s, _ := tenant.From(ctx)
				r, err := findIssue(ctx, a, str(args, "key"))
				if err != nil {
					return "", err
				}
				body := str(args, "body")
				if body == "" {
					return "", errors.New("body is required")
				}
				kind := "user"
				if boolArg(args, "as_agent") {
					kind = "agent"
				}
				if err := reports.AddComment(ctx, a.SQLDB, r, s.UserID, kind, body); err != nil {
					return "", err
				}
				return fmt.Sprintf("Commented on %s.", r.Key), nil
			},
		},
		{
			Name:        "update_issue",
			Description: "Triage a workspace issue: status, priority, type, title, body, state (open/closed), resolution, human_only, and its agent strategy (agent, skill, ai_model, ai_effort).",
			Scope:       "issues:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key":        prop("string", "MG-12 or id"),
				"status":     map[string]any{"type": "string", "enum": reports.Statuses},
				"priority":   map[string]any{"type": "string", "enum": []string{"highest", "high", "medium", "low", "lowest"}},
				"issue_type": map[string]any{"type": "string", "enum": []string{"bug", "feature", "task", "story", "epic"}},
				"title":      prop("string", "New title"),
				"body":       prop("string", "New body (markdown)"),
				"state":      map[string]any{"type": "string", "enum": []string{"open", "closed"}},
				"resolution": prop("string", "What was done (kept when closing)"),
				"human_only": prop("boolean", "Reserve for humans: agents may not start it"),
				"agent":      prop("string", "Subagent that should work it (\"\" clears)"),
				"skill":      prop("string", "Skill to run for it (\"\" clears)"),
				"ai_model":   prop("string", "opus, sonnet, haiku or fable (\"\" clears)"),
				"ai_effort":  map[string]any{"type": "string", "enum": append([]string{""}, reports.Efforts...)},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				s, _ := tenant.From(ctx)
				r, err := findIssue(ctx, a, str(args, "key"))
				if err != nil {
					return "", err
				}
				fields := map[string]any{}
				changed := []string{}
				if status := str(args, "status"); status != "" {
					if !reports.ValidStatus(status) {
						return "", fmt.Errorf("unknown status %q (use one of: %s)", status, strings.Join(reports.Statuses, ", "))
					}
					fields["status"] = status
					switch {
					case status == "done":
						fields["state"], fields["closed_at"] = "closed", time.Now().UTC()
					case r.Status == "done":
						fields["state"], fields["closed_at"] = "open", nil
					}
					changed = append(changed, fmt.Sprintf("status %s → %s", r.Status, status))
				}
				if state := str(args, "state"); state != "" {
					if state != "open" && state != "closed" {
						return "", fmt.Errorf("state must be open or closed")
					}
					fields["state"] = state
					changed = append(changed, "state "+state)
				}
				for _, f := range []string{"priority", "issue_type", "title", "body"} {
					if v := str(args, f); v != "" {
						fields[f] = v
						changed = append(changed, f)
					}
				}
				if res := str(args, "resolution"); res != "" {
					fields["resolution"] = res
					changed = append(changed, "resolution set")
				}
				if _, ok := args["human_only"]; ok {
					fields["human_only"] = boolArg(args, "human_only")
					changed = append(changed, fmt.Sprintf("human_only %v", fields["human_only"]))
				}
				for _, f := range []string{"agent", "skill", "ai_model", "ai_effort"} {
					if v, ok := args[f].(string); ok {
						if v = strings.TrimSpace(v); v == "" {
							fields[f] = nil
						} else {
							fields[f] = v
						}
						changed = append(changed, f)
					}
				}
				if len(fields) == 0 {
					return fmt.Sprintf("%s unchanged.", r.Key), nil
				}
				if err := reports.Update(ctx, a.SQLDB, r, fields); err != nil {
					return "", fmt.Errorf("could not update: %w", err)
				}
				note := fmt.Sprintf("By %s via MCP: %s", s.Email, strings.Join(changed, ", "))
				if res := str(args, "resolution"); res != "" {
					note += "\n\n" + res
				}
				_ = reports.AddComment(ctx, a.SQLDB, r, s.UserID, "user", note)
				return fmt.Sprintf("%s: %s.", r.Key, strings.Join(changed, ", ")), nil
			},
		},
		{
			Name:        "reorder_issue",
			Description: "Move an issue just before or just after another on the board; it takes that issue's status.",
			Scope:       "issues:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key":    prop("string", "MG-12 or id"),
				"before": prop("string", "Place before this issue"),
				"after":  prop("string", "Place after this issue"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := findIssue(ctx, a, str(args, "key"))
				if err != nil {
					return "", err
				}
				ref, after := str(args, "before"), false
				if v := str(args, "after"); v != "" {
					ref, after = v, true
				}
				if ref == "" {
					return "", errors.New("give before or after")
				}
				anchor, err := findIssue(ctx, a, ref)
				if err != nil {
					return "", err
				}
				if err := reports.Reorder(ctx, a.SQLDB, r, anchor, after); err != nil {
					return "", err
				}
				where := "before"
				if after {
					where = "after"
				}
				return fmt.Sprintf("Moved %s %s %s (%s).", r.Key, where, anchor.Key, anchor.Status), nil
			},
		},
		lifecycleTool("start_issue",
			"Start working an issue: posts your plan as a comment, moves it to in_progress and starts its clock. Refuses without a plan, and refuses human_only issues.",
			"plan", "What you will change and how you will verify it",
			func(ctx context.Context, a *app.App, r *reports.Report, uid, v string) (string, error) {
				return "Started " + r.Key + ".", reports.Start(ctx, a.SQLDB, r, uid, "agent", v)
			}),
		lifecycleTool("review_issue",
			"The normal end of agent work: moves the issue to in_review, banks the time and posts \"Ready for review\" with your note.",
			"note", "What changed and how it was verified",
			func(ctx context.Context, a *app.App, r *reports.Report, uid, v string) (string, error) {
				return r.Key + " is ready for review.", reports.Review(ctx, a.SQLDB, r, uid, "agent", v)
			}),
		lifecycleTool("request_approval",
			"Blocked or partial work: moves the issue to waiting_approval, banks the time and posts the decision you need. Never mark unfinished work in_review or done.",
			"question", "The decision a human must make",
			func(ctx context.Context, a *app.App, r *reports.Report, uid, v string) (string, error) {
				return r.Key + " is waiting for a decision.", reports.RequestApproval(ctx, a.SQLDB, r, uid, "agent", v)
			}),
		{
			Name:        "finish_issue",
			Description: "Close an issue as done (only for work a human already accepted; otherwise use review_issue). Banks the time.",
			Scope:       "issues:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key": prop("string", "MG-12 or id"), "resolution": prop("string", "What was done"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				s, _ := tenant.From(ctx)
				r, err := findIssue(ctx, a, str(args, "key"))
				if err != nil {
					return "", err
				}
				if err := reports.Finish(ctx, a.SQLDB, r, s.UserID, "agent", str(args, "resolution")); err != nil {
					return "", err
				}
				return "Finished " + r.Key + ".", nil
			},
		},
	}
}

func lifecycleTool(name, desc, field, fieldDesc string, run func(context.Context, *app.App, *reports.Report, string, string) (string, error)) Tool {
	return Tool{
		Name:        name,
		Description: desc,
		Scope:       "issues:write",
		InputSchema: schema([]string{"key", field}, map[string]any{
			"key": prop("string", "MG-12 or id"), field: prop("string", fieldDesc),
		}),
		Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
			args := decodeArgs(raw)
			s, _ := tenant.From(ctx)
			r, err := findIssue(ctx, a, str(args, "key"))
			if err != nil {
				return "", err
			}
			msg, err := run(ctx, a, r, s.UserID, str(args, field))
			if err != nil {
				return "", err
			}
			return msg, nil
		},
	}
}

func findIssue(ctx context.Context, a *app.App, ref string) (*reports.Report, error) {
	r, err := reports.Find(ctx, a.SQLDB, tenant.WorkspaceID(ctx), ref)
	if err != nil {
		return nil, fmt.Errorf("issue %q not found", ref)
	}
	return r, nil
}

// projectArg resolves an optional project reference through the domain layer, so
// the token's user must be able to see it; "" means no project filter.
func projectArg(ctx context.Context, a *app.App, ref string) (string, error) {
	if strings.TrimSpace(ref) == "" {
		return "", nil
	}
	p, err := work.New(a).FindProject(ctx, ref)
	if err != nil {
		return "", toolErr(err)
	}
	return p.ID, nil
}

func firstOf(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func truncateStr(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
