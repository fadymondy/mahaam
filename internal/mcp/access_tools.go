package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
AccessTools manage who sees what (internal/work/access.go): label grants give a user or a
team every project carrying a label; task grants give one task (and a read of its project).
Adding a team to a project (project teams) is the existing set_project_team path in the UI.
All manager+ (access:manage), on the token's tenant.Scope.
*/
func AccessTools() []Tool {
	return []Tool{
		{
			Name:        "list_access",
			Description: "Access grants in the workspace, optionally for one user/team or one label/task.",
			Scope:       "access:manage",
			InputSchema: schema(nil, map[string]any{
				"subject_type": map[string]any{"type": "string", "enum": []string{"", "user", "team"}},
				"subject_id":   prop("string", "User or team id"),
				"scope_type":   map[string]any{"type": "string", "enum": []string{"", "label", "task"}},
				"scope_id":     prop("string", "Label or task id"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				list, err := work.New(a).ListGrants(ctx, work.GrantFilter{SubjectType: str(args, "subject_type"), SubjectID: str(args, "subject_id"),
					ScopeType: str(args, "scope_type"), ScopeID: str(args, "scope_id")})
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No access grants.", nil
				}
				var b strings.Builder
				for _, g := range list {
					fmt.Fprintf(&b, "%s %s → %s %s  (id %s)\n", g.SubjectType, g.SubjectName, g.ScopeType, g.ScopeName, g.ID)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "grant_access",
			Description: "Give an employee (email or id) or a team (name or id) access to every project carrying a label, or to one task (MG-12).",
			Scope:       "access:manage",
			InputSchema: schema([]string{"subject_type", "subject", "scope_type", "scope"}, map[string]any{
				"subject_type": map[string]any{"type": "string", "enum": []string{"user", "team"}},
				"subject":      prop("string", "Email or user id; or team name or id"),
				"scope_type":   map[string]any{"type": "string", "enum": []string{"label", "task"}},
				"scope":        prop("string", "Label name or id; or task key or id"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				g, err := work.New(a).CreateGrant(ctx, work.GrantInput{SubjectType: str(args, "subject_type"), Subject: str(args, "subject"),
					ScopeType: str(args, "scope_type"), Scope: str(args, "scope")})
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Granted: %s %s → %s %s (id %s).", g.SubjectType, g.SubjectName, g.ScopeType, g.ScopeName, g.ID), nil
			},
		},
		{
			Name:        "revoke_access",
			Description: "Revoke an access grant by id (see list_access).",
			Scope:       "access:manage",
			InputSchema: schema([]string{"id"}, map[string]any{"id": prop("string", "Grant id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				if err := work.New(a).DeleteGrant(ctx, str(decodeArgs(raw), "id")); err != nil {
					return "", toolErr(err)
				}
				return "Revoked.", nil
			},
		},
		{
			Name:        "set_project_labels",
			Description: "Replace the labels a project carries (label grants follow them). Labels by exact name or id.",
			Scope:       "access:manage",
			InputSchema: schema([]string{"project", "labels"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"labels":  arrProp("Label names or ids; [] clears"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				list, err := work.New(a).SetProjectLabels(ctx, str(args, "project"), strList(args, "labels"))
				if err != nil {
					return "", toolErr(err)
				}
				names := make([]string, len(list))
				for i, l := range list {
					names[i] = l.Name
				}
				return "Labels: " + strings.Join(names, ", "), nil
			},
		},
	}
}
