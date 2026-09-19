package work

import (
	"context"
	"errors"
	"fmt"
	"html"
	"os"
	"strings"
	"time"

	"github.com/togo-framework/mail"

	"github.com/fadymondy/mahaam/internal/mailer"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Notification settings, email delivery and the daily digest (P5), through togo mail.

	settings  one row per person per workspace (notification_prefs); no row = the defaults
	delivery  every minute, each inbox item not yet processed (notifications.email_status IS NULL)
	          is mailed to its owner when their email is on, else marked skipped — once, whatever the
	          outcome (sent | skipped | failed); a failure is logged, not retried
	digest    every five minutes, a person with the digest on gets one summary a day at or after
	          digest_hour local: unread notifications of the last day and yesterday's tracked time.
	          last_digest_on is claimed BEFORE sending, so two runs never both send; an empty digest
	          is not sent

The driver comes from MAIL_DRIVER: smtp delivers; log and file (internal/mailer) do not, and the
settings page then says email is not configured instead of showing switches that do nothing. The
jobs run with every driver, so the file driver shows exactly what would have been sent.
*/

// NotificationKinds are the kinds a person can mute.
var NotificationKinds = []string{"task.assigned", "task.mentioned", "task.done", "budget.threshold", "timer.long_running", "time.missing_day"}

// EmailStatus says whether email is really delivered.
type EmailStatus struct {
	Configured bool   `json:"configured" doc:"false with the log or file driver: nothing leaves the server"`
	Driver     string `json:"driver"`
}

// NotificationSettings is one person's settings in the workspace.
type NotificationSettings struct {
	EmailEnabled  bool        `json:"email_enabled"`
	DigestEnabled bool        `json:"digest_enabled"`
	DigestHour    int         `json:"digest_hour" doc:"0–23, workspace timezone"`
	MutedKinds    []string    `json:"muted_kinds"`
	Kinds         []string    `json:"kinds" doc:"Every kind that can be muted"`
	Timezone      string      `json:"timezone"`
	Email         EmailStatus `json:"email"`
	Address       string      `json:"address" doc:"Where email goes (your sign-in address)"`
}

// NotificationSettingsInput changes them; absent fields stay.
type NotificationSettingsInput struct {
	EmailEnabled  *bool     `json:"email_enabled,omitempty"`
	DigestEnabled *bool     `json:"digest_enabled,omitempty"`
	DigestHour    *int      `json:"digest_hour,omitempty" minimum:"0" maximum:"23"`
	MutedKinds    *[]string `json:"muted_kinds,omitempty"`
}

func (sv *Service) emailStatus() EmailStatus {
	if sv.Mail == nil {
		return EmailStatus{Driver: "none"}
	}
	return EmailStatus{Configured: mailer.Delivers(sv.Mail.Driver()), Driver: sv.Mail.Driver()}
}

func splitKinds(s string) []string {
	out := []string{}
	for _, k := range strings.Split(s, ",") {
		if k = strings.TrimSpace(k); k != "" {
			out = append(out, k)
		}
	}
	return out
}

func (sv *Service) prefs(ctx context.Context, q querier, ws, user string) (email, digest bool, hour int, mutedKinds []string, err error) {
	var h int64
	var m string
	err = q.QueryRowContext(ctx, `SELECT email_enabled, digest_enabled, digest_hour, muted_kinds FROM notification_prefs
		WHERE workspace_id = $1 AND user_id = $2`, ws, user).Scan(&email, &digest, &h, &m)
	if err != nil {
		if _, ok := AsError(err); ok { // no row: the defaults
			return true, true, 8, []string{}, nil
		}
		return
	}
	return email, digest, int(h), splitKinds(m), nil
}

// GetNotificationSettings returns the caller's settings.
func (sv *Service) GetNotificationSettings(ctx context.Context) (*NotificationSettings, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	email, digest, hour, mutedKinds, err := sv.prefs(ctx, sv.DB, s.WorkspaceID, s.UserID)
	if err != nil {
		return nil, err
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	return &NotificationSettings{EmailEnabled: email, DigestEnabled: digest, DigestHour: hour, MutedKinds: mutedKinds,
		Kinds: NotificationKinds, Timezone: conf.Timezone, Email: sv.emailStatus(), Address: s.Email}, nil
}

// UpdateNotificationSettings changes the caller's settings. Email switches cannot be changed while
// email is not configured (they would do nothing).
func (sv *Service) UpdateNotificationSettings(ctx context.Context, in NotificationSettingsInput) (*NotificationSettings, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if (in.EmailEnabled != nil || in.DigestEnabled != nil || in.DigestHour != nil) && !sv.emailStatus().Configured {
		return nil, conflict("email is not configured on this server, so email settings cannot be changed")
	}
	email, digest, hour, mutedKinds, err := sv.prefs(ctx, sv.DB, s.WorkspaceID, s.UserID)
	if err != nil {
		return nil, err
	}
	if in.EmailEnabled != nil {
		email = *in.EmailEnabled
	}
	if in.DigestEnabled != nil {
		digest = *in.DigestEnabled
	}
	if in.DigestHour != nil {
		if *in.DigestHour < 0 || *in.DigestHour > 23 {
			return nil, invalid("digest_hour is 0–23")
		}
		hour = *in.DigestHour
	}
	if in.MutedKinds != nil {
		mutedKinds = []string{}
		for _, k := range dedupe(*in.MutedKinds) {
			if err := oneOf("muted kind", k, NotificationKinds...); err != nil {
				return nil, err
			}
			mutedKinds = append(mutedKinds, k)
		}
	}
	if _, err := sv.DB.ExecContext(ctx, `INSERT INTO notification_prefs (workspace_id, user_id, email_enabled, digest_enabled, digest_hour, muted_kinds)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, digest_enabled = EXCLUDED.digest_enabled,
			digest_hour = EXCLUDED.digest_hour, muted_kinds = EXCLUDED.muted_kinds, updated_at = now()`,
		s.WorkspaceID, s.UserID, email, digest, hour, strings.Join(mutedKinds, ",")); err != nil {
		return nil, err
	}
	return sv.GetNotificationSettings(ctx)
}

// ---- delivery ----------------------------------------------------------------------------------------

type mailWS struct {
	ID, Slug, Name, Timezone, Locale string
}

func (sv *Service) mailWorkspaces(ctx context.Context) ([]mailWS, error) {
	if sv.Sys == nil || sv.DB == nil {
		return nil, errors.New("work: database unavailable")
	}
	rows, err := sv.Sys.QueryContext(ctx, `SELECT id, slug, name, timezone, locale FROM workspaces`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mailWS
	for rows.Next() {
		var w mailWS
		if err := rows.Scan(&w.ID, &w.Slug, &w.Name, &w.Timezone, &w.Locale); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// userEmail reads a user's address (owner pool: the app role cannot read users).
func (sv *Service) userEmail(ctx context.Context, user string) string {
	var e string
	_ = sv.Sys.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, user).Scan(&e)
	return e
}

func appURL() string {
	for _, k := range []string{"WEB_URL", "APP_PUBLIC_URL"} {
		if v := strings.TrimRight(os.Getenv(k), "/"); v != "" {
			return v
		}
	}
	return "http://localhost:3010"
}

func link(locale, path string) string {
	if path == "" {
		return ""
	}
	if locale != "ar" {
		locale = "en"
	}
	return appURL() + "/" + locale + path
}

var mailText = map[string]map[string]string{
	"en": {"open": "Open in Mahaam", "settings": "You get this because email notifications are on. Change it in Mahaam → Settings → Notifications.",
		"digest": "Your Mahaam summary for %s", "unread": "Unread notifications", "yesterday": "Tracked yesterday", "running": "A timer is running"},
	"ar": {"open": "افتح في مهام", "settings": "تصلك هذه الرسالة لأن إشعارات البريد مفعّلة. غيّر ذلك من مهام ← الإعدادات ← الإشعارات.",
		"digest": "ملخّص مهام الخاص بك في %s", "unread": "إشعارات غير مقروءة", "yesterday": "الوقت المسجّل أمس", "running": "هناك مؤقّت يعمل"},
}

func mailWords(locale string) map[string]string {
	if t, ok := mailText[locale]; ok {
		return t
	}
	return mailText["en"]
}

func htmlPage(locale, body string) string {
	dir := "ltr"
	if locale == "ar" {
		dir = "rtl"
	}
	return `<!doctype html><html lang="` + locale + `" dir="` + dir + `"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">` +
		body + `</body></html>`
}

// DeliverEmails mails every unprocessed inbox item once. Returns how many were sent.
func (sv *Service) DeliverEmails(ctx context.Context) (int, error) {
	if sv.Mail == nil {
		return 0, nil
	}
	list, err := sv.mailWorkspaces(ctx)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, w := range list {
		wctx := tenant.WithWorkspace(ctx, w.ID)
		rows, err := sv.DB.QueryContext(wctx, `SELECT id, user_id, kind, title, coalesce(body, ''), coalesce(url, '') FROM notifications
			WHERE workspace_id = $1 AND email_status IS NULL ORDER BY created_at LIMIT 200`, w.ID)
		if err != nil {
			return sent, err
		}
		type item struct{ id, user, kind, title, body, url string }
		var items []item
		for rows.Next() {
			var it item
			if err := rows.Scan(&it.id, &it.user, &it.kind, &it.title, &it.body, &it.url); err != nil {
				rows.Close()
				return sent, err
			}
			items = append(items, it)
		}
		rows.Close()
		words := mailWords(w.Locale)
		for _, it := range items {
			// Claim the item first: a second run (or instance) finds nothing to send.
			res, err := sv.DB.ExecContext(wctx, `UPDATE notifications SET email_status = 'skipped', updated_at = now()
				WHERE workspace_id = $1 AND id = $2 AND email_status IS NULL`, w.ID, it.id)
			if err != nil {
				return sent, err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				continue
			}
			on, _, _, _, err := sv.prefs(wctx, sv.DB, w.ID, it.user)
			if err != nil || !on {
				continue
			}
			to := sv.userEmail(ctx, it.user)
			if to == "" {
				continue
			}
			href := link(w.Locale, it.url)
			text := it.title + "\n"
			if it.body != "" {
				text += "\n" + it.body + "\n"
			}
			htmlBody := "<p><strong>" + html.EscapeString(it.title) + "</strong></p>"
			if it.body != "" {
				htmlBody += "<p>" + html.EscapeString(it.body) + "</p>"
			}
			if href != "" {
				text += "\n" + words["open"] + ": " + href + "\n"
				htmlBody += `<p><a href="` + html.EscapeString(href) + `">` + html.EscapeString(words["open"]) + `</a></p>`
			}
			text += "\n— " + w.Name + "\n" + words["settings"] + "\n"
			htmlBody += `<p style="color:#666;font-size:12px">` + html.EscapeString(w.Name) + " · " + html.EscapeString(words["settings"]) + `</p>`
			status := "sent"
			if err := sv.Mail.Send(ctx, mail.Message{To: []string{to}, Subject: "[" + w.Name + "] " + it.title, Text: text,
				HTML: htmlPage(w.Locale, htmlBody)}); err != nil {
				status = "failed"
				if sv.Log != nil {
					sv.Log.Error("notification email", "notification", it.id, "err", err)
				}
			} else {
				sent++
			}
			if _, err := sv.DB.ExecContext(wctx, `UPDATE notifications SET email_status = $3, emailed_at = now(), updated_at = now()
				WHERE workspace_id = $1 AND id = $2`, w.ID, it.id, status); err != nil {
				return sent, err
			}
		}
	}
	return sent, nil
}

// SendDigests sends the daily summaries that are due at now. Returns how many were sent.
func (sv *Service) SendDigests(ctx context.Context, now time.Time) (int, error) {
	if sv.Mail == nil {
		return 0, nil
	}
	list, err := sv.mailWorkspaces(ctx)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, w := range list {
		loc := loadLocation(w.Timezone)
		local := now.In(loc)
		today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
		day := today.Format("2006-01-02")
		wctx := tenant.WithWorkspace(ctx, w.ID)
		// Everyone active whose digest is on (no settings row = on, at 08:00) and due today.
		rows, err := sv.DB.QueryContext(wctx, `SELECT m.user_id FROM workspace_members m
			LEFT JOIN notification_prefs np ON np.workspace_id = m.workspace_id AND np.user_id = m.user_id
			WHERE m.workspace_id = $1 AND m.status = 'active'
			  AND coalesce(np.digest_enabled, true) AND coalesce(np.email_enabled, true)
			  AND coalesce(np.digest_hour, 8) <= $2
			  AND (np.last_digest_on IS NULL OR np.last_digest_on < $3::date)`, w.ID, local.Hour(), day)
		if err != nil {
			return sent, err
		}
		var people []string
		for rows.Next() {
			var u string
			if err := rows.Scan(&u); err != nil {
				rows.Close()
				return sent, err
			}
			people = append(people, u)
		}
		rows.Close()
		words := mailWords(w.Locale)
		for _, u := range people {
			// Claim today's digest first (insert the settings row with the defaults if there is none).
			res, err := sv.DB.ExecContext(wctx, `INSERT INTO notification_prefs (workspace_id, user_id, last_digest_on) VALUES ($1, $2, $3::date)
				ON CONFLICT (workspace_id, user_id) DO UPDATE SET last_digest_on = EXCLUDED.last_digest_on, updated_at = now()
				WHERE notification_prefs.last_digest_on IS NULL OR notification_prefs.last_digest_on < EXCLUDED.last_digest_on`, w.ID, u, day)
			if err != nil {
				return sent, err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				continue
			}
			// Unread notifications of the last 24 hours.
			nrows, err := sv.DB.QueryContext(wctx, `SELECT title, coalesce(url, '') FROM notifications WHERE workspace_id = $1 AND user_id = $2
				AND read_at IS NULL AND created_at > $3 ORDER BY created_at DESC LIMIT 20`, w.ID, u, now.Add(-24*time.Hour))
			if err != nil {
				return sent, err
			}
			type line struct{ title, url string }
			var unread []line
			for nrows.Next() {
				var l line
				if err := nrows.Scan(&l.title, &l.url); err != nil {
					nrows.Close()
					return sent, err
				}
				unread = append(unread, l)
			}
			nrows.Close()
			// Yesterday's tracked time (local day, cut at midnight).
			yStart := today.AddDate(0, 0, -1)
			var yesterday int64
			erows, err := sv.DB.QueryContext(wctx, `SELECT started_at, coalesce(ended_at, $4) FROM time_entries WHERE workspace_id = $1 AND user_id = $2
				AND started_at < $3 AND (ended_at IS NULL OR ended_at > $5)`, w.ID, u, today.UTC(), now.UTC(), yStart.UTC())
			if err != nil {
				return sent, err
			}
			running := false
			for erows.Next() {
				var a, b time.Time
				if err := erows.Scan(&a, &b); err != nil {
					erows.Close()
					return sent, err
				}
				for _, sl := range SplitByDay(a, b, loc) {
					if sl.Day == yStart.Format("2006-01-02") {
						yesterday += sl.Seconds
					}
				}
			}
			erows.Close()
			_ = sv.DB.QueryRowContext(wctx, `SELECT EXISTS (SELECT 1 FROM time_entries WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NULL)`,
				w.ID, u).Scan(&running)
			if len(unread) == 0 && yesterday == 0 && !running {
				continue // nothing to say
			}
			to := sv.userEmail(ctx, u)
			if to == "" {
				continue
			}
			subject := fmt.Sprintf(words["digest"], day)
			var text, body strings.Builder
			fmt.Fprintf(&text, "%s — %s\n\n%s: %s\n", w.Name, subject, words["yesterday"], hm(yesterday))
			fmt.Fprintf(&body, "<h2>%s</h2><p>%s: <strong dir=\"ltr\">%s</strong></p>", html.EscapeString(subject), html.EscapeString(words["yesterday"]), hm(yesterday))
			if running {
				fmt.Fprintf(&text, "%s\n", words["running"])
				fmt.Fprintf(&body, "<p>%s</p>", html.EscapeString(words["running"]))
			}
			if len(unread) > 0 {
				fmt.Fprintf(&text, "\n%s (%d):\n", words["unread"], len(unread))
				fmt.Fprintf(&body, "<h3>%s (%d)</h3><ul>", html.EscapeString(words["unread"]), len(unread))
				for _, l := range unread {
					href := link(w.Locale, l.url)
					fmt.Fprintf(&text, "- %s %s\n", l.title, href)
					fmt.Fprintf(&body, `<li><a href="%s">%s</a></li>`, html.EscapeString(href), html.EscapeString(l.title))
				}
				body.WriteString("</ul>")
			}
			fmt.Fprintf(&text, "\n%s\n%s\n", link(w.Locale, "/w/"+w.Slug), words["settings"])
			fmt.Fprintf(&body, `<p style="color:#666;font-size:12px">%s</p>`, html.EscapeString(words["settings"]))
			if err := sv.Mail.Send(ctx, mail.Message{To: []string{to}, Subject: "[" + w.Name + "] " + subject,
				Text: text.String(), HTML: htmlPage(w.Locale, body.String())}); err != nil {
				if sv.Log != nil {
					sv.Log.Error("digest email", "user", u, "err", err)
				}
				continue
			}
			sent++
		}
	}
	return sent, nil
}

// hm formats seconds as h:mm.
func hm(sec int64) string { return fmt.Sprintf("%d:%02d", sec/3600, sec%3600/60) }
