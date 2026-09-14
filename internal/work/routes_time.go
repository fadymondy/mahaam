package work

import (
	"context"
	"net/http"
)

/*
P2 REST: /api/w/time/*, /api/w/rates, /api/w/member-rates, /api/w/notifications. Every path is
under /api/w/, so the guard puts it in the workspace tier (session + active membership of
X-Workspace-ID, 404 otherwise); the checks (own time vs time:manage, rates:read/manage, locks)
are in the domain functions, shared with the MCP time tools.

The realtime stream, GET /api/w/events, is not a Huma operation (it streams); internal/server
mounts Events() on the router behind the same guard.
*/

type (
	EntryRef struct {
		Entry string `path:"entry" doc:"Time entry id"`
	}
	RateRef struct {
		Rate string `path:"rate" doc:"Member rate id"`
	}
	NotificationRef struct {
		Notification string `path:"notification"`
	}
)

// EntryList is the body of GET /api/w/time/entries.
type EntryList struct {
	Entries []TimeEntry `json:"entries"`
}

// Running is the body of GET /api/w/time/running.
type Running struct {
	Timer *TimeEntry `json:"timer" doc:"null when no timer is running"`
}

func (r routes) time() {
	const tag = "Time"
	do(r, http.MethodGet, "/api/w/time/running", "w-running-timer", "The running timer (yours; ?user= needs time:manage)", tag, 0, func(ctx context.Context, in *struct {
		WS
		User string `query:"user" doc:"A member's user id (time:manage)"`
	}) (Running, error) {
		e, err := r.sv.RunningTimer(ctx, in.User)
		return Running{Timer: e}, err
	})
	do(r, http.MethodPost, "/api/w/time/start", "w-start-timer", "Start a timer — the running one stops in the same transaction", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		Body StartInput
	}) (*TimerChange, error) {
		return r.sv.StartTimer(ctx, in.Body)
	})
	do(r, http.MethodPost, "/api/w/time/stop", "w-stop-timer", "Stop the running timer (yours, or a member's with time:manage)", tag, 0, func(ctx context.Context, in *struct {
		WS
		Body struct {
			User string `json:"user,omitempty" doc:"A member's user id (time:manage); default you"`
		}
	}) (*TimeEntry, error) {
		return r.sv.StopTimer(ctx, in.Body.User)
	})
	do(r, http.MethodGet, "/api/w/time/entries", "w-list-time-entries", "Time entries overlapping a date range, newest first", tag, 0, func(ctx context.Context, in *struct {
		WS
		User    string `query:"user" doc:"A member's user id, or * for everyone (time:manage); default you"`
		From    string `query:"from" doc:"YYYY-MM-DD, workspace timezone (default: 6 days before to)"`
		To      string `query:"to" doc:"YYYY-MM-DD, workspace timezone (default: today)"`
		Project string `query:"project" doc:"Project id or exact name"`
		Limit   int    `query:"limit" minimum:"0" maximum:"1000"`
	}) (EntryList, error) {
		list, err := r.sv.ListTimeEntries(ctx, EntryFilter{User: in.User, From: in.From, To: in.To, ProjectID: in.Project, Limit: in.Limit})
		return EntryList{Entries: list}, err
	})
	do(r, http.MethodPost, "/api/w/time/entries", "w-log-time", "Log a finished block of time", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		Body LogInput
	}) (*TimeEntry, error) {
		return r.sv.LogTime(ctx, in.Body)
	})
	do(r, http.MethodGet, "/api/w/time/entries/{entry}", "w-get-time-entry", "One time entry (yours, or anyone's with time:manage)", tag, 0, func(ctx context.Context, in *struct {
		WS
		EntryRef
	}) (*TimeEntry, error) {
		return r.sv.GetTimeEntry(ctx, in.Entry)
	})
	do(r, http.MethodPatch, "/api/w/time/entries/{entry}", "w-update-time-entry", "Change a time entry (locked or invoiced entries are refused)", tag, 0, func(ctx context.Context, in *struct {
		WS
		EntryRef
		Body EntryPatch
	}) (*TimeEntry, error) {
		return r.sv.UpdateTimeEntry(ctx, in.Entry, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/time/entries/{entry}", "w-delete-time-entry", "Delete a time entry (locked or invoiced entries are refused)", tag, func(ctx context.Context, in *struct {
		WS
		EntryRef
	}) error {
		return r.sv.DeleteTimeEntry(ctx, in.Entry)
	})
	do(r, http.MethodGet, "/api/w/time/timesheet", "w-timesheet", "A person's week, each entry cut at local midnight", tag, 0, func(ctx context.Context, in *struct {
		WS
		User string `query:"user" doc:"A member's user id (time:manage); default you"`
		Week string `query:"week" doc:"Any YYYY-MM-DD in the week (default: this week)"`
	}) (*Timesheet, error) {
		return r.sv.Timesheet(ctx, in.User, in.Week)
	})
	do(r, http.MethodGet, "/api/w/time/team", "w-team-timesheet", "Everyone's week (time:manage)", tag, 0, func(ctx context.Context, in *struct {
		WS
		Week string `query:"week" doc:"Any YYYY-MM-DD in the week (default: this week)"`
	}) (*TeamTimesheet, error) {
		return r.sv.TeamTimesheet(ctx, in.Week)
	})
	do(r, http.MethodGet, "/api/w/time/settings", "w-time-settings", "The workspace's timezone, week start, rounding, reminders and default rates", tag, 0, func(ctx context.Context, _ *WS) (*TimeSettings, error) {
		return r.sv.GetTimeSettings(ctx)
	})
	do(r, http.MethodPatch, "/api/w/time/settings", "w-update-time-settings", "Change the workspace's time settings (admins)", tag, 0, func(ctx context.Context, in *struct {
		WS
		Body TimeSettingsInput
	}) (*TimeSettings, error) {
		return r.sv.UpdateTimeSettings(ctx, in.Body)
	})

	const rtag = "Rates"
	do(r, http.MethodGet, "/api/w/rates", "w-rates", "Members' effective-dated rates (managers and up)", rtag, 0, func(ctx context.Context, _ *WS) (*RateSheet, error) {
		return r.sv.Rates(ctx)
	})
	do(r, http.MethodPut, "/api/w/rates/{user}", "w-set-member-rate", "Add a member's rate card from a day (admins); existing entries keep their snapshot", rtag, 0, func(ctx context.Context, in *struct {
		WS
		UserRef
		Body RateInput
	}) (*MemberRate, error) {
		return r.sv.SetMemberRate(ctx, in.User, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/member-rates/{rate}", "w-delete-member-rate", "Remove a rate card (admins); existing entries keep their snapshot", rtag, func(ctx context.Context, in *struct {
		WS
		RateRef
	}) error {
		return r.sv.DeleteMemberRate(ctx, in.Rate)
	})
}

func (r routes) notifications() {
	const tag = "Notifications"
	do(r, http.MethodGet, "/api/w/notifications", "w-notifications", "My notifications, newest first, and the unread count", tag, 0, func(ctx context.Context, in *struct {
		WS
		Limited
	}) (*Inbox, error) {
		return r.sv.Inbox(ctx, in.Limit)
	})
	none(r, http.MethodPost, "/api/w/notifications/{notification}/read", "w-read-notification", "Mark one of my notifications read", tag, func(ctx context.Context, in *struct {
		WS
		NotificationRef
	}) error {
		return r.sv.ReadNotification(ctx, in.Notification)
	})
	do(r, http.MethodPost, "/api/w/notifications/read-all", "w-read-all-notifications", "Mark all my notifications read", tag, 0, func(ctx context.Context, _ *WS) (struct {
		Read int `json:"read"`
	}, error) {
		n, err := r.sv.ReadAllNotifications(ctx)
		return struct {
			Read int `json:"read"`
		}{n}, err
	})
}

// Events serves GET /api/w/events: the caller's own realtime stream. The first event is
// timer.state (the running timer or null), so every tab starts from the truth and resyncs on
// reconnect; after that timer.started / timer.stopped / entry.changed / notification.*.
func (sv *Service) Events() http.HandlerFunc {
	if sv.Live == nil {
		return func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "realtime unavailable", http.StatusServiceUnavailable)
		}
	}
	return sv.Live.Handler(func(ctx context.Context) (string, any) {
		e, err := sv.RunningTimer(ctx, "")
		if err != nil {
			return "timer.state", map[string]any{"running": nil}
		}
		return "timer.state", map[string]any{"running": public(e)}
	})
}
