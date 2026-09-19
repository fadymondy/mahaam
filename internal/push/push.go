// Package push delivers Web Push notifications to the installed app (PWA) and to browsers that
// enabled them. It mirrors the in-app inbox: every notification.created event published to the
// realtime hub (work.Service.publish) is also pushed to each of the user's subscribed devices.
//
// Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (generate once with `mahaam-admin vapid`) and
// VAPID_SUBJECT (a mailto: or https: contact, default mailto:info@3x1.io). Without keys push is
// off and GET /api/me/push reports enabled=false, so the UI hides the option.
package push

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type Service struct {
	DB                       *sql.DB // owner pool: push_subscriptions is not tenant data
	Log                      *slog.Logger
	public, private, subject string
}

func New(db *sql.DB, log *slog.Logger) *Service {
	sub := strings.TrimSpace(os.Getenv("VAPID_SUBJECT"))
	if sub == "" {
		sub = "mailto:info@3x1.io"
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		DB: db, Log: log, subject: sub,
		public:  strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY")),
		private: strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY")),
	}
}

// Enabled reports whether VAPID keys are configured and a database is attached.
func (s *Service) Enabled() bool { return s != nil && s.DB != nil && s.public != "" && s.private != "" }

// PushSubscription is the browser's PushSubscription.toJSON().
type PushSubscription struct {
	Endpoint string   `json:"endpoint" minLength:"10" maxLength:"2000"`
	Keys     PushKeys `json:"keys"`
	// Sent by every browser (usually null); Huma rejects unknown fields, so it must be declared.
	ExpirationTime *float64 `json:"expirationTime,omitempty" required:"false"`
}

type PushKeys struct {
	P256dh string `json:"p256dh" minLength:"10" maxLength:"200"`
	Auth   string `json:"auth" minLength:"4" maxLength:"100"`
}

// Save stores (or re-owns) a device subscription for user.
func (s *Service) Save(ctx context.Context, user string, sub PushSubscription, ua, locale string) error {
	if locale != "ar" {
		locale = "en"
	}
	if len(ua) > 300 {
		ua = ua[:300]
	}
	_, err := s.DB.ExecContext(ctx, `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, locale)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
		  auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, locale = EXCLUDED.locale`,
		user, sub.Endpoint, sub.Keys.P256dh, sub.Keys.Auth, ua, locale)
	return err
}

// Remove deletes one of user's subscriptions (only their own).
func (s *Service) Remove(ctx context.Context, user, endpoint string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, user, endpoint)
	return err
}

// Count is how many devices user has subscribed.
func (s *Service) Count(ctx context.Context, user string) int {
	var n int
	_ = s.DB.QueryRowContext(ctx, `SELECT count(*) FROM push_subscriptions WHERE user_id = $1`, user).Scan(&n)
	return n
}

// Message is what the service worker shows (web/public/sw.js reads these fields).
type Message struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
	URL   string `json:"url,omitempty"` // app path, e.g. /w/acme/time
	Tag   string `json:"tag,omitempty"` // collapses repeats of the same thing
}

// Notify pushes m to every device of user. Asynchronous and best-effort: it never blocks or fails
// the request that caused the notification.
func (s *Service) Notify(user string, m Message) {
	if !s.Enabled() || user == "" {
		return
	}
	go s.send(user, m)
}

func (s *Service) send(user string, m Message) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rows, err := s.DB.QueryContext(ctx, `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, user)
	if err != nil {
		return
	}
	var subs []webpush.Subscription
	for rows.Next() {
		var w webpush.Subscription
		if rows.Scan(&w.Endpoint, &w.Keys.P256dh, &w.Keys.Auth) == nil {
			subs = append(subs, w)
		}
	}
	rows.Close()
	payload, _ := json.Marshal(m)
	for i := range subs {
		res, err := webpush.SendNotificationWithContext(ctx, payload, &subs[i], &webpush.Options{
			Subscriber: s.subject, VAPIDPublicKey: s.public, VAPIDPrivateKey: s.private,
			TTL: 86400, Urgency: webpush.UrgencyNormal, Topic: topic(m.Tag),
		})
		if err != nil {
			s.Log.Debug("push: send failed", "err", err)
			continue
		}
		_, _ = io.Copy(io.Discard, res.Body)
		res.Body.Close()
		switch {
		case res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusGone:
			_, _ = s.DB.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, subs[i].Endpoint)
		case res.StatusCode < 300:
			_, _ = s.DB.ExecContext(ctx, `UPDATE push_subscriptions SET last_used_at = now() WHERE endpoint = $1`, subs[i].Endpoint)
		default:
			s.Log.Debug("push: rejected", "status", res.StatusCode)
		}
	}
}

// topic: the Topic header allows at most 32 URL-safe base64 characters.
func topic(tag string) string {
	var b strings.Builder
	for _, c := range tag {
		if b.Len() == 32 {
			break
		}
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// GenerateKeys returns a new VAPID key pair (base64url).
func GenerateKeys() (private, public string, err error) { return webpush.GenerateVAPIDKeys() }
