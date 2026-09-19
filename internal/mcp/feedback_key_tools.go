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
			Name:        "set_feedback_widget",
			Description: "Customise how a feedback key's launcher looks on the customer's site: colour, text colour, icon, text, shape, initial position, theme and language. Replaces the stored look; omit a field for the Mahaam default.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key":        prop("string", "The feedback key id"),
				"color":      prop("string", "#rrggbb launcher background"),
				"text_color": prop("string", "#rrggbb launcher text and icon"),
				"icon":       map[string]any{"type": "string", "enum": []string{"bug", "message", "help", "lightbulb", "megaphone", "sparkles", "none"}},
				"text":       prop("string", "Launcher label, up to 40 characters"),
				"shape":      map[string]any{"type": "string", "enum": []string{"pill", "circle", "square", "tab"}},
				"position":   map[string]any{"type": "string", "enum": []string{"bottom-end", "bottom-start", "top-end", "top-start", "middle-end", "middle-start"}},
				"theme":      map[string]any{"type": "string", "enum": []string{"auto", "light", "dark"}},
				"locale":     map[string]any{"type": "string", "enum": []string{"auto", "en", "ar"}},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				cfg := work.WidgetConfig{
					Color: str(args, "color"), TextColor: str(args, "text_color"), Icon: str(args, "icon"), Text: str(args, "text"),
					Shape: str(args, "shape"), Position: str(args, "position"), Theme: str(args, "theme"), Locale: str(args, "locale"),
				}
				k, err := work.New(a).UpdateFeedbackKey(ctx, str(args, "key"), nil, nil, nil, &cfg)
				if err != nil {
					return "", toolErr(err)
				}
				b, _ := json.Marshal(k.Widget)
				return fmt.Sprintf("Widget for %s is now %s.", k.PublicKey, b), nil
			},
		},
		{
			Name:        "get_feedback_install",
			Description: "Everything needed to connect a project's Feedback SDK: the key, env vars and install steps for a stack (laravel, node, next, go, python, html), or stack=agent for a complete prompt to hand to a coding agent working in the target repo.",
			Scope:       "projects:read",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"stack":   map[string]any{"type": "string", "enum": work.FeedbackStacks, "description": "Default agent"},
				"key":     prop("string", "Key id or pfk_…; default the newest active key"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				inst, err := work.New(a).GetFeedbackInstall(ctx, str(args, "project"), str(args, "key"))
				if err != nil {
					return "", toolErr(err)
				}
				stack := str(args, "stack")
				if stack == "" {
					stack = "agent"
				}
				g, ok := inst.Guides[stack]
				if !ok {
					return "", fmt.Errorf("unknown stack %q (use one of: %s)", stack, strings.Join(work.FeedbackStacks, ", "))
				}
				return g, nil
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
