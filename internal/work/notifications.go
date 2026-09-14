package work

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fadymondy/managy/internal/tenant"
)

/*
The in-app inbox (plan: "Notifications"): Managy's own notifications table, one person's items
only, read state on the server, new items pushed on the per-user channel (notification.created).

P2 writes two kinds, from the reminder jobs below (run by the togo scheduler, internal/server):

	timer.long_running  a timer running longer than the workspace's reminder_running_hours
	time.missing_day    no time by 18:00 local on a workday, for people who track time

Email delivery is not wired yet (togo mail/notifications, P5): the rows are in-app only.
*/

// Notification is one inbox item.
type Notification struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind" doc:"timer.long_running or time.missing_day"`
	Title     string         `json:"title" doc:"Fallback text in the workspace language; the UI renders kind + data"`
	Body      *string        `json:"body"`
	URL       *string        `json:"url" doc:"Workspace-relative path, e.g. /w/acme/time"`
	Data      map[string]any `json:"data"`
	ReadAt    *time.Time     `json:"read_at"`
	CreatedAt time.Time      `json:"created_at"`
}

// Inbox is the caller's latest notifications and their unread count.
type Inbox struct {
	Notifications []Notification `json:"notifications"`
	Unread        int            `json:"unread"`
}

const noteCols = `id, kind, title, body, url, data, read_at, created_at`

func scanNote(r scanner) (*Notification, error) {
	n := &Notification{}
	var raw string
	if err := r.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.URL, &raw, &n.ReadAt, &n.CreatedAt); err != nil {
		return nil, err
	}
	n.Data = map[string]any{}
	_ = json.Unmarshal([]byte(raw), &n.Data)
	return n, nil
}

// Inbox lists the caller's own notifications, newest first.
func (sv *Service) Inbox(ctx context.Context, limit int) (*Inbox, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+noteCols+` FROM notifications WHERE workspace_id = $1 AND user_id = $2
		ORDER BY created_at DESC, id DESC LIMIT $3`, s.WorkspaceID, s.UserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &Inbox{Notifications: []Notification{}}
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		out.Notifications = append(out.Notifications, *n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	err = sv.DB.QueryRowContext(ctx, `SELECT count(*) FROM notifications WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL`,
		s.WorkspaceID, s.UserID).Scan(&out.Unread)
	return out, err
}

// ReadNotification marks one of the caller's notifications read.
func (sv *Service) ReadNotification(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	res, err := sv.DB.ExecContext(ctx, `UPDATE notifications SET read_at = coalesce(read_at, now()), updated_at = now()
		WHERE workspace_id = $1 AND user_id = $2 AND id = $3`, s.WorkspaceID, s.UserID, strings.TrimSpace(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return notFound("notification")
	}
	sv.publish(s.WorkspaceID, s.UserID, "notification.read", map[string]any{"id": strings.TrimSpace(id)})
	return nil
}

// ReadAllNotifications marks every unread notification of the caller read.
func (sv *Service) ReadAllNotifications(ctx context.Context) (int, error) {
	s, err := caller(ctx)
	if err != nil {
		return 0, err
	}
	res, err := sv.DB.ExecContext(ctx, `UPDATE notifications SET read_at = now(), updated_at = now()
		WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL`, s.WorkspaceID, s.UserID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	sv.publish(s.WorkspaceID, s.UserID, "notification.read", map[string]any{"all": true})
	return int(n), nil
}

type newNote struct {
	Kind, Title, Body, URL, Dedupe string
	Data                           map[string]any
}

// notify inserts a notification, or nothing when (user, kind, dedupe key) was already sent — so a
// job that runs every five minutes sends each reminder once. Returns nil when it was a duplicate.
func notify(ctx context.Context, q querier, ws, user string, n newNote) (*Notification, error) {
	data, err := json.Marshal(n.Data)
	if err != nil {
		return nil, err
	}
	nt, err := scanNote(q.QueryRowContext(ctx, `INSERT INTO notifications (workspace_id, user_id, kind, title, body, url, data, dedupe_key)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, NULLIF($8, ''))
		ON CONFLICT (workspace_id, user_id, kind, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
		RETURNING `+noteCols, ws, user, n.Kind, n.Title, n.Body, n.URL, string(data), n.Dedupe))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return nt, err
}

// ---- reminder jobs ------------------------------------------------------------------------------------

// Fallback text in the workspace language; the UI renders its own from kind + data.
var reminderText = map[string][4]string{
	"en": {"Your timer has been running for %d hours", "Still on it? Stop it, or fix the entry in your timesheet.",
		"No time logged today", "It's past 18:00 on %s and your timesheet for today is empty."},
	"ar": {"مؤقّتك يعمل منذ %d ساعة", "هل ما زلت تعمل؟ أوقفه، أو صحّح الإدخال في سجلّ دوامك.",
		"لم تسجّل أي وقت اليوم", "تجاوزت الساعة 18:00 يوم %s وسجلّ دوامك لليوم فارغ."},
}

func textFor(locale string) [4]string {
	if t, ok := reminderText[locale]; ok {
		return t
	}
	return reminderText["en"]
}

type reminderWS struct {
	ID, Slug, Timezone, Locale string
	WeekStart, Hours           int
	Daily                      bool
}

// reminderWorkspaces reads every workspace on the OWNER pool: "which workspaces exist" is
// cross-tenant by definition. Everything after runs on the RLS pool, one workspace at a time.
func (sv *Service) reminderWorkspaces(ctx context.Context) ([]reminderWS, error) {
	if sv.Sys == nil || sv.DB == nil {
		return nil, errors.New("work: database unavailable")
	}
	rows, err := sv.Sys.QueryContext(ctx, `SELECT id, slug, timezone, locale, week_start, reminder_running_hours, reminder_daily FROM workspaces`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []reminderWS
	for rows.Next() {
		var w reminderWS
		var week, hours int64
		if err := rows.Scan(&w.ID, &w.Slug, &w.Timezone, &w.Locale, &week, &hours, &w.Daily); err != nil {
			return nil, err
		}
		w.WeekStart, w.Hours = int(week), int(hours)
		out = append(out, w)
	}
	return out, rows.Err()
}

// Workday: the five days from the workspace's week start (Mon start: Mon–Fri; Sun: Sun–Thu; Sat: Sat–Wed).
func workday(d time.Weekday, weekStart int) bool { return (int(d)-weekStart+7)%7 < 5 }

// RemindLongRunning notifies the owner of every timer running longer than its workspace's
// reminder_running_hours — once per entry. It returns how many notifications it created.
func (sv *Service) RemindLongRunning(ctx context.Context, now time.Time) (int, error) {
	list, err := sv.reminderWorkspaces(ctx)
	if err != nil {
		return 0, err
	}
	created := 0
	for _, w := range list {
		wctx := tenant.WithWorkspace(ctx, w.ID)
		rows, err := sv.DB.QueryContext(wctx, `SELECT id, user_id, started_at FROM time_entries
			WHERE workspace_id = $1 AND ended_at IS NULL AND started_at <= $2`, w.ID, now.Add(-time.Duration(w.Hours)*time.Hour))
		if err != nil {
			return created, err
		}
		type running struct {
			id, user string
			started  time.Time
		}
		var due []running
		for rows.Next() {
			var r running
			if err := rows.Scan(&r.id, &r.user, &r.started); err != nil {
				rows.Close()
				return created, err
			}
			due = append(due, r)
		}
		rows.Close()
		txt := textFor(w.Locale)
		for _, r := range due {
			hours := int(now.Sub(r.started) / time.Hour)
			nt, err := notify(wctx, sv.DB, w.ID, r.user, newNote{Kind: "timer.long_running", Title: fmt.Sprintf(txt[0], hours),
				Body: txt[1], URL: "/w/" + w.Slug + "/time", Dedupe: "entry:" + r.id,
				Data: map[string]any{"entry_id": r.id, "hours": hours, "started_at": r.started.UTC().Format(time.RFC3339)}})
			if err != nil {
				return created, err
			}
			if nt != nil {
				created++
				sv.publish(w.ID, r.user, "notification.created", nt)
			}
		}
	}
	return created, nil
}

// RemindMissingTime notifies, after 18:00 local on a workday, every active non-client member who
// tracks time here (an entry in the last 30 days) and has none today — once per person per day.
func (sv *Service) RemindMissingTime(ctx context.Context, now time.Time) (int, error) {
	list, err := sv.reminderWorkspaces(ctx)
	if err != nil {
		return 0, err
	}
	created := 0
	for _, w := range list {
		if !w.Daily {
			continue
		}
		loc := loadLocation(w.Timezone)
		local := now.In(loc)
		if local.Hour() < 18 || !workday(local.Weekday(), w.WeekStart) {
			continue
		}
		dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
		day := dayStart.Format("2006-01-02")
		wctx := tenant.WithWorkspace(ctx, w.ID)
		rows, err := sv.DB.QueryContext(wctx, `SELECT m.user_id FROM workspace_members m
			WHERE m.workspace_id = $1 AND m.status = 'active' AND m.role <> 'client'
			  AND EXISTS (SELECT 1 FROM time_entries h WHERE h.workspace_id = m.workspace_id AND h.user_id = m.user_id AND h.started_at > $4)
			  AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.workspace_id = m.workspace_id AND e.user_id = m.user_id
			      AND e.started_at < $3 AND (e.ended_at IS NULL OR e.ended_at > $2))`,
			w.ID, dayStart.UTC(), now.UTC(), dayStart.AddDate(0, 0, -30).UTC())
		if err != nil {
			return created, err
		}
		var people []string
		for rows.Next() {
			var u string
			if err := rows.Scan(&u); err != nil {
				rows.Close()
				return created, err
			}
			people = append(people, u)
		}
		rows.Close()
		txt := textFor(w.Locale)
		for _, u := range people {
			nt, err := notify(wctx, sv.DB, w.ID, u, newNote{Kind: "time.missing_day", Title: txt[2], Body: fmt.Sprintf(txt[3], day),
				URL: "/w/" + w.Slug + "/time", Dedupe: "day:" + day, Data: map[string]any{"date": day}})
			if err != nil {
				return created, err
			}
			if nt != nil {
				created++
				sv.publish(w.ID, u, "notification.created", nt)
			}
		}
	}
	return created, nil
}
