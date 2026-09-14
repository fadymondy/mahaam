package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/managy/internal/app"
	"github.com/fadymondy/managy/internal/tenant"
	"github.com/fadymondy/managy/internal/work"
)

/*
TimeTools are the P2 time-tracking tools of the user MCP. They call the same internal/work
functions as the REST API (/api/w/time*), so an agent gets its human's rules exactly: one running
timer, start stops the previous one in the same transaction, locked or invoiced entries refused,
rates snapshotted. Writes land in the activity feed "via MCP" and on the person's realtime channel,
so the timer bar in every open tab moves when an agent starts or stops a timer.

Scopes: time:read (get_running_timer, list_time_entries), time:write (the rest). Touching another
member's time needs time:manage on the TOKEN as well as the role — checked here, on top of the
role check in internal/work.
*/
func TimeTools() []Tool {
	return []Tool{
		{
			Name:        "get_running_timer",
			Description: "The running timer: what it is on, since when, for how long. Yours by default.",
			Scope:       "time:read",
			InputSchema: schema(nil, map[string]any{"user": prop("string", "Email, user id or \"me\" (someone else needs time:manage)")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				who, err := timeSubject(ctx, a, str(args, "user"))
				if err != nil {
					return "", err
				}
				sv := work.New(a)
				e, err := sv.RunningTimer(ctx, who)
				if err != nil {
					return "", toolErr(err)
				}
				if e == nil {
					return "No timer is running.", nil
				}
				return "Running: " + entryLine(e, zone(ctx, sv), true), nil
			},
		},
		{
			Name:        "list_time_entries",
			Description: "Time entries overlapping a date range (workspace timezone), newest first. Default: your last 7 days.",
			Scope:       "time:read",
			InputSchema: schema(nil, map[string]any{
				"from":    prop("string", "YYYY-MM-DD (default: 6 days before `to`)"),
				"to":      prop("string", "YYYY-MM-DD (default: today)"),
				"user":    prop("string", "Email, user id, \"me\", or \"*\" for everyone (others need time:manage)"),
				"project": prop("string", "Project id or exact name"),
				"limit":   prop("integer", "Default 100"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				who := str(args, "user")
				if who != "*" {
					var err error
					if who, err = timeSubject(ctx, a, who); err != nil {
						return "", err
					}
				} else if err := needManageScope(ctx); err != nil {
					return "", err
				}
				sv := work.New(a)
				list, err := sv.ListTimeEntries(ctx, work.EntryFilter{User: who, From: str(args, "from"), To: str(args, "to"),
					ProjectID: str(args, "project"), Limit: intArg(args, "limit", 100)})
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No time entries in that range.", nil
				}
				loc := zone(ctx, sv)
				ppl := people(ctx, a)
				var b strings.Builder
				var total int64
				for i := range list {
					e := &list[i]
					total += seconds(e)
					if who == "*" {
						fmt.Fprintf(&b, "%s  ", ppl.name(e.UserID))
					}
					b.WriteString(entryLine(e, loc, false) + "\n")
				}
				fmt.Fprintf(&b, "\n%d entr%s, %s in total (%s).", len(list), plural(len(list), "y", "ies"), dur(total), loc)
				return b.String(), nil
			},
		},
		{
			Name:        "start_timer",
			Description: "Start a timer on a task, a project, or just a description. A running timer is stopped first, in the same transaction.",
			Scope:       "time:write",
			InputSchema: schema(nil, map[string]any{
				"task":        prop("string", "MG-12, 12 or the task id (implies its project)"),
				"project":     prop("string", "Project id or exact name"),
				"description": prop("string", "What you are working on"),
				"billable":    prop("boolean", "Default: true on an hourly project"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				in := work.StartInput{Project: optStr(args, "project"), Task: optStr(args, "task"), Description: optStr(args, "description")}
				if _, ok := args["billable"]; ok {
					b := boolArg(args, "billable")
					in.Billable = &b
				}
				sv := work.New(a)
				ch, err := sv.StartTimer(ctx, in)
				if err != nil {
					return "", toolErr(err)
				}
				loc := zone(ctx, sv)
				out := "Started: " + entryLine(ch.Started, loc, true)
				if ch.Stopped != nil {
					out += "\nStopped the previous timer: " + entryLine(ch.Stopped, loc, false)
				}
				return out, nil
			},
		},
		{
			Name:        "stop_timer",
			Description: "Stop the running timer. Yours by default; another member's needs time:manage.",
			Scope:       "time:write",
			InputSchema: schema(nil, map[string]any{"user": prop("string", "Email, user id or \"me\"")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				who, err := timeSubject(ctx, a, str(decodeArgs(raw), "user"))
				if err != nil {
					return "", err
				}
				sv := work.New(a)
				e, err := sv.StopTimer(ctx, who)
				if err != nil {
					return "", toolErr(err)
				}
				return "Stopped: " + entryLine(e, zone(ctx, sv), false), nil
			},
		},
		{
			Name: "log_time",
			Description: "Log a finished block of time. Give started_at + ended_at, or started_at + minutes, or date + minutes " +
				"(placed after your last entry that day, not before 09:00). Times are RFC 3339, or HH:MM with date in the " +
				"workspace timezone; 23:00 to 01:00 crosses midnight.",
			Scope: "time:write",
			InputSchema: schema(nil, map[string]any{
				"task":        prop("string", "MG-12, 12 or the task id"),
				"project":     prop("string", "Project id or exact name"),
				"description": prop("string", "What was done"),
				"date":        prop("string", "YYYY-MM-DD (workspace timezone)"),
				"started_at":  prop("string", "RFC 3339, or HH:MM with date"),
				"ended_at":    prop("string", "RFC 3339, or HH:MM with date"),
				"minutes":     prop("integer", "Length, instead of ended_at"),
				"billable":    prop("boolean", "Default: true on an hourly project"),
				"user":        prop("string", "Log for another member (email or id; needs time:manage)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				who, err := timeSubject(ctx, a, str(args, "user"))
				if err != nil {
					return "", err
				}
				in := work.LogInput{User: &who, Project: optStr(args, "project"), Task: optStr(args, "task"),
					Description: optStr(args, "description"), Date: optStr(args, "date"),
					StartedAt: optStr(args, "started_at"), EndedAt: optStr(args, "ended_at")}
				if m := optInt(args, "minutes"); m != nil {
					v := int(*m)
					in.Minutes = &v
				}
				if _, ok := args["billable"]; ok {
					b := boolArg(args, "billable")
					in.Billable = &b
				}
				sv := work.New(a)
				e, err := sv.LogTime(ctx, in)
				if err != nil {
					return "", toolErr(err)
				}
				return "Logged: " + entryLine(e, zone(ctx, sv), false), nil
			},
		},
		{
			Name:        "update_time_entry",
			Description: "Change a time entry: project, task, description, billable, start or end. Locked or invoiced entries are refused.",
			Scope:       "time:write",
			InputSchema: schema([]string{"id"}, map[string]any{
				"id":          prop("string", "The entry id"),
				"project":     prop("string", "Project id or name (\"\" clears project and task)"),
				"task":        prop("string", "MG-12, 12 or id (\"\" clears the task)"),
				"description": prop("string", "New description"),
				"billable":    prop("boolean", "Billable or not"),
				"started_at":  prop("string", "RFC 3339"),
				"ended_at":    prop("string", "RFC 3339 (not on a running timer: stop it)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				id := str(args, "id")
				if err := ownOrManage(ctx, sv, id); err != nil {
					return "", err
				}
				p := work.EntryPatch{Project: optStr(args, "project"), Task: optStr(args, "task"), Description: optStr(args, "description"),
					StartedAt: optStr(args, "started_at"), EndedAt: optStr(args, "ended_at")}
				if _, ok := args["billable"]; ok {
					b := boolArg(args, "billable")
					p.Billable = &b
				}
				e, err := sv.UpdateTimeEntry(ctx, id, p)
				if err != nil {
					return "", toolErr(err)
				}
				return "Updated: " + entryLine(e, zone(ctx, sv), e.EndedAt == nil), nil
			},
		},
		{
			Name:        "delete_time_entry",
			Description: "Delete a time entry (a running one is discarded). Refused when the entry is locked or invoiced.",
			Scope:       "time:write",
			InputSchema: schema([]string{"id"}, map[string]any{"id": prop("string", "The entry id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				sv := work.New(a)
				id := str(decodeArgs(raw), "id")
				if err := ownOrManage(ctx, sv, id); err != nil {
					return "", err
				}
				if err := sv.DeleteTimeEntry(ctx, id); err != nil {
					return "", toolErr(err)
				}
				return "Deleted the entry.", nil
			},
		},
	}
}

var errManageScope = errors.New(`acting on another member's time needs the "time:manage" scope, which this token does not carry`)

func needManageScope(ctx context.Context) error {
	s, ok := tenant.From(ctx)
	if !ok || !hasScope(s.Scopes, "time:manage") {
		return errManageScope
	}
	return nil
}

// timeSubject resolves a person argument to a user id; anyone but the caller needs time:manage.
func timeSubject(ctx context.Context, a *app.App, who string) (string, error) {
	s, _ := tenant.From(ctx)
	if strings.TrimSpace(who) == "" || strings.EqualFold(strings.TrimSpace(who), "me") {
		return s.UserID, nil
	}
	id, err := people(ctx, a).resolve(ctx, who)
	if err != nil {
		return "", err
	}
	if id != s.UserID {
		if err := needManageScope(ctx); err != nil {
			return "", err
		}
	}
	return id, nil
}

// ownOrManage refuses an id that names someone else's entry unless the token holds time:manage.
func ownOrManage(ctx context.Context, sv *work.Service, id string) error {
	e, err := sv.GetTimeEntry(ctx, id)
	if err != nil {
		return toolErr(err)
	}
	if s, _ := tenant.From(ctx); e.UserID != s.UserID {
		return needManageScope(ctx)
	}
	return nil
}

func zone(ctx context.Context, sv *work.Service) *time.Location {
	if st, err := sv.GetTimeSettings(ctx); err == nil {
		if l, err := time.LoadLocation(st.Timezone); err == nil {
			return l
		}
	}
	return time.UTC
}

func seconds(e *work.TimeEntry) int64 {
	if e.DurationS != nil {
		return *e.DurationS
	}
	return int64(time.Since(e.StartedAt) / time.Second)
}

func dur(sec int64) string {
	h, m := sec/3600, (sec%3600)/60
	switch {
	case h > 0 && m > 0:
		return fmt.Sprintf("%dh %dm", h, m)
	case h > 0:
		return fmt.Sprintf("%dh", h)
	case m > 0:
		return fmt.Sprintf("%dm", m)
	}
	return fmt.Sprintf("%ds", sec)
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// entryLine renders one entry compactly, in the workspace timezone.
func entryLine(e *work.TimeEntry, loc *time.Location, running bool) string {
	var b strings.Builder
	what := strings.TrimSpace(e.Description)
	if what == "" {
		what = "(no description)"
	}
	b.WriteString(what)
	if e.TaskKey != nil {
		fmt.Fprintf(&b, "  [%s %s]", *e.TaskKey, deref(e.TaskTitle))
	}
	if e.ProjectName != nil {
		fmt.Fprintf(&b, "  on %s", *e.ProjectName)
	}
	st := e.StartedAt.In(loc)
	if e.EndedAt == nil {
		fmt.Fprintf(&b, "  since %s (%s so far)", st.Format("2006-01-02 15:04"), dur(seconds(e)))
	} else {
		fmt.Fprintf(&b, "  %s–%s (%s)", st.Format("2006-01-02 15:04"), e.EndedAt.In(loc).Format("15:04"), dur(seconds(e)))
	}
	if e.Billable {
		b.WriteString("  billable")
	}
	if e.Locked {
		b.WriteString("  LOCKED")
	}
	fmt.Fprintf(&b, "  id=%s", e.ID)
	_ = running
	return b.String()
}
