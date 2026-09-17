package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fadymondy/managy/internal/app"
	"github.com/fadymondy/managy/internal/work"
)

/*
FeedbackKeyTools expose the per-project public feedback keys over the user MCP,
so an agent can provision the embeddable widget for a client the same way the
settings page does. Each calls the same internal/work method as the REST API, on
the token's tenant.Scope, so an agent never exceeds its human's role (manager+).

Listing needs projects:read; minting and revoking are project-configuration
writes and take projects:write (manager+), matching the REST authz.
*/
func FeedbackKeyTools() []Tool {
	return []Tool{
		{
			Name:        "list_project_feedback_keys",
			Description: "The public feedback keys (pfk_…) of a project, with their allowed origins and active flag.",
			Scope:       "projects:read",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				keys, err := work.New(a).ListFeedbackKeys(ctx, str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(keys) == 0 {
					return "No feedback keys on that project yet.", nil
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%d key(s):\n\n", len(keys))
				for _, k := range keys {
					state := "active"
					if !k.Active {
						state = "revoked"
					}
					origins := strings.Join(k.AllowedOrigins, ", ")
					if origins == "" {
						origins = "(none set — the widget is blocked until origins are added)"
					}
					fmt.Fprintf(&b, "%s  [%s]  %s\n    origins: %s\n    id: %s\n", k.PublicKey, state, k.Name, origins, k.ID)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "create_project_feedback_key",
			Description: "Mint a public feedback key for a project's embeddable widget. Pass allowed_origins (e.g. https://client.example.com) or the widget stays blocked until they are set.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project":         prop("string", "Project id or exact name"),
				"name":            prop("string", "A label for the key (optional)"),
				"allowed_origins": arrProp("Origins allowed to POST feedback"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				k, err := work.New(a).CreateFeedbackKey(ctx, str(args, "project"), str(args, "name"), strList(args, "allowed_origins"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Minted %s for project %s.\n  origins: %s\n  id: %s",
					k.PublicKey, k.ProjectID, strings.Join(k.AllowedOrigins, ", "), k.ID), nil
			},
		},
		{
			Name:        "revoke_project_feedback_key",
			Description: "Revoke a public feedback key. The embed endpoint refuses it afterwards.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key": prop("string", "The feedback key id"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				if err := work.New(a).RevokeFeedbackKey(ctx, str(args, "key")); err != nil {
					return "", toolErr(err)
				}
				return "Revoked.", nil
			},
		},
	}
}
