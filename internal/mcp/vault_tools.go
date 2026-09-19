package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
VaultTools expose a project's vault over the user MCP: its MEMORY (notes an agent
recalls before working and writes back what it learned) and its SECRETS (listed by
title/hint only; revealing one needs vault:secrets on the token AND manager+ or the
project lead on its user, and every reveal is recorded in the activity feed).

	vault_recall, vault_list                   vault:read
	vault_remember, vault_update, vault_forget vault:write
	vault_store_secret, vault_reveal_secret    vault:secrets

Each calls internal/work (the same methods as the REST API) on the token's tenant.Scope.
*/
func VaultTools() []Tool {
	return []Tool{
		{
			Name:        "vault_recall",
			Description: "What is known about a project: its memory notes ranked by relevance to a question. Call this before starting work on a project.",
			Scope:       "vault:read",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"query":   prop("string", "What you want to know (empty = the most recent notes)"),
				"limit":   prop("integer", "Default 8"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				items, err := work.New(a).RecallVault(ctx, str(args, "project"), str(args, "query"), intArg(args, "limit", 8))
				if err != nil {
					return "", toolErr(err)
				}
				if len(items) == 0 {
					return "Nothing in this project's memory matches.", nil
				}
				var b strings.Builder
				for _, v := range items {
					fmt.Fprintf(&b, "## %s\n", v.Title)
					if len(v.Tags) > 0 {
						fmt.Fprintf(&b, "tags: %s\n", strings.Join(v.Tags, ", "))
					}
					fmt.Fprintf(&b, "id: %s · updated %s\n\n%s\n\n", v.ID, v.UpdatedAt.Format("2006-01-02"), v.Body)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "vault_list",
			Description: "List a project's vault: memory notes and secrets (secrets by title and hint only, never the value).",
			Scope:       "vault:read",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"kind":    map[string]any{"type": "string", "enum": []string{"", "secret", "memory"}},
				"q":       prop("string", "Search title, body and tags"),
				"tag":     prop("string", "Only items with this tag"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				items, err := work.New(a).ListVault(ctx, str(args, "project"), work.VaultFilter{Kind: str(args, "kind"), Q: str(args, "q"), Tag: str(args, "tag")})
				if err != nil {
					return "", toolErr(err)
				}
				if len(items) == 0 {
					return "The vault is empty (or nothing matched).", nil
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%d item(s):\n\n", len(items))
				for _, v := range items {
					fmt.Fprintf(&b, "[%s] %s  (id %s)", v.Kind, v.Title, v.ID)
					if len(v.Tags) > 0 {
						fmt.Fprintf(&b, "  tags: %s", strings.Join(v.Tags, ", "))
					}
					if hint := oneLineStr(v.Body, 120); hint != "" {
						fmt.Fprintf(&b, "\n    %s", hint)
					}
					b.WriteString("\n")
				}
				return b.String(), nil
			},
		},
		{
			Name:        "vault_remember",
			Description: "Save a memory note on a project (a decision, an access path, a convention, what you learned). Markdown. Never put secrets in a note; use vault_store_secret.",
			Scope:       "vault:write",
			InputSchema: schema([]string{"project", "title", "body"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"title":   prop("string", "Short, searchable title"),
				"body":    prop("string", "The note (markdown)"),
				"tags":    arrProp("Tags"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				kind, title, body, tags := "memory", str(args, "title"), str(args, "body"), strList(args, "tags")
				v, err := work.New(a).CreateVaultItem(ctx, str(args, "project"), work.VaultInput{Kind: &kind, Title: &title, Body: &body, Tags: &tags})
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Remembered %q (id %s).", v.Title, v.ID), nil
			},
		},
		{
			Name:        "vault_update",
			Description: "Change a vault item's title, body or tags (and, for a secret, its value; that also needs vault:secrets).",
			Scope:       "vault:write",
			InputSchema: schema([]string{"id"}, map[string]any{
				"id":    prop("string", "Vault item id"),
				"title": prop("string", "New title"),
				"body":  prop("string", "New body or hint"),
				"tags":  arrProp("Replaces the tags"),
				"value": prop("string", "Secret only: the new value"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				in := work.VaultInput{}
				for k, dst := range map[string]**string{"title": &in.Title, "body": &in.Body, "value": &in.Value} {
					if v, ok := args[k].(string); ok {
						v := v
						*dst = &v
					}
				}
				if in.Value != nil {
					if s, _ := tenant.From(ctx); s == nil || !hasScope(s.Scopes, "vault:secrets") {
						return "", errors.New("changing a secret's value needs the vault:secrets scope")
					}
				}
				if _, ok := args["tags"]; ok {
					t := strList(args, "tags")
					in.Tags = &t
				}
				v, err := work.New(a).UpdateVaultItem(ctx, str(args, "id"), in)
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Updated %q.", v.Title), nil
			},
		},
		{
			Name:        "vault_forget",
			Description: "Delete a vault item (a secret needs manager+ or the project lead).",
			Scope:       "vault:write",
			InputSchema: schema([]string{"id"}, map[string]any{"id": prop("string", "Vault item id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				if err := work.New(a).DeleteVaultItem(ctx, str(decodeArgs(raw), "id")); err != nil {
					return "", toolErr(err)
				}
				return "Deleted.", nil
			},
		},
		{
			Name:        "vault_store_secret",
			Description: "Store a credential in a project's vault, sealed at rest. hint is non-secret context (username, URL, env var name).",
			Scope:       "vault:secrets",
			InputSchema: schema([]string{"project", "title", "value"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"title":   prop("string", "For example: Production database"),
				"value":   prop("string", "The secret"),
				"hint":    prop("string", "Non-secret context shown in lists"),
				"tags":    arrProp("Tags"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				kind, title, value, hint, tags := "secret", str(args, "title"), str(args, "value"), str(args, "hint"), strList(args, "tags")
				v, err := work.New(a).CreateVaultItem(ctx, str(args, "project"), work.VaultInput{Kind: &kind, Title: &title, Value: &value, Body: &hint, Tags: &tags})
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Stored secret %q (id %s).", v.Title, v.ID), nil
			},
		},
		{
			Name:        "vault_reveal_secret",
			Description: "Decrypt one secret. Recorded in the project's activity feed as revealed by the token's user via MCP. Use only when the task needs the value.",
			Scope:       "vault:secrets",
			InputSchema: schema([]string{"id"}, map[string]any{"id": prop("string", "Vault item id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				v, err := work.New(a).RevealVaultSecret(ctx, str(decodeArgs(raw), "id"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("%s:\n%s", v.Title, *v.Value), nil
			},
		},
	}
}

func oneLineStr(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
