package work

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Notification events (P5). Written in the transaction of the change that causes them, from the
activity entry that change records (record → fanout), so the inbox cannot disagree with the data:

	task.assigned    you were added as an assignee (on create or later)
	task.mentioned   a comment @mentions you
	task.done        a task you are assigned to, or created, moved into a done column
	budget.threshold a project you lead, or any project if you are a manager+, reached 80% / 100%
	                 of its hours or (managers+) money budget — budgets.go
	timer.long_running, time.missing_day — the P2 reminders (notifications.go)

The actor is never notified of their own action. A person can mute kinds (notification_prefs);
a muted kind is not stored at all. Realtime pushes happen after commit (Service.tx → flushNotes).
*/

type pendingNote struct {
	ws, user string
	note     *Notification
}

// pendingNotes: *sql.Tx → *[]pendingNote, published by Service.tx after a successful commit.
var pendingNotes sync.Map

// undelivered counts notifications that were written but had no transaction to be published
// from — see queueNote. Read by the CI guard in notify_test.go, which is the only reason it is
// not simply a log line.
var undelivered atomic.Int64

// UndeliveredNotifications is how many notifications were stored but never announced. It should
// be zero; anything else means someone recorded activity outside a transaction (see queueNote).
func UndeliveredNotifications() int64 { return undelivered.Load() }

// queueNote holds a notification until its transaction commits, so a reader never hears about a
// row that a rollback is about to remove (Service.tx → flushNotes).
//
// Delivery therefore depends on `q` being that transaction. When it is not — `record` was handed
// a *sql.DB, as the integration hooks do (internal/work/integration_hooks.go) — the row is
// written and then nothing announces it: no realtime event, so the inbox badge does not move
// until a reload, and no Web Push, so the notification simply never arrives.
//
// No action currently reaches this path: fanout only handles task.* and comment.added, and every
// one of those runs in a transaction. It is a trap rather than a live bug, which is exactly why
// it is counted and logged instead of silently returning — the day someone adds an integration
// action to fanout's switch, that silence would be the whole symptom.
func queueNote(q querier, ws, user string, n *Notification) {
	if n == nil {
		return
	}
	tx, ok := q.(*sql.Tx)
	if !ok {
		undelivered.Add(1)
		slog.Error("notification stored but never announced: recorded outside a transaction",
			"workspace", ws, "user", user, "kind", n.Kind,
			"fix", "pass the transaction of the change to record/RecordActivity")
		return
	}
	v, _ := pendingNotes.LoadOrStore(tx, &[]pendingNote{})
	list := v.(*[]pendingNote)
	*list = append(*list, pendingNote{ws, user, n})
}

func (sv *Service) flushNotes(tx *sql.Tx) {
	v, ok := pendingNotes.LoadAndDelete(tx)
	if !ok {
		return
	}
	for _, p := range *v.(*[]pendingNote) {
		sv.publish(p.ws, p.user, "notification.created", p.note)
	}
}

// muted reports whether user muted kind in ws.
func muted(ctx context.Context, q querier, ws, user, kind string) bool {
	var list string
	if err := q.QueryRowContext(ctx, `SELECT muted_kinds FROM notification_prefs WHERE workspace_id = $1 AND user_id = $2`, ws, user).Scan(&list); err != nil {
		return false
	}
	for _, k := range strings.Split(list, ",") {
		if strings.TrimSpace(k) == kind {
			return true
		}
	}
	return false
}

// Fallback text in the workspace language; the UI renders its own from kind + data.
var eventText = map[string]map[string]string{
	"en": {
		"task.assigned":  "%s assigned you %s: %s",
		"task.mentioned": "%s mentioned you on %s: %s",
		"task.done":      "%s moved %s to done: %s",
	},
	"ar": {
		"task.assigned":  "أسند %s إليك %s: %s",
		"task.mentioned": "أشار إليك %s في %s: %s",
		"task.done":      "نقل %s المهمة %s إلى المنجز: %s",
	},
}

func eventTitle(locale, kind, actor, key, title string) string {
	t, ok := eventText[locale]
	if !ok {
		t = eventText["en"]
	}
	return fmt.Sprintf(t[kind], actor, key, title)
}

func stringList(v any) []string {
	switch x := v.(type) {
	case []string:
		return x
	case []any:
		out := []string{}
		for _, i := range x {
			if s, ok := i.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// fanout turns an activity entry into notifications (inside the caller's transaction).
func fanout(ctx context.Context, q querier, s *tenant.Scope, e entry) error {
	var kind string
	var people []string
	switch e.Action {
	case "task.created":
		kind, people = "task.assigned", stringList(e.Changes["assignees"])
	case "task.assigned":
		kind, people = "task.assigned", stringList(e.Changes["added"])
	case "comment.added":
		kind, people = "task.mentioned", stringList(e.Changes["mentions"])
	case "task.moved", "task.updated":
		if done, _ := e.Changes["done"].(bool); !done {
			return nil
		}
		kind = "task.done"
		rows, err := q.QueryContext(ctx, `SELECT user_id FROM task_assignees WHERE workspace_id = $1 AND task_id = $2
			UNION SELECT created_by FROM tasks WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, e.TaskID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var u string
			if err := rows.Scan(&u); err != nil {
				rows.Close()
				return err
			}
			people = append(people, u)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	default:
		return nil
	}
	people = dedupe(people)
	if len(people) == 0 {
		return nil
	}
	var locale, slug string
	if err := q.QueryRowContext(ctx, `SELECT locale, slug FROM workspaces WHERE id = $1`, s.WorkspaceID).Scan(&locale, &slug); err != nil {
		return err
	}
	key, _ := e.Changes["key"].(string)
	title, _ := e.Changes["title"].(string)
	actor := s.Email
	if actor == "" {
		actor = "Someone"
	}
	if s.Via == "mcp" {
		actor += " (MCP)"
	}
	url := "/w/" + slug + "/projects/" + e.ProjectID + "/board?task=" + key
	data := map[string]any{"actor_id": s.UserID, "actor": actor, "task_key": key, "task_title": title, "project_id": e.ProjectID, "task_id": e.TaskID}
	body := ""
	if ex, ok := e.Changes["excerpt"].(string); ok {
		body = ex
		data["excerpt"] = ex
	}
	for _, u := range people {
		if u == s.UserID {
			continue // never notify the actor
		}
		// Only people who are still active members (a removed assignee keeps no inbox here).
		var active bool
		if err := q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active')`,
			s.WorkspaceID, u).Scan(&active); err != nil {
			return err
		}
		if !active {
			continue
		}
		n, err := notify(ctx, q, s.WorkspaceID, u, newNote{Kind: kind, Title: eventTitle(locale, kind, actor, key, title),
			Body: body, URL: url, Data: data})
		if err != nil {
			return err
		}
		queueNote(q, s.WorkspaceID, u, n)
	}
	return nil
}

// nativePayload is what a phone needs beyond the banner (MH-352): enough to open the right screen
// without another request, and the title in each language the app might be set to. The inbox
// row's own title is in the workspace's language; a person whose phone is in Arabic in an
// English workspace should still read Arabic on their lock screen.
func nativePayload(workspace string, n *Notification) (map[string]string, map[string]string) {
	str := func(k string) string {
		if v, ok := n.Data[k].(string); ok {
			return v
		}
		return ""
	}
	data := map[string]string{"workspace_id": workspace, "kind": n.Kind, "notification_id": n.ID}
	if n.URL != nil {
		// Notification URLs are /w/{slug}/…, so the slug a deep link needs is already there.
		if rest, ok := strings.CutPrefix(*n.URL, "/w/"); ok {
			if slug, _, _ := strings.Cut(rest, "/"); slug != "" {
				data["workspace_slug"] = slug
			}
		}
	}
	if v := str("project_id"); v != "" {
		data["project_id"] = v
	}
	if v := str("task_key"); v != "" {
		data["key"] = v
	}
	var titles map[string]string
	if actor, key, title := str("actor"), str("task_key"), str("task_title"); key != "" {
		if _, known := eventText["en"][n.Kind]; known {
			titles = map[string]string{}
			for locale := range eventText {
				titles[locale] = eventTitle(locale, n.Kind, actor, key, title)
			}
		}
	}
	return data, titles
}
