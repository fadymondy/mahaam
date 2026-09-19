package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
	"github.com/fadymondy/mahaam/internal/workspaces"
)

/*
WorkTools are the P1 project/task/client tools of the user MCP. Each one calls the same
internal/work function as the REST API, with the token's tenant.Scope on ctx — so an agent
gets exactly its human's project visibility and role checks, and its writes land in the
activity feed as that human "via MCP" (with the token id recorded).

Tasks accept MG-123, a bare 123, or the task id. Projects and clients accept an id or their
exact name. People accept an email, a user id, or "me".
*/
func WorkTools() []Tool {
	return []Tool{
		// ---- projects ----------------------------------------------------------------
		{
			Name:        "list_projects",
			Description: "Projects you can see, with status, client and task counts (todo/doing/done).",
			Scope:       "projects:read",
			InputSchema: schema(nil, map[string]any{
				"archived": prop("boolean", "List archived projects instead of active ones"),
				"status":   prop("string", "planned, active, on_hold, completed or cancelled"),
				"q":        prop("string", "Name contains"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				list, err := work.New(a).ListProjects(ctx, work.ProjectFilter{Archived: boolArg(args, "archived"), Status: str(args, "status"), Q: str(args, "q")})
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No projects matched.", nil
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%d project(s):\n\n", len(list))
				for _, p := range list {
					fmt.Fprintf(&b, "%s  [%s]  todo %d / doing %d / done %d", p.Name, p.Status, p.Tasks.Todo, p.Tasks.Doing, p.Tasks.Done)
					if p.ClientName != nil {
						fmt.Fprintf(&b, "  client: %s", *p.ClientName)
					}
					fmt.Fprintf(&b, "\n    id: %s\n", p.ID)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "get_project",
			Description: "One project in full: settings, budget, statuses (board columns), members and attached teams.",
			Scope:       "projects:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": prop("string", "Project id or exact name")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				sv := work.New(a)
				p, err := sv.FindProject(ctx, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", toolErr(err)
				}
				d, err := sv.GetProject(ctx, p.ID)
				if err != nil {
					return "", toolErr(err)
				}
				return formatProject(d, people(ctx, a)), nil
			},
		},
		{
			Name:        "create_project",
			Description: "Create a project. It gets the default columns (To do, In progress, In review, Done) and you become its lead.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"name"}, projectProps(false)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				in, err := projectInput(decodeArgs(raw))
				if err != nil {
					return "", err
				}
				d, err := work.New(a).CreateProject(ctx, in)
				if err != nil {
					return "", toolErr(err)
				}
				return "Created.\n\n" + formatProject(d, people(ctx, a)), nil
			},
		},
		{
			Name:        "update_project",
			Description: "Change a project's name, description, status, billing, budget, client, dates, colour or visibility.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"project"}, projectProps(true)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				p, err := sv.FindProject(ctx, str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				in, err := projectInput(args)
				if err != nil {
					return "", err
				}
				d, err := sv.UpdateProject(ctx, p.ID, in)
				if err != nil {
					return "", toolErr(err)
				}
				return "Updated.\n\n" + formatProject(d, people(ctx, a)), nil
			},
		},
		{
			Name:        "archive_project",
			Description: "Archive a project (it becomes read-only), or restore it with restore=true.",
			Scope:       "projects:write",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": prop("string", "Project id or exact name"),
				"restore": prop("boolean", "Restore an archived project instead"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				p, err := sv.FindProject(ctx, str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				restore := boolArg(args, "restore")
				if _, err := sv.SetProjectArchived(ctx, p.ID, !restore); err != nil {
					return "", toolErr(err)
				}
				if restore {
					return fmt.Sprintf("Restored %s.", p.Name), nil
				}
				return fmt.Sprintf("Archived %s.", p.Name), nil
			},
		},

		// ---- tasks ----------------------------------------------------------------------
		{
			Name:        "list_tasks",
			Description: "Tasks in board order. Filter by project, status (name, in that project), category (todo/doing/done), assignee (email or \"me\") or a title search.",
			Scope:       "tasks:read",
			InputSchema: schema(nil, map[string]any{
				"project":  prop("string", "Project id or exact name (default: every active project you can see)"),
				"status":   prop("string", "Status name or id (needs project)"),
				"category": prop("string", "todo, doing or done"),
				"assignee": prop("string", "Email, user id or \"me\""),
				"q":        prop("string", "Title or key contains"),
				"limit":    prop("integer", "Default 100"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				f := work.TaskFilter{Category: str(args, "category"), Q: str(args, "q"), Limit: intArg(args, "limit", 100)}
				var statuses map[string]string
				if ref := str(args, "project"); ref != "" {
					p, err := sv.FindProject(ctx, ref)
					if err != nil {
						return "", toolErr(err)
					}
					f.ProjectID = p.ID
					if st := str(args, "status"); st != "" {
						d, err := sv.GetProject(ctx, p.ID)
						if err != nil {
							return "", toolErr(err)
						}
						for _, s := range d.Statuses {
							if s.ID == st || strings.EqualFold(s.Name, st) {
								f.StatusID = s.ID
							}
						}
						if f.StatusID == "" {
							return "", fmt.Errorf("no status %q in %s", st, p.Name)
						}
					}
				} else if str(args, "status") != "" {
					return "", errors.New("status needs a project")
				}
				ppl := people(ctx, a)
				if who := str(args, "assignee"); who != "" {
					id, err := ppl.resolve(ctx, who)
					if err != nil {
						return "", err
					}
					f.AssigneeID = id
				}
				list, err := sv.ListTasks(ctx, f)
				if err != nil {
					return "", toolErr(err)
				}
				statuses = statusNames(ctx, sv, list)
				return formatTaskList(list, statuses, ppl), nil
			},
		},
		{
			Name:        "get_task",
			Description: "One task in full: description, status, assignees, labels, checklist, subtasks, comments and recent activity.",
			Scope:       "tasks:read",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "MG-12, 12 or the task id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				sv := work.New(a)
				key := str(decodeArgs(raw), "key")
				d, err := sv.GetTask(ctx, key)
				if err != nil {
					return "", toolErr(err)
				}
				comments, _ := sv.ListComments(ctx, d.ID)
				activity, _ := sv.TaskActivity(ctx, d.ID, 15)
				labels, _ := sv.ListLabels(ctx)
				return formatTask(d, comments, activity, labels, people(ctx, a)), nil
			},
		},
		{
			Name:        "create_task",
			Description: "Create a task in a project. Without a status it lands in the first To-do column. Returns its key (MG-n).",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"project", "title"}, taskProps(true)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				p, err := sv.FindProject(ctx, str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				in := taskInput(args)
				ppl := people(ctx, a)
				if list := strList(args, "assignees"); len(list) > 0 {
					ids, err := ppl.resolveAll(ctx, list)
					if err != nil {
						return "", err
					}
					in.AssigneeIDs = &ids
				}
				if names := strList(args, "labels"); len(names) > 0 {
					ids, err := labelIDs(ctx, sv, names)
					if err != nil {
						return "", err
					}
					in.LabelIDs = &ids
				}
				d, err := sv.CreateTask(ctx, p.ID, in)
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Created %s in %s → %s.\n\n", d.Key, d.Project.Name, d.Status.Name) +
					formatTask(d, nil, nil, nil, ppl), nil
			},
		},
		{
			Name:        "update_task",
			Description: "Change a task's title, description, priority, due date, estimate, parent or status. Empty strings clear.",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"key"}, taskProps(false)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				d, err := work.New(a).UpdateTask(ctx, str(args, "key"), taskInput(args))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Updated %s (%s, %s).", d.Key, d.Title, d.Status.Name), nil
			},
		},
		{
			Name:        "move_task",
			Description: "Move a task to a status (board column), optionally at a 0-based position in it (default: the end).",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"key", "status"}, map[string]any{
				"key":    prop("string", "MG-12, 12 or the task id"),
				"status": prop("string", "Status name (e.g. \"In progress\", \"Done\") or id"),
				"index":  prop("integer", "0-based position in the column"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				var index *int
				if v, ok := args["index"].(float64); ok && v >= 0 {
					i := int(v)
					index = &i
				}
				d, err := work.New(a).MoveTask(ctx, str(args, "key"), str(args, "status"), index)
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Moved %s to %s.", d.Key, d.Status.Name), nil
			},
		},
		{
			Name:        "assign_task",
			Description: "Change who a task is assigned to: add and/or remove people, or set the whole list. People are emails, user ids or \"me\".",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key":    prop("string", "MG-12, 12 or the task id"),
				"add":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"remove": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"set":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Replace the assignees (empty array clears)"},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				d, err := sv.GetTask(ctx, str(args, "key"))
				if err != nil {
					return "", toolErr(err)
				}
				ppl := people(ctx, a)
				next := d.AssigneeIDs
				if _, ok := args["set"]; ok {
					if next, err = ppl.resolveAll(ctx, strList(args, "set")); err != nil {
						return "", err
					}
				}
				add, err := ppl.resolveAll(ctx, strList(args, "add"))
				if err != nil {
					return "", err
				}
				remove, err := ppl.resolveAll(ctx, strList(args, "remove"))
				if err != nil {
					return "", err
				}
				drop := map[string]bool{}
				for _, id := range remove {
					drop[id] = true
				}
				final := []string{}
				for _, id := range append(append([]string{}, next...), add...) {
					if !drop[id] {
						final = append(final, id)
					}
				}
				d, err = sv.SetAssignees(ctx, d.ID, final)
				if err != nil {
					return "", toolErr(err)
				}
				names := []string{}
				for _, id := range d.AssigneeIDs {
					names = append(names, ppl.name(id))
				}
				if len(names) == 0 {
					return fmt.Sprintf("%s is now unassigned.", d.Key), nil
				}
				return fmt.Sprintf("%s is assigned to %s.", d.Key, strings.Join(names, ", ")), nil
			},
		},
		{
			Name:        "comment_task",
			Description: "Comment on a task as the token's user (shown as posted via MCP). @alice or @alice@example.com mentions a member.",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"key", "body"}, map[string]any{
				"key":  prop("string", "MG-12, 12 or the task id"),
				"body": prop("string", "Markdown"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				d, err := sv.GetTask(ctx, str(args, "key"))
				if err != nil {
					return "", toolErr(err)
				}
				c, err := sv.AddComment(ctx, d.ID, str(args, "body"))
				if err != nil {
					return "", toolErr(err)
				}
				msg := fmt.Sprintf("Commented on %s.", d.Key)
				if len(c.Mentions) > 0 {
					ppl := people(ctx, a)
					names := []string{}
					for _, id := range c.Mentions {
						names = append(names, ppl.name(id))
					}
					msg += " Mentioned: " + strings.Join(names, ", ") + "."
				}
				return msg, nil
			},
		},
		{
			Name:        "toggle_checklist_item",
			Description: "Tick or untick a checklist item of a task. item is its 1-based number, its exact text, or its id; done forces a state (default: flip).",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"key", "item"}, map[string]any{
				"key":  prop("string", "MG-12, 12 or the task id"),
				"item": prop("string", "1-based number, exact text, or id"),
				"done": prop("boolean", "Set this state instead of flipping"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				d, err := sv.GetTask(ctx, str(args, "key"))
				if err != nil {
					return "", toolErr(err)
				}
				ref := str(args, "item")
				if n, ok := args["item"].(float64); ok {
					ref = fmt.Sprint(int(n))
				}
				var item *work.ChecklistItem
				for i := range d.Checklist {
					c := &d.Checklist[i]
					if c.ID == ref || strings.EqualFold(c.Title, ref) || fmt.Sprint(i+1) == ref {
						item = c
						break
					}
				}
				if item == nil {
					return "", fmt.Errorf("%s has no checklist item %q (it has %d)", d.Key, ref, len(d.Checklist))
				}
				want := !item.Done
				if v, ok := args["done"].(bool); ok {
					want = v
				}
				c, err := sv.UpdateChecklistItem(ctx, item.ID, nil, &want)
				if err != nil {
					return "", toolErr(err)
				}
				state := "unticked"
				if c.Done {
					state = "ticked"
				}
				return fmt.Sprintf("%s: %s \"%s\".", d.Key, state, c.Title), nil
			},
		},

		// ---- clients -------------------------------------------------------------------------
		{
			Name:        "list_clients",
			Description: "The workspace's clients with their active project counts.",
			Scope:       "clients:read",
			InputSchema: schema(nil, map[string]any{"archived": prop("boolean", "Include archived clients")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				list, err := work.New(a).ListClients(ctx, boolArg(decodeArgs(raw), "archived"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No clients yet.", nil
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%d client(s):\n\n", len(list))
				for _, c := range list {
					b.WriteString(clientLine(&c))
				}
				return b.String(), nil
			},
		},
		{
			Name:        "get_client",
			Description: "One client with contact details, currency and default rate.",
			Scope:       "clients:read",
			InputSchema: schema([]string{"client"}, map[string]any{"client": prop("string", "Client id or exact name")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				c, err := work.New(a).GetClient(ctx, str(decodeArgs(raw), "client"))
				if err != nil {
					return "", toolErr(err)
				}
				return clientLine(c), nil
			},
		},
		{
			Name:        "create_client",
			Description: "Add a client. Currency defaults to the workspace's.",
			Scope:       "clients:write",
			InputSchema: schema([]string{"name"}, clientProps(false)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				c, err := work.New(a).CreateClient(ctx, clientInput(decodeArgs(raw)))
				if err != nil {
					return "", toolErr(err)
				}
				return "Created.\n" + clientLine(c), nil
			},
		},
		{
			Name:        "update_client",
			Description: "Change a client's details. Empty strings clear; a negative default_rate_minor clears the rate.",
			Scope:       "clients:write",
			InputSchema: schema([]string{"client"}, clientProps(true)),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				c, err := work.New(a).UpdateClient(ctx, str(args, "client"), clientInput(args))
				if err != nil {
					return "", toolErr(err)
				}
				return "Updated.\n" + clientLine(c), nil
			},
		},
	}
}

// toolErr turns a domain error into its caller-safe message, and hides internal ones.
func toolErr(err error) error {
	if e, ok := work.AsError(err); ok {
		return errors.New(e.Msg)
	}
	return errors.New("something went wrong on the server")
}

// ---- argument helpers ---------------------------------------------------------------

func boolArg(m map[string]any, k string) bool {
	v, _ := m[k].(bool)
	return v
}

// optStr is a pointer to the trimmed value when the key is present (so "" can clear).
func optStr(m map[string]any, k string) *string {
	v, ok := m[k]
	if !ok || v == nil {
		return nil
	}
	s := strings.TrimSpace(fmt.Sprint(v))
	return &s
}

func optInt(m map[string]any, k string) *int64 {
	v, ok := m[k].(float64)
	if !ok {
		return nil
	}
	n := int64(v)
	return &n
}

// strList accepts a JSON array of strings or one comma-separated string.
func strList(m map[string]any, k string) []string {
	out := []string{}
	switch v := m[k].(type) {
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
	case string:
		for _, s := range strings.Split(v, ",") {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

func projectProps(withRef bool) map[string]any {
	p := map[string]any{
		"name":         prop("string", "Project name"),
		"description":  prop("string", "Markdown"),
		"client":       prop("string", "Client id or exact name (empty clears)"),
		"color":        prop("string", strings.Join(work.Palette, ", ")),
		"status":       prop("string", "planned, active, on_hold, completed or cancelled"),
		"billing_mode": prop("string", "non_billable, hourly or fixed"),
		"budget_hours": prop("number", "Time budget in hours (0 clears)"),
		"budget_minor": prop("integer", "Money budget in minor units, e.g. cents (0 clears)"),
		"currency":     prop("string", "ISO 4217, e.g. USD"),
		"visibility":   prop("string", "workspace (every member) or members (only people on the project)"),
		"starts_on":    prop("string", "YYYY-MM-DD"),
		"ends_on":      prop("string", "YYYY-MM-DD"),
	}
	if withRef {
		p["project"] = prop("string", "Project id or exact name")
	}
	return p
}

func projectInput(args map[string]any) (work.ProjectInput, error) {
	in := work.ProjectInput{
		Name: optStr(args, "name"), Description: optStr(args, "description"), ClientID: optStr(args, "client"),
		Color: optStr(args, "color"), Status: optStr(args, "status"), BillingMode: optStr(args, "billing_mode"),
		BudgetMinor: optInt(args, "budget_minor"), Currency: optStr(args, "currency"), Visibility: optStr(args, "visibility"),
		StartsOn: optStr(args, "starts_on"), EndsOn: optStr(args, "ends_on"),
	}
	if in.Name != nil && args["project"] != nil && *in.Name == "" {
		in.Name = nil
	}
	if v, ok := args["budget_hours"].(float64); ok {
		if v < 0 {
			return in, errors.New("budget_hours cannot be negative")
		}
		m := int64(v*60 + 0.5)
		in.BudgetMinutes = &m
	}
	return in, nil
}

func taskProps(create bool) map[string]any {
	p := map[string]any{
		"title":            prop("string", "Task title"),
		"description":      prop("string", "Markdown"),
		"status":           prop("string", "Status name or id in the task's project"),
		"priority":         prop("string", "none, low, medium, high or urgent"),
		"due":              prop("string", "YYYY-MM-DD or RFC 3339 (empty clears)"),
		"estimate_minutes": prop("integer", "Estimate in minutes (0 clears)"),
		"parent":           prop("string", "Parent task key for a subtask (same project; empty clears)"),
	}
	if create {
		p["project"] = prop("string", "Project id or exact name")
		p["assignees"] = map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Emails, user ids or \"me\""}
		p["labels"] = map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Existing label names"}
	} else {
		p["key"] = prop("string", "MG-12, 12 or the task id")
	}
	return p
}

func taskInput(args map[string]any) work.TaskInput {
	in := work.TaskInput{
		Title: optStr(args, "title"), Description: optStr(args, "description"), Status: optStr(args, "status"),
		Priority: optStr(args, "priority"), DueAt: optStr(args, "due"), EstimateMinutes: optInt(args, "estimate_minutes"),
		Parent: optStr(args, "parent"),
	}
	if in.DueAt == nil {
		in.DueAt = optStr(args, "due_at")
	}
	return in
}

func clientProps(withRef bool) map[string]any {
	p := map[string]any{
		"name":               prop("string", "Client name"),
		"email":              prop("string", "Contact email"),
		"phone":              prop("string", "Contact phone"),
		"country":            prop("string", "ISO 3166-1 alpha-2, e.g. EG"),
		"currency":           prop("string", "ISO 4217, e.g. USD"),
		"default_rate_minor": prop("integer", "Hourly rate in minor units (negative clears)"),
		"notes":              prop("string", "Notes"),
	}
	if withRef {
		p["client"] = prop("string", "Client id or exact name")
	}
	return p
}

func clientInput(args map[string]any) work.ClientInput {
	return work.ClientInput{
		Name: optStr(args, "name"), Email: optStr(args, "email"), Phone: optStr(args, "phone"), Country: optStr(args, "country"),
		Currency: optStr(args, "currency"), DefaultRateMinor: optInt(args, "default_rate_minor"), Notes: optStr(args, "notes"),
	}
}

func labelIDs(ctx context.Context, sv *work.Service, names []string) ([]string, error) {
	all, err := sv.ListLabels(ctx)
	if err != nil {
		return nil, toolErr(err)
	}
	out := []string{}
	for _, n := range names {
		found := ""
		for _, l := range all {
			if l.ID == n || strings.EqualFold(l.Name, n) {
				found = l.ID
			}
		}
		if found == "" {
			have := []string{}
			for _, l := range all {
				have = append(have, l.Name)
			}
			return nil, fmt.Errorf("no label %q (labels: %s)", n, strings.Join(nonEmpty(have), ", "))
		}
		out = append(out, found)
	}
	return out, nil
}

// ---- people: user id <-> email for the token's workspace --------------------------------

type directory struct {
	self    string
	byID    map[string]string
	byEmail map[string]string
}

// people loads the workspace's member emails (owner pool, explicit workspace predicate —
// the app role has no grant on users).
func people(ctx context.Context, a *app.App) *directory {
	d := &directory{byID: map[string]string{}, byEmail: map[string]string{}}
	s, ok := tenant.From(ctx)
	if !ok {
		return d
	}
	d.self = s.UserID
	if list, err := workspaces.Members(ctx, a.SysDB, s.WorkspaceID); err == nil {
		for _, m := range list {
			d.byID[m.UserID] = m.Email
			d.byEmail[strings.ToLower(m.Email)] = m.UserID
		}
	}
	return d
}

func (d *directory) name(id string) string {
	if e, ok := d.byID[id]; ok {
		return e
	}
	return id
}

func (d *directory) resolve(_ context.Context, who string) (string, error) {
	who = strings.TrimSpace(who)
	if strings.EqualFold(who, "me") {
		return d.self, nil
	}
	if id, ok := d.byEmail[strings.ToLower(who)]; ok {
		return id, nil
	}
	if _, ok := d.byID[who]; ok {
		return who, nil
	}
	return "", fmt.Errorf("%q is not a member of this workspace", who)
}

func (d *directory) resolveAll(ctx context.Context, list []string) ([]string, error) {
	out := []string{}
	for _, w := range list {
		id, err := d.resolve(ctx, w)
		if err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

// ---- formatting ------------------------------------------------------------------------------

func statusNames(ctx context.Context, sv *work.Service, list []work.Task) map[string]string {
	out := map[string]string{}
	seen := map[string]bool{}
	for _, t := range list {
		if seen[t.ProjectID] {
			continue
		}
		seen[t.ProjectID] = true
		if d, err := sv.GetProject(ctx, t.ProjectID); err == nil {
			for _, s := range d.Statuses {
				out[s.ID] = s.Name
			}
		}
	}
	return out
}

func taskLine(t work.Task, statuses map[string]string, ppl *directory) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s  [%s", t.Key, firstNonEmpty(statuses[t.StatusID], "?"))
	if t.Priority != "none" {
		b.WriteString("/" + t.Priority)
	}
	fmt.Fprintf(&b, "]  %s", t.Title)
	extra := []string{}
	for _, id := range t.AssigneeIDs {
		extra = append(extra, "@"+ppl.name(id))
	}
	if t.DueAt != nil {
		extra = append(extra, "due "+t.DueAt.UTC().Format("2006-01-02"))
	}
	if t.ChecklistTotal > 0 {
		extra = append(extra, fmt.Sprintf("checklist %d/%d", t.ChecklistDone, t.ChecklistTotal))
	}
	if t.SubtaskCount > 0 {
		extra = append(extra, fmt.Sprintf("subtasks %d/%d", t.SubtaskDone, t.SubtaskCount))
	}
	if len(extra) > 0 {
		b.WriteString("  (" + strings.Join(extra, ", ") + ")")
	}
	b.WriteString("\n")
	return b.String()
}

func formatTaskList(list []work.Task, statuses map[string]string, ppl *directory) string {
	if len(list) == 0 {
		return "No tasks matched."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%d task(s):\n\n", len(list))
	for _, t := range list {
		b.WriteString(taskLine(t, statuses, ppl))
	}
	return b.String()
}

func formatProject(d *work.ProjectDetail, ppl *directory) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s  [%s]  id=%s\n", d.Name, d.Status, d.ID)
	if d.ArchivedAt != nil {
		b.WriteString("ARCHIVED (read-only)\n")
	}
	if d.ClientName != nil {
		fmt.Fprintf(&b, "client: %s\n", *d.ClientName)
	}
	fmt.Fprintf(&b, "billing: %s", d.BillingMode)
	if d.BudgetMinutes != nil {
		fmt.Fprintf(&b, ", time budget %.1fh", float64(*d.BudgetMinutes)/60)
	}
	if d.BudgetMinor != nil {
		fmt.Fprintf(&b, ", money budget %d minor units %s", *d.BudgetMinor, firstNonEmpty(deref(d.Currency), ""))
	}
	fmt.Fprintf(&b, "\nvisibility: %s\n", d.Visibility)
	if d.StartsOn != nil || d.EndsOn != nil {
		fmt.Fprintf(&b, "dates: %s → %s\n", firstNonEmpty(deref(d.StartsOn), "?"), firstNonEmpty(deref(d.EndsOn), "?"))
	}
	if d.Description != nil {
		fmt.Fprintf(&b, "\n%s\n", *d.Description)
	}
	b.WriteString("\nstatuses (board columns, in order):\n")
	for _, s := range d.Statuses {
		fmt.Fprintf(&b, "  %s  (%s, %d task(s))  id=%s\n", s.Name, s.Category, s.TaskCount, s.ID)
	}
	b.WriteString("members:\n")
	for _, m := range d.Members {
		fmt.Fprintf(&b, "  %s  %s\n", ppl.name(m.UserID), m.Role)
	}
	for _, t := range d.Teams {
		fmt.Fprintf(&b, "  team %s (%d member(s))\n", t.Name, len(t.MemberIDs))
	}
	return b.String()
}

func formatTask(d *work.TaskDetail, comments []work.Comment, activity []work.Activity, labels []work.Label, ppl *directory) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s — %s\n", d.Key, d.Title)
	fmt.Fprintf(&b, "project: %s   status: %s (%s)   priority: %s\n", d.Project.Name, d.Status.Name, d.Status.Category, d.Priority)
	if len(d.AssigneeIDs) > 0 {
		names := []string{}
		for _, id := range d.AssigneeIDs {
			names = append(names, ppl.name(id))
		}
		fmt.Fprintf(&b, "assignees: %s\n", strings.Join(names, ", "))
	}
	if len(d.LabelIDs) > 0 && labels != nil {
		names := []string{}
		for _, id := range d.LabelIDs {
			for _, l := range labels {
				if l.ID == id {
					names = append(names, l.Name)
				}
			}
		}
		fmt.Fprintf(&b, "labels: %s\n", strings.Join(names, ", "))
	}
	if d.DueAt != nil {
		fmt.Fprintf(&b, "due: %s\n", d.DueAt.UTC().Format("2006-01-02"))
	}
	if d.EstimateMinutes != nil {
		fmt.Fprintf(&b, "estimate: %dm\n", *d.EstimateMinutes)
	}
	if d.Parent != nil {
		fmt.Fprintf(&b, "subtask of: %s %s\n", d.Parent.Key, d.Parent.Title)
	}
	if d.Description != nil {
		fmt.Fprintf(&b, "\n%s\n", *d.Description)
	}
	if len(d.Checklist) > 0 {
		b.WriteString("\nchecklist:\n")
		for i, c := range d.Checklist {
			mark := " "
			if c.Done {
				mark = "x"
			}
			fmt.Fprintf(&b, "  %d. [%s] %s\n", i+1, mark, c.Title)
		}
	}
	if len(d.Subtasks) > 0 {
		b.WriteString("\nsubtasks:\n")
		for _, s := range d.Subtasks {
			mark := " "
			if s.Done {
				mark = "x"
			}
			fmt.Fprintf(&b, "  [%s] %s %s\n", mark, s.Key, s.Title)
		}
	}
	if comments != nil {
		fmt.Fprintf(&b, "\n%d comment(s):\n", len(comments))
		for _, c := range comments {
			via := ""
			if c.AuthorKind == "agent" {
				via = " via MCP"
			}
			fmt.Fprintf(&b, "  [%s%s %s] %s\n", ppl.name(c.AuthorID), via, c.CreatedAt.UTC().Format(time.RFC3339), c.Body)
		}
	}
	if activity != nil {
		b.WriteString("\nrecent activity:\n")
		b.WriteString(work.FormatActivity(activity, ppl.name))
	}
	return b.String()
}

func clientLine(c *work.Client) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s  (%s, %d active project(s))", c.Name, c.Currency, c.ProjectCount)
	if c.ArchivedAt != nil {
		b.WriteString("  ARCHIVED")
	}
	for _, kv := range []struct {
		k string
		v *string
	}{{"email", c.Email}, {"phone", c.Phone}, {"country", c.Country}} {
		if kv.v != nil {
			fmt.Fprintf(&b, "  %s: %s", kv.k, *kv.v)
		}
	}
	if c.DefaultRateMinor != nil {
		fmt.Fprintf(&b, "  rate: %d minor/h", *c.DefaultRateMinor)
	}
	fmt.Fprintf(&b, "\n    id: %s\n", c.ID)
	return b.String()
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
