package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
PortalTools are the customer portal and the Requests inbox (roadmap 5), on the same domain
functions as /api/w/portal/* and /api/w/requests/* (internal/work/portal_panel.go,
internal/reports/portal_panel.go, requests.go):

	portal_projects, portal_project        portal:read     (clients up; aggregates only)
	request_feature                        portal:write    (clients up; files a pending request)
	list_requests, accept_request,
	decline_request, convert_request       requests:manage (manager+)
*/
func PortalTools() []Tool {
	return []Tool{
		{
			Name:        "portal_projects",
			Description: "Your projects as their customer sees them: status, dates, % done, hours used vs the hours budget, open issues and pending requests.",
			Scope:       "portal:read",
			InputSchema: schema(nil, map[string]any{}),
			Run: func(ctx context.Context, a *app.App, _ json.RawMessage) (string, error) {
				list, err := work.New(a).PortalProjects(ctx)
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No projects are shared with you.", nil
				}
				var b strings.Builder
				for _, p := range list {
					fmt.Fprintf(&b, "%s  [%s]  %d%% done (%d/%d/%d todo/doing/done)  %s  issues open %d  requests pending %d  (id %s)\n",
						p.Name, p.Status, p.PercentDone, p.Tasks.Todo, p.Tasks.Doing, p.Tasks.Done, hoursLine(p.UsedMinutes, p.BudgetMinutes),
						p.OpenIssues, p.PendingRequests, p.ID)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "portal_project",
			Description: "One project's customer panel: progress, hours per week (totals), issues, requests with the team's replies, and sent invoices.",
			Scope:       "portal:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": prop("string", "Project id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				p, err := reports.PortalProject(ctx, a, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%s [%s]  %d%% done (%d todo, %d doing, %d done)  %s\n", p.Name, p.Status, p.PercentDone,
					p.Tasks.Todo, p.Tasks.Doing, p.Tasks.Done, hoursLine(p.UsedMinutes, p.BudgetMinutes))
				if p.StartsOn != nil || p.EndsOn != nil {
					fmt.Fprintf(&b, "dates: %s → %s\n", deref(p.StartsOn), deref(p.EndsOn))
				}
				if p.ClientName != nil {
					fmt.Fprintf(&b, "client: %s\n", *p.ClientName)
				}
				if p.Description != nil && *p.Description != "" {
					fmt.Fprintf(&b, "description: %s\n", *p.Description)
				}
				if p.BudgetAmount != nil {
					fmt.Fprintf(&b, "money budget: %.2f %s\n", float64(*p.BudgetAmount)/100, deref(p.BudgetCurrency))
				}
				if len(p.Team) > 0 {
					b.WriteString("team:")
					for _, m := range p.Team {
						fmt.Fprintf(&b, " %s (%s);", m.Name, m.Role)
					}
					b.WriteString("\n")
				}
				if len(p.Columns) > 0 {
					b.WriteString("columns:")
					for _, c := range p.Columns {
						fmt.Fprintf(&b, " %s=%d", c.Name, c.TaskCount)
					}
					b.WriteString("  (portal_board lists the tasks)\n")
				}
				fmt.Fprintf(&b, "completed tasks: %d in 7 days, %d in 30 days\nhours per week:", p.Completed7d, p.Completed30d)
				for _, w := range p.Weeks {
					fmt.Fprintf(&b, " %s=%.1f", w.Week, float64(w.Minutes)/60)
				}
				fmt.Fprintf(&b, "\n\n%d issue(s):\n", len(p.Issues))
				for _, i := range p.Issues {
					fmt.Fprintf(&b, "  %s [%s/%s/%s] %s\n", i.Key, i.IssueType, i.Status, i.Priority, i.Title)
				}
				fmt.Fprintf(&b, "\n%d request(s):\n", len(p.Requests))
				for _, r := range p.Requests {
					fmt.Fprintf(&b, "  %s [%s %s] %s", r.Key, r.Kind, r.State, r.Title)
					if r.Reply != nil {
						fmt.Fprintf(&b, " — reply: %s", *r.Reply)
					}
					b.WriteString("\n")
				}
				if p.InvoicesVisible {
					fmt.Fprintf(&b, "\n%d invoice(s):\n", len(p.Invoices))
					for _, iv := range p.Invoices {
						fmt.Fprintf(&b, "  %s [%s] %.2f %s\n", iv.Number, iv.Status, float64(iv.TotalMinor)/100, iv.Currency)
					}
				}
				return b.String(), nil
			},
		},
		{
			Name:        "request_feature",
			Description: "File a request (a feature, a change or a bug) into one of your projects. It waits in the team's Requests inbox until accepted or declined.",
			Scope:       "portal:write",
			InputSchema: schema([]string{"project", "title"}, map[string]any{
				"project":    prop("string", "Project id or exact name"),
				"title":      prop("string", "Short summary"),
				"details":    prop("string", "What you need and why"),
				"kind":       map[string]any{"type": "string", "enum": reports.RequestKinds},
				"desired_on": prop("string", "YYYY-MM-DD you would like it by (optional)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := reports.FileRequest(ctx, a, reports.RequestInput{Project: str(args, "project"), Title: str(args, "title"),
					Body: str(args, "details"), Kind: str(args, "kind"), DesiredOn: str(args, "desired_on")})
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Filed request %s (%s): %s — pending review.", r.Key, r.Kind, r.Title), nil
			},
		},
		{
			Name:        "portal_board",
			Description: "Your project's task board, read-only (when the team shares it): each task's key, title, column, due date, assignees, labels and checklist progress.",
			Scope:       "portal:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": prop("string", "Project id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				bd, err := work.New(a).PortalBoard(ctx, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				for _, c := range bd.Columns {
					fmt.Fprintf(&b, "## %s (%d)\n", c.Name, c.TaskCount)
					for _, t := range bd.Tasks {
						if t.StatusID != c.ID {
							continue
						}
						fmt.Fprintf(&b, "  %s  %s", t.Key, t.Title)
						if t.DueAt != nil {
							fmt.Fprintf(&b, "  due %s", t.DueAt.Format("2006-01-02"))
						}
						if len(t.Assignees) > 0 {
							names := make([]string, 0, len(t.Assignees))
							for _, p := range t.Assignees {
								names = append(names, p.Name)
							}
							fmt.Fprintf(&b, "  → %s", strings.Join(names, ", "))
						}
						if t.ChecklistTotal > 0 {
							fmt.Fprintf(&b, "  [%d/%d]", t.ChecklistDone, t.ChecklistTotal)
						}
						b.WriteString("\n")
					}
				}
				if len(bd.Tasks) == 0 {
					b.WriteString("No tasks yet.\n")
				}
				return b.String(), nil
			},
		},
		{
			Name:        "portal_task",
			Description: "One task of your project, read-only: column, due date, assignees, labels, description and checklist.",
			Scope:       "portal:read",
			InputSchema: schema([]string{"project", "task"}, map[string]any{"project": prop("string", "Project id"), "task": prop("string", "MG-12")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				t, err := work.New(a).PortalTask(ctx, str(args, "project"), str(args, "task"))
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%s %s\ncolumn: %s  priority: %s\n", t.Key, t.Title, t.StatusName, t.Priority)
				if t.DueAt != nil {
					fmt.Fprintf(&b, "due: %s\n", t.DueAt.Format("2006-01-02"))
				}
				for _, p := range t.Assignees {
					fmt.Fprintf(&b, "assignee: %s\n", p.Name)
				}
				for _, l := range t.Labels {
					fmt.Fprintf(&b, "label: %s\n", l.Name)
				}
				if t.Description != nil {
					fmt.Fprintf(&b, "\n%s\n", *t.Description)
				}
				if len(t.Checklist) > 0 {
					fmt.Fprintf(&b, "\nchecklist %d/%d:\n", t.ChecklistDone, t.ChecklistTotal)
					for _, c := range t.Checklist {
						mark := " "
						if c.Done {
							mark = "x"
						}
						fmt.Fprintf(&b, "  [%s] %s\n", mark, c.Title)
					}
				}
				return b.String(), nil
			},
		},
		{
			Name:        "portal_issues",
			Description: "All issues of your project with status, priority and what you may do (accept / reopen).",
			Scope:       "portal:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": prop("string", "Project id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				p, err := reports.PortalProject(ctx, a, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(p.Issues) == 0 {
					return "No issues.", nil
				}
				var b strings.Builder
				for _, i := range p.Issues {
					fmt.Fprintf(&b, "%s [%s/%s/%s] %s  (%d comments)", i.Key, i.IssueType, i.Status, i.Priority, i.Title, i.CommentCount)
					if i.CanAccept {
						b.WriteString("  — you may accept it")
					}
					b.WriteString("\n")
				}
				return b.String(), nil
			},
		},
		{
			Name:        "portal_issue",
			Description: "One issue of your projects with its whole thread.",
			Scope:       "portal:read",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "MG-12")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				d, err := reports.GetPortalIssue(ctx, a, str(decodeArgs(raw), "key"))
				if err != nil {
					return "", toolErr(err)
				}
				return portalIssueText(d), nil
			},
		},
		{
			Name:        "portal_update_issue",
			Description: "On an issue of your project: accept it (status done, from in_review), reopen it (status todo, from done or in_review) and/or change its priority.",
			Scope:       "portal:write",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key":      prop("string", "MG-12"),
				"status":   map[string]any{"type": "string", "enum": []string{"done", "todo"}},
				"priority": map[string]any{"type": "string", "enum": reports.Priorities},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				in := reports.PortalIssueChange{}
				if v := str(args, "status"); v != "" {
					in.Status = &v
				}
				if v := str(args, "priority"); v != "" {
					in.Priority = &v
				}
				d, err := reports.UpdatePortalIssue(ctx, a, str(args, "key"), in)
				if err != nil {
					return "", toolErr(err)
				}
				return portalIssueText(d), nil
			},
		},
		{
			Name:        "portal_comment_issue",
			Description: "Reply on an issue of your project.",
			Scope:       "portal:write",
			InputSchema: schema([]string{"key", "body"}, map[string]any{"key": prop("string", "MG-12"), "body": prop("string", "Your reply")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				if _, err := reports.CommentPortalIssue(ctx, a, str(args, "key"), str(args, "body")); err != nil {
					return "", toolErr(err)
				}
				return "Comment added to " + strings.ToUpper(str(args, "key")) + ".", nil
			},
		},
		{
			Name:        "portal_requests",
			Description: "The requests of your projects with their state (pending, accepted, declined, converted) and the team's reply.",
			Scope:       "portal:read",
			InputSchema: schema(nil, map[string]any{"project": prop("string", "Limit to one project")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				list, err := reports.PortalRequests(ctx, a, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No requests.", nil
				}
				var b strings.Builder
				for _, r := range list {
					fmt.Fprintf(&b, "%s [%s %s] %s — %s", r.Key, r.Kind, r.State, r.Title, deref(r.ProjectName))
					if r.Reply != nil {
						fmt.Fprintf(&b, " — reply: %s", *r.Reply)
					}
					b.WriteString("\n")
				}
				return b.String(), nil
			},
		},
		{
			Name:        "portal_invoices",
			Description: "Your invoices (sent and paid; drafts are never shown).",
			Scope:       "portal:read",
			InputSchema: schema(nil, map[string]any{}),
			Run: func(ctx context.Context, a *app.App, _ json.RawMessage) (string, error) {
				list, err := work.New(a).PortalInvoices(ctx)
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No invoices.", nil
				}
				var b strings.Builder
				for _, iv := range list {
					fmt.Fprintf(&b, "%s [%s] %.2f %s\n", iv.Number, iv.Status, float64(iv.TotalMinor)/100, iv.Currency)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "portal_time",
			Description: "Tracked time on your project: total against the hours budget, by week, and by task (when the board is shared). No people, no money.",
			Scope:       "portal:read",
			InputSchema: schema([]string{"project"}, map[string]any{"project": prop("string", "Project id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				t, err := work.New(a).PortalTime(ctx, str(decodeArgs(raw), "project"))
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%s\nby week:", hoursLine(t.UsedMinutes, t.BudgetMinutes))
				for _, w := range t.Weeks {
					fmt.Fprintf(&b, " %s=%.1f", w.Week, float64(w.Minutes)/60)
				}
				b.WriteString("\n")
				for _, x := range t.ByTask {
					fmt.Fprintf(&b, "  %s %s: %.1fh\n", firstNonEmpty(deref(x.Key), "—"), firstNonEmpty(deref(x.Title), "(not on a task)"), float64(x.Minutes)/60)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "get_request",
			Description: "One customer request in any state: body, requester, state history, the team's reply and what it became (issue or task).",
			Scope:       "requests:manage",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "MG-12")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				d, err := reports.GetRequest(ctx, a, str(decodeArgs(raw), "key"))
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				fmt.Fprintf(&b, "%s [%s %s] %s — %s\nfrom: %s\n", d.Key, d.Kind, d.State, d.Title, deref(d.ProjectName), deref(d.ReporterEmail))
				if d.Body != nil {
					fmt.Fprintf(&b, "\n%s\n", *d.Body)
				}
				b.WriteString("\nhistory:\n")
				for _, h := range d.History {
					fmt.Fprintf(&b, "  %s %s %s\n", h.At.Format("2006-01-02 15:04"), h.State, deref(h.Note))
				}
				if d.TaskKey != nil {
					fmt.Fprintf(&b, "task: %s\n", *d.TaskKey)
				}
				return b.String(), nil
			},
		},
		{
			Name:        "reopen_request",
			Description: "Undo a decision: an accepted, declined or converted request goes back to pending (a task it became is kept).",
			Scope:       "requests:manage",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "MG-12"), "note": prop("string", "Why (optional)")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := reports.ReopenRequest(ctx, a, str(args, "key"), str(args, "note"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Reopened %s — pending again.", r.Key), nil
			},
		},
		{
			Name:        "list_requests",
			Description: "The customer Requests inbox: pending requests by default (state accepted/declined/converted/all for others).",
			Scope:       "requests:manage",
			InputSchema: schema(nil, map[string]any{
				"state":   map[string]any{"type": "string", "enum": []string{"pending", "accepted", "declined", "converted", "all"}},
				"project": prop("string", "Project id or exact name"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				list, err := reports.ListRequests(ctx, a, str(args, "state"), str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No requests.", nil
				}
				var b strings.Builder
				for _, r := range list {
					fmt.Fprintf(&b, "%s [%s %s] %s — %s", r.Key, r.Kind, r.State, r.Title, deref(r.ProjectName))
					if r.DesiredOn != nil {
						fmt.Fprintf(&b, " (wanted by %s)", *r.DesiredOn)
					}
					b.WriteString("\n")
				}
				return b.String(), nil
			},
		},
		{
			Name:        "accept_request",
			Description: "Accept a pending request: it becomes a normal issue on the board (status default todo) and the customer is notified.",
			Scope:       "requests:manage",
			InputSchema: schema([]string{"key"}, map[string]any{
				"key":        prop("string", "MG-12"),
				"status":     map[string]any{"type": "string", "enum": []string{"backlog", "todo", "in_progress"}},
				"priority":   map[string]any{"type": "string", "enum": reports.Priorities},
				"issue_type": map[string]any{"type": "string", "enum": reports.Types},
				"reply":      prop("string", "Optional note to the customer"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := reports.AcceptRequest(ctx, a, str(args, "key"), reports.AcceptInput{Status: str(args, "status"),
					Priority: str(args, "priority"), IssueType: str(args, "issue_type"), Reply: str(args, "reply")})
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Accepted %s — on the board in %s.", r.Key, r.Status), nil
			},
		},
		{
			Name:        "decline_request",
			Description: "Decline a pending request with a reason; the customer sees the reason.",
			Scope:       "requests:manage",
			InputSchema: schema([]string{"key", "reason"}, map[string]any{"key": prop("string", "MG-12"), "reason": prop("string", "Why")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, err := reports.DeclineRequest(ctx, a, str(args, "key"), str(args, "reason"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Declined %s.", r.Key), nil
			},
		},
		{
			Name:        "convert_request",
			Description: "Turn a pending request into a task (in its project, or another), linked by a comment; the customer is told it is planned.",
			Scope:       "requests:manage",
			InputSchema: schema([]string{"key"}, map[string]any{"key": prop("string", "MG-12"), "project": prop("string", "Project for the task (default the request's)")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				r, task, err := reports.ConvertRequest(ctx, a, str(args, "key"), str(args, "project"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Converted %s to task %s.", r.Key, task), nil
			},
		},
	}
}

func portalIssueText(d *reports.PortalIssueDetail) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s [%s/%s/%s] %s\n", d.Key, d.IssueType, d.Status, d.Priority, d.Title)
	if d.Body != nil {
		fmt.Fprintf(&b, "\n%s\n", *d.Body)
	}
	if d.CanAccept {
		b.WriteString("\nIn review: you may accept it (portal_update_issue status=done) or reopen it (status=todo).\n")
	} else if d.CanReopen {
		b.WriteString("\nDone: you may reopen it (portal_update_issue status=todo).\n")
	}
	fmt.Fprintf(&b, "\n%d comment(s):\n", len(d.Comments))
	for _, c := range d.Comments {
		who := "team"
		if c.Mine {
			who = "you"
		} else if c.AuthorKind == "agent" {
			who = "agent"
		}
		fmt.Fprintf(&b, "  [%s %s] %s\n", c.CreatedAt.Format("2006-01-02 15:04"), who, c.Body)
	}
	return b.String()
}

func hoursLine(used int64, budget *int64) string {
	if budget != nil && *budget > 0 {
		return fmt.Sprintf("%.1fh of %.1fh budget", float64(used)/60, float64(*budget)/60)
	}
	return fmt.Sprintf("%.1fh tracked", float64(used)/60)
}
