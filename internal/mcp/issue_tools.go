package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/managy/internal/app"
	"github.com/fadymondy/managy/internal/reports"
	"github.com/fadymondy/managy/internal/tenant"
)

/*
IssueTools are the per-workspace issue tools of the user MCP. They operate on the
token's CURRENT workspace (tenant.Scope), NOT the platform workspace — these are
the workspace's own "Report a problem" intake, filed into the workspace by
internal/reports/feedback.go when the request names one.

	list_issues, get_issue      issues:read
	comment_issue, update_issue issues:write

They run on the RLS app pool (a.SQLDB), and reports.* still carries an explicit
workspace_id predicate. Kept separate from the platform feedback tools, which
read the same tables but for Managy's own bug reports.
*/
func IssueTools() []Tool {
	return []Tool{
		{
			Name:        "list_issues",
			Description: "The workspace's own issues (its \"Report a problem\" intake). Filter by status, priority, type or a title search.",
			Scope:       "issues:read",
			InputSchema: schema(nil, map[string]any{
				"status":   prop("string", "backlog, todo, in_progress, waiting_approval, in_review, done"),
				"priority": prop("string", "Filter on priority"),
				"type":     prop("string", "bug, feature or task"),
				"q":        prop("string", "Title contains"),
				"limit":    prop("integer", "Default 50"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				rows, err := reports.List(ctx, a.SQLDB, tenant.WorkspaceID(ctx), reports.Filter{
					Status: str(args, "status"), IssueType: str(args, "type"), Q: str(args, "q"), Limit: intArg(args, "limit", 50),
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
			Description: "One workspace issue in full with its comment thread. Accepts the key (MG-12) or the id.",
			Scope:       "issues:read",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "MG-12 or id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				r, err := reports.Find(ctx, a.SQLDB, tenant.WorkspaceID(ctx), str(decodeArgs(raw), "key"))
				if err != nil {
					return "", errors.New("issue not found")
				}
				comments, _ := reports.Comments(ctx, a.SQLDB, r.WorkspaceID, r.ID)
				return reports.FormatOne(r, comments), nil
			},
		},
		{
			Name:        "comment_issue",
			Description: "Reply on a workspace issue, as the token's user (recorded with author_kind=user).",
			Scope:       "issues:write",
			InputSchema: schema([]string{"key", "body"}, map[string]any{
				"key": prop("string", "MG-12 or id"), "body": prop("string", "Markdown"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				s, _ := tenant.From(ctx)
				r, err := reports.Find(ctx, a.SQLDB, s.WorkspaceID, str(args, "key"))
				if err != nil {
					return "", errors.New("issue not found")
				}
				body := str(args, "body")
				if body == "" {
					return "", errors.New("body is required")
				}
				if err := reports.AddComment(ctx, a.SQLDB, r, s.UserID, "user", body); err != nil {
					return "", err
				}
				return fmt.Sprintf("Commented on %s.", r.Key), nil
			},
		},
		{
			Name:        "update_issue",
			Description: "Triage a workspace issue: change its status, priority, state (open/closed) or resolution note.",
			Scope:       "issues:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key":        prop("string", "MG-12 or id"),
				"status":     map[string]any{"type": "string", "enum": reports.Statuses},
				"priority":   prop("string", "New priority"),
				"state":      map[string]any{"type": "string", "enum": []string{"open", "closed"}},
				"resolution": prop("string", "What was done (kept when closing)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				s, _ := tenant.From(ctx)
				r, err := reports.Find(ctx, a.SQLDB, s.WorkspaceID, str(args, "key"))
				if err != nil {
					return "", errors.New("issue not found")
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
				if p := str(args, "priority"); p != "" {
					fields["priority"] = p
					changed = append(changed, "priority "+p)
				}
				if res := str(args, "resolution"); res != "" {
					fields["resolution"] = res
					changed = append(changed, "resolution set")
				}
				if len(fields) == 0 {
					return fmt.Sprintf("%s unchanged (give status, priority, state or resolution).", r.Key), nil
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
	}
}
