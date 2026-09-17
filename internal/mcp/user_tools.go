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
	"github.com/fadymondy/managy/internal/work"
	"github.com/fadymondy/managy/internal/workspaces"
)

/*
UserTools is the user MCP registry. P0 ships the context and feedback tools;
the project, task, time, report, client and invoice tools of the plan arrive
with the phases that build those tables (P1–P6) — a tool is not registered
before the thing it operates on exists.

Every tool reads its workspace from the token (tenant.Scope on ctx), never
from an argument, and the feedback tools go through the RLS app pool.
*/
func UserTools() []Tool {
	return append(append(append(append(append(append(contextTools(), WorkTools()...), TimeTools()...), ReportTools()...), IssueTools()...), InvoiceTools()...), FeedbackKeyTools()...)
}

func contextTools() []Tool {
	return []Tool{
		{
			Name:        "whoami",
			Description: "Who this token acts as: workspace, user, role, the scopes in effect and the running timer.",
			Scope:       "members:read",
			InputSchema: schema(nil, map[string]any{}),
			Run: func(ctx context.Context, a *app.App, _ json.RawMessage) (string, error) {
				s, ok := tenant.From(ctx)
				if !ok {
					return "", errNotFound
				}
				var b strings.Builder
				fmt.Fprintf(&b, "workspace: %s (%s) id=%s\n", s.WorkspaceName, s.WorkspaceSlug, s.WorkspaceID)
				fmt.Fprintf(&b, "user: %s id=%s\n", s.Email, s.UserID)
				fmt.Fprintf(&b, "role: %s\n", s.Role)
				fmt.Fprintf(&b, "scopes: %s\n", strings.Join(nonEmpty(s.Scopes), ", "))
				switch {
				case !hasScope(s.Scopes, "time:read"):
					b.WriteString("running timer: (this token has no time:read scope)\n")
				default:
					sv := work.New(a)
					if e, err := sv.RunningTimer(ctx, ""); err != nil {
						fmt.Fprintf(&b, "running timer: unavailable (%s)\n", toolErr(err))
					} else if e == nil {
						b.WriteString("running timer: none\n")
					} else {
						b.WriteString("running timer: " + entryLine(e, zone(ctx, sv), true) + "\n")
					}
				}
				return b.String(), nil
			},
		},
		{
			Name:        "list_members",
			Description: "Members of the token's workspace with their roles.",
			Scope:       "members:read",
			InputSchema: schema(nil, map[string]any{}),
			Run: func(ctx context.Context, a *app.App, _ json.RawMessage) (string, error) {
				s, ok := tenant.From(ctx)
				if !ok {
					return "", errNotFound
				}
				list, err := workspaces.Members(ctx, a.SysDB, s.WorkspaceID)
				if err != nil {
					return "", fmt.Errorf("could not list members: %w", err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%d member(s) of %s:\n", len(list), s.WorkspaceSlug)
				for _, m := range list {
					fmt.Fprintf(&b, "  %-8s %s  (%s)\n", m.Role, m.Email, m.Status)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "list_feedback",
			Description: "Feedback issues filed in this workspace. Filter by status, state or a title search.",
			Scope:       "feedback:read",
			InputSchema: schema(nil, map[string]any{
				"status": prop("string", "backlog, todo, in_progress, waiting_approval, in_review, done"),
				"state":  prop("string", "open or closed"),
				"q":      prop("string", "Title contains"),
				"limit":  prop("integer", "Default 50"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				rows, err := reports.List(ctx, a.SQLDB, tenant.WorkspaceID(ctx), reports.Filter{
					Status: str(args, "status"), State: str(args, "state"), Q: str(args, "q"), Limit: intArg(args, "limit", 50),
				})
				if err != nil {
					return "", err
				}
				return reports.FormatList(rows), nil
			},
		},
		{
			Name:        "get_feedback",
			Description: "One feedback issue in full with its comment thread. Accepts the key (MG-12) or the id.",
			Scope:       "feedback:read",
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
			Name:        "comment_feedback",
			Description: "Reply on a feedback issue, as the token's user (recorded with author_kind=agent).",
			Scope:       "feedback:write",
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
				if err := reports.AddComment(ctx, a.SQLDB, r, s.UserID, "agent", body); err != nil {
					return "", err
				}
				return fmt.Sprintf("Commented on %s.", r.Key), nil
			},
		},
	}
}

var _ = time.Now
