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
CatalogueTools manage a project's catalogue of agents and skills (internal/work/catalogue.go):
the issue Agent/Skill pickers and the @-mention list. Reading needs projects:read and a project
the caller can see; writing needs projects:write and manage rights on the project.
*/
func CatalogueTools() []Tool {
	entries := func(desc string) map[string]any {
		return map[string]any{"type": "array", "description": desc, "items": map[string]any{
			"type": "object", "required": []string{"name"},
			"properties": map[string]any{
				"name":        prop("string", "Agent/skill name: letters, digits, . _ : - (1–100 chars)"),
				"description": prop("string", "One-line description"),
			}}}
	}
	return []Tool{
		{
			Name:        "list_project_agents",
			Description: "List a project's agents and skills (its catalogue for the issue Agent/Skill pickers and @-mentions).",
			Scope:       "projects:read",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				c, err := work.New(a).ListCatalogue(ctx, str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				return formatCatalogue(c), nil
			},
		},
		{
			Name:        "add_project_agent",
			Description: "Add an agent or skill to a project's catalogue. An existing one with the same name gets the new description.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"project", "kind", "name"}, map[string]any{
				"project":     prop("string", "Project id or exact name"),
				"kind":        map[string]any{"type": "string", "enum": []string{"agent", "skill"}},
				"name":        prop("string", "Name: letters, digits, . _ : - (1–100 chars)"),
				"description": prop("string", "One-line description"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				it, err := work.New(a).AddCatalogueItem(ctx, str(args, "project"), str(args, "kind"), str(args, "name"), str(args, "description"), "mcp")
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Saved %s %s (id %s).", it.Kind, it.Name, it.ID), nil
			},
		},
		{
			Name:        "remove_project_agent",
			Description: "Remove an agent or skill (by kind and name) from a project's catalogue.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"project", "kind", "name"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"kind":    map[string]any{"type": "string", "enum": []string{"agent", "skill"}},
				"name":    prop("string", "Name (case-insensitive)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				if err := work.New(a).RemoveCatalogueItemByName(ctx, str(args, "project"), str(args, "kind"), str(args, "name")); err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Removed %s %s.", str(args, "kind"), str(args, "name")), nil
			},
		},
		{
			Name: "sync_project_agents",
			Description: "Sync the local repo's Claude agents and skills into a project's catalogue. Before calling, scan the repo: " +
				"every .claude/agents/*.md is an agent and every .claude/skills/*/SKILL.md is a skill. Take the name from the " +
				"YAML frontmatter `name:` (else the file name without .md for agents, the directory name for skills) and the " +
				"description from the frontmatter `description:` (first line is enough). Send them all in one call. " +
				"replace=true also removes previously synced items that are no longer in the repo (items added by hand are kept).",
			Scope: "projects:write",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"agents":  entries("From .claude/agents/*.md"),
				"skills":  entries("From .claude/skills/*/SKILL.md"),
				"replace": prop("boolean", "Remove synced items missing from this payload (default false)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				var in struct {
					Project string                `json:"project"`
					Agents  []work.CatalogueEntry `json:"agents"`
					Skills  []work.CatalogueEntry `json:"skills"`
					Replace bool                  `json:"replace"`
				}
				if err := json.Unmarshal(raw, &in); err != nil {
					return "", fmt.Errorf("arguments: %w", err)
				}
				c, err := work.New(a).SyncCatalogue(ctx, in.Project, in.Agents, in.Skills, in.Replace)
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Synced %d agents and %d skills.\n", len(in.Agents), len(in.Skills)) + formatCatalogue(c), nil
			},
		},
	}
}

func formatCatalogue(c *work.Catalogue) string {
	var b strings.Builder
	for _, g := range []struct {
		title string
		list  []work.CatalogueItem
	}{{"Agents", c.Agents}, {"Skills", c.Skills}} {
		fmt.Fprintf(&b, "%s (%d):\n", g.title, len(g.list))
		if len(g.list) == 0 {
			b.WriteString("  (none)\n")
		}
		for _, it := range g.list {
			fmt.Fprintf(&b, "  - %s [%s]", it.Name, it.Source)
			if it.Description != "" {
				b.WriteString(" — " + firstLine(it.Description))
			}
			b.WriteString("\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}
