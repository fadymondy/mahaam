package work

import (
	"context"
	"database/sql"
	"regexp"
	"sync"
	"time"
)

/*
Realtime for boards (MH-351): task.*, issue.* and project.updated on /api/w/events, so a board, the
projects home, a widget or a Live Activity can refresh the moment something changes rather than on
the next poll.

The contract for a client:

  - Events carry ids, never content: {project_id, task_id | key, action, actor_id}. Titles, bodies
    and comments are fetched through the ordinary reads, which apply every access rule. An event is
    a hint to refetch, so there is nothing in it to leak or to go stale.
  - Delivery is at most once, with no replay. On (re)connect, refetch what is on screen; the stream
    guarantees nothing about the time it was closed. That keeps /api/w/events stateless and
    identical on every instance (internal/live, "no replay, by design").
  - project.updated carries the progress counts {tasks_total, tasks_done}, because that is what
    the projects home and the widgets draw, and it saves them a request per change.

Who receives an event: managers and up, and members with FULL access to the project (fullAccessSQL:
workspace-visible, on it, on a team attached to it, or granted one of its labels). A member who
sees only a task or two in a project, through a grant or an assignment, gets no events for that
project. For them the board catches up on its next read. Clients get none: the portal shows
aggregates only, and they refetch.

Events are queued inside the transaction and sent after it commits, like notifications
(queueNote): a reader must never hear about a row a rollback is about to remove.
*/

// liveEvent is one queued announcement.
type liveEvent struct {
	workspace, project, event string
	data                      map[string]any
}

var pendingEvents sync.Map // *sql.Tx → *[]liveEvent

// queueEvent holds e until tx commits (Service.tx → flushEvents). Outside a transaction there is
// no commit to wait for; those callers use Broadcast directly.
func queueEvent(q querier, e liveEvent) {
	tx, ok := q.(*sql.Tx)
	if !ok {
		return
	}
	v, _ := pendingEvents.LoadOrStore(tx, &[]liveEvent{})
	list := v.(*[]liveEvent)
	*list = append(*list, e)
}

func (sv *Service) flushEvents(tx *sql.Tx) {
	v, ok := pendingEvents.LoadAndDelete(tx)
	if !ok {
		return
	}
	// Collected now (the transaction's entry is deleted as tx() returns), announced off the
	// request: working out the recipients is a query per event, and the change is already done.
	go sv.announce(*v.(*[]liveEvent))
}

func (sv *Service) announce(list []liveEvent) {
	// A burst in one transaction (a task created with assignees and labels writes several
	// activity rows) announces each distinct event once, and progress once per project.
	seen := map[string]bool{}
	projects := map[[2]string]bool{}
	for _, e := range list {
		k := e.workspace + "|" + e.event + "|" + str(e.data["task_id"]) + "|" + str(e.data["key"]) + "|" + e.project
		if seen[k] {
			continue
		}
		seen[k] = true
		if e.event == "project.updated" {
			projects[[2]string{e.workspace, e.project}] = true
			continue
		}
		sv.Broadcast(context.Background(), e.workspace, e.project, e.event, e.data)
		if e.project != "" && (e.event == "task.created" || e.event == "task.moved" || e.event == "task.deleted") {
			projects[[2]string{e.workspace, e.project}] = true // progress changed
		}
	}
	for p := range projects {
		sv.BroadcastProject(context.Background(), p[0], p[1])
	}
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

// eventFor maps an activity action to the realtime event a board listens for ("" = none).
func eventFor(action string) string {
	switch action {
	case "task.created":
		return "task.created"
	case "task.moved":
		return "task.moved"
	case "task.deleted":
		return "task.deleted"
	case "task.updated", "task.assigned", "task.unassigned", "task.labels_set", "checklist.added", "checklist.removed", "checklist.toggled":
		return "task.updated"
	case "comment.added", "comment.edited", "comment.deleted":
		return "task.commented"
	case "project.created", "project.updated", "project.archived", "project.unarchived",
		"project.member_added", "project.member_removed", "project.labels_set":
		return "project.updated"
	}
	return ""
}

// userParam is the one placeholder fullAccessSQL is given below; it's then pointed at the
// member row, so one query decides for every member at once instead of one query per member.
var userParam = regexp.MustCompile(`\$3\b`)

// recipientsSQL: the members who get a project's events. $1 workspace, $2 project ("" = none).
var recipientsSQL = `
	SELECT m.user_id FROM workspace_members m
	WHERE m.workspace_id = $1 AND m.status = 'active' AND (
		m.role IN ('owner', 'admin', 'manager')
		OR (m.role = 'member' AND ($2 = '' OR EXISTS (
			SELECT 1 FROM projects p WHERE p.workspace_id = $1 AND p.id = $2 AND ` +
	userParam.ReplaceAllString(fullAccessSQL(3), "m.user_id") + `))))`

// Broadcast sends event to everyone who may see project (see the rule at the top). Best effort:
// realtime is a hint, and a failure here must never fail the change that caused it.
func (sv *Service) Broadcast(ctx context.Context, workspace, project, event string, data map[string]any) {
	sv.broadcast(ctx, workspace, project, event, data)
}

// broadcast is Broadcast, returning who it went to.
func (sv *Service) broadcast(ctx context.Context, workspace, project, event string, data map[string]any) []string {
	if sv.Live == nil || sv.Sys == nil || workspace == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	rows, err := sv.Sys.QueryContext(ctx, recipientsSQL, workspace, project)
	if err != nil {
		if sv.Log != nil {
			sv.Log.Warn("realtime: recipients", "event", event, "err", err)
		}
		return nil
	}
	var users []string
	for rows.Next() {
		var u string
		if rows.Scan(&u) == nil {
			users = append(users, u)
		}
	}
	rows.Close()
	if data == nil {
		data = map[string]any{}
	}
	if project != "" {
		data["project_id"] = project
	}
	for _, u := range users {
		sv.Live.Publish(workspace, u, event, data)
	}
	return users
}

// BroadcastProject announces project.updated with its progress.
func (sv *Service) BroadcastProject(ctx context.Context, workspace, project string) {
	if sv.Live == nil || sv.Sys == nil || project == "" {
		return
	}
	var total, done int
	// "Done" by the task's column, the same as the projects list counts it (countBy).
	_ = sv.Sys.QueryRowContext(ctx, `
		SELECT count(*), count(*) FILTER (WHERE st.category = 'done')
		FROM tasks t JOIN task_statuses st ON st.workspace_id = t.workspace_id AND st.id = t.status_id
		WHERE t.workspace_id = $1 AND t.project_id = $2`, workspace, project).Scan(&total, &done)
	users := sv.broadcast(ctx, workspace, project, "project.updated", map[string]any{"tasks_total": total, "tasks_done": done})
	// MH-355: the home-screen widgets draw progress; tell the phones to reload (throttled).
	sv.Push.WidgetsChanged(users)
}
