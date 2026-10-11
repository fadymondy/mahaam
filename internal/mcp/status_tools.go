package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
StatusTools manage a project's board columns (statuses): the same work.CreateStatus /
UpdateStatus / DeleteStatus the board's Settings → Board columns calls, so only managers and
the project's lead can change them. A column is named by its id or its exact name (any case)
within the project.
*/
func StatusTools() []Tool {
	projectRef := prop("string", "Project id or exact name")
	statusRef := prop("string", "Column (status) id or exact name in the project")
	return []Tool{
		{
			Name:        "list_project_statuses",
			Description: "A project's board columns (statuses) in order, with category, workflow stage and task count.",
			Scope:       "projects:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": projectRef}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				d, err := projectDetail(ctx, a, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", err
				}
				return formatStatuses(d), nil
			},
		},
		{
			Name: "create_project_status",
			Description: "Add a board column (status) to a project, at the end or at index (0 = first). " +
				"category is todo, doing (default) or done; stage (backlog, todo, in_progress, waiting_approval, in_review, done) sets the category too.",
			Scope: "projects:write",
			InputSchema: schema([]string{"project", "name"}, map[string]any{
				"project":  projectRef,
				"name":     prop("string", "Column name"),
				"category": prop("string", "todo, doing or done"),
				"stage":    prop("string", "backlog, todo, in_progress, waiting_approval, in_review or done"),
				"color":    prop("string", "violet, blue, teal, green, amber, orange, red, pink, slate"),
				"index":    prop("integer", "Position, 0 = first (default: last)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				p, err := sv.FindProject(ctx, str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				in := statusInput(args)
				st, err := sv.CreateStatus(ctx, p.ID, in)
				if err != nil {
					return "", toolErr(err)
				}
				if in.Index != nil { // created at the end; move it into place
					if st, err = sv.UpdateStatus(ctx, st.ID, work.StatusInput{Index: in.Index}); err != nil {
						return "", toolErr(err)
					}
				}
				d, err := sv.GetProject(ctx, p.ID)
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Created column %s (id %s).\n\n", st.Name, st.ID) + formatStatuses(d), nil
			},
		},
		{
			Name:        "update_project_status",
			Description: "Rename, recolour, re-categorise or move a board column (status). index moves it (0 = first).",
			Scope:       "projects:write",
			InputSchema: schema([]string{"project", "status"}, map[string]any{
				"project":  projectRef,
				"status":   statusRef,
				"name":     prop("string", "New name"),
				"category": prop("string", "todo, doing or done"),
				"stage":    prop("string", "backlog, todo, in_progress, waiting_approval, in_review or done"),
				"color":    prop("string", "violet, blue, teal, green, amber, orange, red, pink, slate"),
				"index":    prop("integer", "New position, 0 = first"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				d, err := projectDetail(ctx, a, str(args, "project"))
				if err != nil {
					return "", err
				}
				st, err := findStatus(d, str(args, "status"))
				if err != nil {
					return "", err
				}
				sv := work.New(a)
				if _, err := sv.UpdateStatus(ctx, st.ID, statusInput(args)); err != nil {
					return "", toolErr(err)
				}
				if d, err = sv.GetProject(ctx, d.ID); err != nil {
					return "", toolErr(err)
				}
				return "Updated.\n\n" + formatStatuses(d), nil
			},
		},
		{
			Name:        "reorder_project_statuses",
			Description: "Put a project's board columns in this order (ids or names). Columns left out keep their relative order after the listed ones.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"project", "order"}, map[string]any{
				"project": projectRef,
				"order":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Column ids or names, first to last"},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				d, err := projectDetail(ctx, a, str(args, "project"))
				if err != nil {
					return "", err
				}
				order, err := statusOrder(d, strList(args, "order"))
				if err != nil {
					return "", err
				}
				sv := work.New(a)
				for i, id := range order {
					idx := i
					if _, err := sv.UpdateStatus(ctx, id, work.StatusInput{Index: &idx}); err != nil {
						return "", toolErr(err)
					}
				}
				if d, err = sv.GetProject(ctx, d.ID); err != nil {
					return "", toolErr(err)
				}
				return "Reordered.\n\n" + formatStatuses(d), nil
			},
		},
		{
			Name:        "delete_project_status",
			Description: "Remove a board column (status). If it has tasks, move_to names the column they move to. A project keeps at least one column.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"project", "status"}, map[string]any{
				"project": projectRef,
				"status":  statusRef,
				"move_to": prop("string", "Column id or name for its tasks (needed when it has any)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				d, err := projectDetail(ctx, a, str(args, "project"))
				if err != nil {
					return "", err
				}
				st, err := findStatus(d, str(args, "status"))
				if err != nil {
					return "", err
				}
				moveTo := ""
				if ref := str(args, "move_to"); ref != "" {
					to, err := findStatus(d, ref)
					if err != nil {
						return "", err
					}
					moveTo = to.ID
				}
				sv := work.New(a)
				if err := sv.DeleteStatus(ctx, st.ID, moveTo); err != nil {
					return "", toolErr(err)
				}
				if d, err = sv.GetProject(ctx, d.ID); err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Removed column %s.\n\n", st.Name) + formatStatuses(d), nil
			},
		},
	}
}

func projectDetail(ctx context.Context, a *app.App, ref string) (*work.ProjectDetail, error) {
	sv := work.New(a)
	p, err := sv.FindProject(ctx, ref)
	if err != nil {
		return nil, toolErr(err)
	}
	d, err := sv.GetProject(ctx, p.ID)
	if err != nil {
		return nil, toolErr(err)
	}
	return d, nil
}

func statusInput(args map[string]any) work.StatusInput {
	in := work.StatusInput{Name: optStr(args, "name"), Color: optStr(args, "color"), Category: optStr(args, "category"), Stage: optStr(args, "stage")}
	if v, ok := args["index"].(float64); ok && v >= 0 {
		n := int(v)
		in.Index = &n
	}
	return in
}

// findStatus resolves a column by id, else by name (case-insensitive) within the project.
func findStatus(d *work.ProjectDetail, ref string) (*work.Status, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, errors.New("status is required")
	}
	for i := range d.Statuses {
		if d.Statuses[i].ID == ref {
			return &d.Statuses[i], nil
		}
	}
	var found *work.Status
	for i := range d.Statuses {
		if strings.EqualFold(d.Statuses[i].Name, ref) {
			if found != nil {
				return nil, fmt.Errorf("%s has two columns named %q — use the id", d.Name, ref)
			}
			found = &d.Statuses[i]
		}
	}
	if found == nil {
		return nil, fmt.Errorf("no column %q in %s", ref, d.Name)
	}
	return found, nil
}

// statusOrder is the full column order (ids): the listed ones first, then the rest as they were.
func statusOrder(d *work.ProjectDetail, refs []string) ([]string, error) {
	if len(refs) == 0 {
		return nil, errors.New("order needs at least one column")
	}
	seen := map[string]bool{}
	out := []string{}
	for _, ref := range refs {
		st, err := findStatus(d, ref)
		if err != nil {
			return nil, err
		}
		if seen[st.ID] {
			return nil, fmt.Errorf("column %s is listed twice", st.Name)
		}
		seen[st.ID] = true
		out = append(out, st.ID)
	}
	for _, st := range d.Statuses {
		if !seen[st.ID] {
			out = append(out, st.ID)
		}
	}
	return out, nil
}

func formatStatuses(d *work.ProjectDetail) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s — board columns, in order:\n", d.Name)
	for i, s := range d.Statuses {
		fmt.Fprintf(&b, "  %d. %s  (%s / %s, %s, %d task(s))  id=%s\n", i, s.Name, s.Category, s.Stage, s.Color, s.TaskCount, s.ID)
	}
	return b.String()
}
