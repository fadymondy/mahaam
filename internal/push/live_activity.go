package push

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Remote updates for the phone's glanceable surfaces (MH-355).

Live Activities. The running timer on the lock screen and in the Dynamic Island has to follow the
timer wherever it is started or stopped: the web, the desktop tray, an agent over MCP. The app
registers two kinds of token per device (live_activity_tokens):

	update  the token of the activity it is showing now
	start   its push-to-start token (iOS 17.2+), so the server can start one the phone didn't

On timer.started the server updates the running activity if there is one, else starts one with the
push-to-start token. On timer.stopped it ends it. Both travel through FCM, which relays Live
Activity pushes to APNs (apns.live_activity_token), so this needs no credential beyond MH-352's.

The content-state is {started_at, label, project, key}: started_at in Unix seconds, because the
activity draws a running clock from it and never needs another push to keep counting.
LIVE_ACTIVITY_ATTRIBUTES_TYPE names the app's ActivityAttributes type (default
TimerActivityAttributes), which a push-to-start must name exactly.

Widgets. A content-available push tells the app to reload its widget timelines when a project's
progress changes. iOS rations background pushes, so this is throttled per person: at most one every
WidgetRefreshEvery. The widgets read GET /api/w/widgets/projects when they do reload.
*/

// TimerState is what the lock screen shows for a running timer.
type TimerState struct {
	StartedAt time.Time
	Label     string // what's being worked on: the description, else the task's title
	Project   string
	Key       string // the task key, e.g. MH-12
}

// WidgetRefreshEvery is the throttle on widget pushes per person.
const WidgetRefreshEvery = 10 * time.Minute

var errNoDevice = errors.New("no such device")

// SaveLiveActivityToken stores one of the app's Live Activity tokens for the device registered
// with deviceToken, which must be user's.
func (s *Service) SaveLiveActivityToken(ctx context.Context, user, deviceToken, kind, tokenType, token string) error {
	var deviceID string
	if err := s.DB.QueryRowContext(ctx, `SELECT id FROM devices WHERE push_token = $1 AND user_id = $2`, deviceToken, user).Scan(&deviceID); err != nil {
		return errNoDevice
	}
	_, err := s.DB.ExecContext(ctx, `
		INSERT INTO live_activity_tokens (device_id, user_id, kind, token_type, token) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (device_id, kind, token_type) DO UPDATE SET token = EXCLUDED.token, updated_at = now()`,
		deviceID, user, kind, tokenType, token)
	return err
}

// ForgetLiveActivity drops the device's running-activity token (the activity ended on the phone).
func (s *Service) ForgetLiveActivity(ctx context.Context, user, deviceToken, kind string) error {
	_, err := s.DB.ExecContext(ctx, `
		DELETE FROM live_activity_tokens t USING devices d
		WHERE t.device_id = d.id AND d.push_token = $1 AND d.user_id = $2 AND t.kind = $3 AND t.token_type = 'update'`,
		deviceToken, user, kind)
	return err
}

// TimerActivity follows a timer change on every phone of user: running != nil after a start,
// nil after a stop. Asynchronous and best effort, like Notify.
//
// Changes are coalesced per person for timerSettle and only the latest is sent. Starting a timer
// while another runs publishes a stop and then a start in the same request, and two independent
// sends could reach the phone in either order, ending the activity that should now be showing.
func (s *Service) TimerActivity(user string, running *TimerState) {
	if s == nil || s.DB == nil || user == "" {
		return
	}
	timerMu.Lock()
	defer timerMu.Unlock()
	timerLatest[user] = running
	if timerScheduled[user] {
		return
	}
	timerScheduled[user] = true
	go func() {
		time.Sleep(timerSettle)
		timerMu.Lock()
		st := timerLatest[user]
		delete(timerLatest, user)
		delete(timerScheduled, user)
		timerMu.Unlock()
		s.timerActivity(user, st)
	}()
}

const timerSettle = 500 * time.Millisecond

var (
	timerMu        sync.Mutex
	timerLatest    = map[string]*TimerState{}
	timerScheduled = map[string]bool{}
)

func (s *Service) timerActivity(user string, running *TimerState) {
	f, err := nativeSender()
	if err != nil || f == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rows, err := s.DB.QueryContext(ctx, `
		SELECT d.push_token, t.token_type, t.token FROM live_activity_tokens t JOIN devices d ON d.id = t.device_id
		WHERE t.user_id = $1 AND t.kind = 'timer' ORDER BY d.push_token, t.token_type DESC`, user)
	if err != nil {
		return
	}
	type tokens struct{ update, start string }
	byDevice := map[string]*tokens{}
	for rows.Next() {
		var dev, typ, tok string
		if rows.Scan(&dev, &typ, &tok) != nil {
			continue
		}
		if byDevice[dev] == nil {
			byDevice[dev] = &tokens{}
		}
		if typ == "update" {
			byDevice[dev].update = tok
		} else {
			byDevice[dev].start = tok
		}
	}
	rows.Close()

	now := time.Now().Unix()
	for dev, t := range byDevice {
		var la, event string
		aps := map[string]any{"timestamp": now}
		switch {
		case running == nil && t.update != "":
			la, event = t.update, "end"
			aps["dismissal-date"] = now // gone from the lock screen straight away
		case running == nil:
			continue // nothing on screen to end
		case t.update != "":
			la, event = t.update, "update"
		case t.start != "":
			la, event = t.start, "start"
			aps["attributes-type"] = activityType()
			aps["attributes"] = map[string]any{"kind": "timer"}
			aps["alert"] = map[string]string{"title": running.Label, "body": running.Project}
		default:
			continue
		}
		aps["event"] = event
		if running != nil {
			aps["content-state"] = map[string]any{
				"started_at": running.StartedAt.Unix(), "label": running.Label, "project": running.Project, "key": running.Key,
			}
		}
		res, err := f.post(ctx, map[string]any{
			"token": dev,
			"apns": map[string]any{
				"live_activity_token": la,
				"headers":             map[string]string{"apns-priority": "10"},
				"payload":             map[string]any{"aps": aps},
			},
		})
		switch {
		case res == sentGone:
			// The activity (or the push-to-start registration) no longer exists on the phone.
			_, _ = s.DB.ExecContext(ctx, `DELETE FROM live_activity_tokens WHERE token = $1`, la)
		case event == "end" && res == sentOK:
			_, _ = s.DB.ExecContext(ctx, `DELETE FROM live_activity_tokens WHERE token = $1`, la)
		case err != nil:
			s.Log.Warn("push: live activity", "event", event, "err", err)
		}
	}
}

func activityType() string {
	if v := strings.TrimSpace(os.Getenv("LIVE_ACTIVITY_ATTRIBUTES_TYPE")); v != "" {
		return v
	}
	return "TimerActivityAttributes"
}

var (
	widgetMu   sync.Mutex
	widgetLast = map[string]time.Time{}
)

// WidgetsChanged asks the phones of users to reload their widgets, at most once per
// WidgetRefreshEvery per person (per API instance; iOS rations these anyway).
func (s *Service) WidgetsChanged(users []string) {
	if s == nil || s.DB == nil || len(users) == 0 {
		return
	}
	now := time.Now()
	var due []string
	widgetMu.Lock()
	for _, u := range users {
		if now.Sub(widgetLast[u]) >= widgetEvery() {
			due = append(due, u)
		}
	}
	widgetMu.Unlock()
	if len(due) > 0 {
		go s.widgetsChanged(due)
	}
}

// claimWidgetSlot reports whether user may be sent a widget push now, and takes the slot if so.
// Only a push that is actually going to a phone takes it: someone with no phone registered yet
// must not have their first real refresh throttled away by changes nobody received.
func claimWidgetSlot(user string) bool {
	widgetMu.Lock()
	defer widgetMu.Unlock()
	now := time.Now()
	if now.Sub(widgetLast[user]) < widgetEvery() {
		return false
	}
	widgetLast[user] = now
	return true
}

func widgetEvery() time.Duration {
	if v, err := strconv.Atoi(os.Getenv("WIDGET_REFRESH_SECONDS")); err == nil && v >= 0 {
		return time.Duration(v) * time.Second
	}
	return WidgetRefreshEvery
}

func (s *Service) widgetsChanged(users []string) {
	f, err := nativeSender()
	if err != nil || f == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rows, err := s.DB.QueryContext(ctx, `SELECT user_id, push_token FROM devices WHERE user_id = ANY($1::text[]) ORDER BY user_id`, users)
	if err != nil {
		return
	}
	var tokens []string
	claimed := map[string]bool{}
	for rows.Next() {
		var u, t string
		if rows.Scan(&u, &t) != nil {
			continue
		}
		if _, seen := claimed[u]; !seen {
			claimed[u] = claimWidgetSlot(u)
		}
		if claimed[u] {
			tokens = append(tokens, t)
		}
	}
	rows.Close()
	for _, t := range tokens {
		res, _ := f.post(ctx, map[string]any{
			"token": t,
			"data":  map[string]string{"kind": "widgets.refresh"},
			// A background push: no banner, no sound. iOS wants priority 5 for these.
			"apns": map[string]any{
				"headers": map[string]string{"apns-push-type": "background", "apns-priority": "5"},
				"payload": map[string]any{"aps": map[string]any{"content-available": 1}},
			},
			"android": map[string]any{"priority": "normal"},
		})
		if res == sentGone {
			_, _ = s.DB.ExecContext(ctx, `DELETE FROM devices WHERE push_token = $1`, t)
		}
	}
}
