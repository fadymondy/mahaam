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
WorkspaceTools close the gap between the REST API and the user MCP, so an agent can run the
whole workspace: teams, labels, who is on a project (people and teams), portal contacts,
checklists, deleting tasks, the activity feed and the notification inbox. Each calls the same
internal/work method as REST, on the token's tenant.Scope. People accept an email, id or "me".

	list_teams, list_labels, list_notifications, project_activity   (read scopes)
	create_team, update_team (members replace), create_label         teams:write / tasks:write
	add_project_member, remove_project_member,
	attach_project_team, detach_project_team                         projects:write
	share_client_portal, unshare_client_portal                       clients:write
	add_checklist_item, delete_task                                  tasks:write
	mark_notifications_read                                          members:read
*/
func WorkspaceTools() []Tool {
	return []Tool{
		{
			Name: "list_teams", Description: "Teams with their members and project count. Adding a team to a project adds everyone in it.",
			Scope: "members:read", InputSchema: schema(nil, map[string]any{}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				list, err := work.New(a).ListTeams(ctx)
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No teams yet.", nil
				}
				dir := people(ctx, a)
				var b strings.Builder
				for _, t := range list {
					names := make([]string, len(t.MemberIDs))
					for i, id := range t.MemberIDs {
						names[i] = dir.name(id)
					}
					fmt.Fprintf(&b, "%s (id %s) · %d project(s) · %s\n", t.Name, t.ID, t.ProjectCount, strings.Join(names, ", "))
				}
				return b.String(), nil
			},
		},
		{
			Name: "create_team", Description: "Create a team with members (emails, ids or me).",
			Scope: "teams:write",
			InputSchema: schema([]string{"name"}, map[string]any{
				"name": prop("string", "Team name"), "description": prop("string", ""), "members": arrProp("Emails, ids or me"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				ids, err := people(ctx, a).resolveAll(ctx, strList(args, "members"))
				if err != nil {
					return "", err
				}
				name, desc := str(args, "name"), str(args, "description")
				t, err := work.New(a).CreateTeam(ctx, work.TeamInput{Name: &name, Description: &desc, MemberIDs: &ids})
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Created team %s (id %s) with %d member(s).", t.Name, t.ID, len(t.MemberIDs)), nil
			},
		},
		{
			Name: "update_team", Description: "Rename a team or REPLACE its members (everyone on the team's projects follows the change).",
			Scope: "teams:write",
			InputSchema: schema([]string{"team"}, map[string]any{
				"team": prop("string", "Team id"), "name": prop("string", ""), "members": arrProp("Replaces the members: emails, ids or me"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				in := work.TeamInput{}
				if v, ok := args["name"].(string); ok {
					in.Name = &v
				}
				if _, ok := args["members"]; ok {
					ids, err := people(ctx, a).resolveAll(ctx, strList(args, "members"))
					if err != nil {
						return "", err
					}
					in.MemberIDs = &ids
				}
				t, err := work.New(a).UpdateTeam(ctx, str(args, "team"), in)
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Team %s now has %d member(s).", t.Name, len(t.MemberIDs)), nil
			},
		},
		{
			Name: "list_labels", Description: "The workspace's labels (for tasks, and for grouping projects: label grants follow them).",
			Scope: "tasks:read", InputSchema: schema(nil, map[string]any{}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				list, err := work.New(a).ListLabels(ctx)
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				for _, l := range list {
					fmt.Fprintf(&b, "%s [%s] · %d task(s) · id %s\n", l.Name, l.Color, l.TaskCount, l.ID)
				}
				if b.Len() == 0 {
					return "No labels yet.", nil
				}
				return b.String(), nil
			},
		},
		{
			Name: "create_label", Description: "Create a label (colour is a palette key such as slate, violet, amber, emerald).",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"name"}, map[string]any{"name": prop("string", ""), "color": prop("string", "Palette key, default slate")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				name := str(args, "name")
				in := work.LabelInput{Name: &name}
				if c := str(args, "color"); c != "" {
					in.Color = &c
				}
				l, err := work.New(a).CreateLabel(ctx, in)
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Created label %s (id %s).", l.Name, l.ID), nil
			},
		},
		projectPersonTool("add_project_member", "Add (or re-role) a person on a project: role member or lead.", true),
		projectPersonTool("remove_project_member", "Remove a person from a project.", false),
		projectTeamTool("attach_project_team", "Attach a team to a project: everyone in it (now and later) gets access.", true),
		projectTeamTool("detach_project_team", "Detach a team from a project.", false),
		{
			Name: "share_client_portal", Description: "Give a person access to a client's portal (they become that client's portal contact and see its projects as a customer).",
			Scope: "clients:write",
			InputSchema: schema([]string{"client", "person"}, map[string]any{
				"client": prop("string", "Client id or exact name"), "person": prop("string", "Email or user id (a workspace member with the client role)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				c, err := work.New(a).ShareClient(ctx, str(args, "client"), str(args, "person"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Shared the portal of client %s with %s.", c.ClientID, orDefault(c.Email, c.UserID)), nil
			},
		},
		{
			Name: "unshare_client_portal", Description: "Remove a person's access to a client's portal.",
			Scope: "clients:write",
			InputSchema: schema([]string{"client", "person"}, map[string]any{
				"client": prop("string", "Client id or exact name"), "person": prop("string", "Email or user id"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				if err := work.New(a).Unshare(ctx, str(args, "client"), str(args, "person")); err != nil {
					return "", toolErr(err)
				}
				return "Removed.", nil
			},
		},
		{
			Name: "add_checklist_item", Description: "Add a checklist item to a task (MG-12).",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"task", "title"}, map[string]any{"task": prop("string", "MG-12, 12 or id"), "title": prop("string", "")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				it, err := work.New(a).AddChecklistItem(ctx, str(args, "task"), str(args, "title"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Added %q (id %s).", it.Title, it.ID), nil
			},
		},
		{
			Name: "delete_task", Description: "Delete a task permanently (its subtasks, checklist and comments go with it).",
			Scope:       "tasks:write",
			InputSchema: schema([]string{"task"}, map[string]any{"task": prop("string", "MG-12, 12 or id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				if err := work.New(a).DeleteTask(ctx, str(decodeArgs(raw), "task")); err != nil {
					return "", toolErr(err)
				}
				return "Deleted.", nil
			},
		},
		{
			Name: "project_activity", Description: "A project's recent activity feed (who did what, including agents via MCP).",
			Scope:       "projects:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": prop("string", "Project id or exact name"), "limit": prop("integer", "Default 30")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				p, err := sv.FindProject(ctx, str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				list, err := sv.ProjectActivity(ctx, p.ID, intArg(args, "limit", 30))
				if err != nil {
					return "", toolErr(err)
				}
				dir := people(ctx, a)
				var b strings.Builder
				for _, e := range list {
					fmt.Fprintf(&b, "%s  %s  %s via %s  (%s %s)\n", e.CreatedAt.Format("2006-01-02 15:04"), dir.name(e.ActorID), e.Action, e.Via, e.SubjectType, e.SubjectID)
				}
				if b.Len() == 0 {
					return "No activity yet.", nil
				}
				return b.String(), nil
			},
		},
		{
			Name: "list_notifications", Description: "Your notification inbox (newest first) with the unread count.",
			Scope: "members:read", InputSchema: schema(nil, map[string]any{"limit": prop("integer", "Default 20")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				in, err := work.New(a).Inbox(ctx, intArg(decodeArgs(raw), "limit", 20))
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%d unread.\n\n", in.Unread)
				for _, n := range in.Notifications {
					mark := " "
					if n.ReadAt == nil {
						mark = "•"
					}
					fmt.Fprintf(&b, "%s %s  %s  (id %s)\n", mark, n.CreatedAt.Format("2006-01-02 15:04"), n.Title, n.ID)
				}
				return b.String(), nil
			},
		},
		{
			Name: "mark_notifications_read", Description: "Mark one notification read (id) or all of them (all=true).",
			Scope:       "members:read",
			InputSchema: schema(nil, map[string]any{"id": prop("string", "Notification id"), "all": prop("boolean", "Mark every notification read")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				if boolArg(args, "all") {
					n, err := sv.ReadAllNotifications(ctx)
					if err != nil {
						return "", toolErr(err)
					}
					return fmt.Sprintf("Marked %d read.", n), nil
				}
				if err := sv.ReadNotification(ctx, str(args, "id")); err != nil {
					return "", toolErr(err)
				}
				return "Marked read.", nil
			},
		},
	}
}

func projectPersonTool(name, desc string, add bool) Tool {
	props := map[string]any{"project": prop("string", "Project id or exact name"), "person": prop("string", "Email, user id or me")}
	if add {
		props["role"] = map[string]any{"type": "string", "enum": []string{"member", "lead"}}
	}
	return Tool{
		Name: name, Description: desc, Scope: "projects:write",
		InputSchema: schema([]string{"project", "person"}, props),
		Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
			args := decodeArgs(raw)
			sv := work.New(a)
			p, err := sv.FindProject(ctx, str(args, "project"))
			if err != nil {
				return "", toolErr(err)
			}
			uid, err := people(ctx, a).resolve(ctx, str(args, "person"))
			if err != nil {
				return "", err
			}
			if add {
				role := str(args, "role")
				if role == "" {
					role = "member"
				}
				if _, err := sv.AddProjectMember(ctx, p.ID, uid, role); err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("%s is on %s as %s.", str(args, "person"), p.Name, role), nil
			}
			if _, err := sv.RemoveProjectMember(ctx, p.ID, uid); err != nil {
				return "", toolErr(err)
			}
			return fmt.Sprintf("Removed %s from %s.", str(args, "person"), p.Name), nil
		},
	}
}

func projectTeamTool(name, desc string, attach bool) Tool {
	return Tool{
		Name: name, Description: desc, Scope: "projects:write",
		InputSchema: schema([]string{"project", "team"}, map[string]any{
			"project": prop("string", "Project id or exact name"), "team": prop("string", "Team id"),
		}),
		Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
			args := decodeArgs(raw)
			sv := work.New(a)
			p, err := sv.FindProject(ctx, str(args, "project"))
			if err != nil {
				return "", toolErr(err)
			}
			if attach {
				if _, err := sv.AttachTeam(ctx, p.ID, str(args, "team")); err != nil {
					return "", toolErr(err)
				}
				return "Team attached to " + p.Name + ".", nil
			}
			if _, err := sv.DetachTeam(ctx, p.ID, str(args, "team")); err != nil {
				return "", toolErr(err)
			}
			return "Team detached from " + p.Name + ".", nil
		},
	}
}

func orDefault(p *string, def string) string {
	if p != nil && *p != "" {
		return *p
	}
	return def
}
