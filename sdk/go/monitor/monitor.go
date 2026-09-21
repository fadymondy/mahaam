// Package monitor is a Sentry-shaped error-monitoring client: give it a DSN
// (https://<public_key>@host/monitor/<project_id>, from a project's Settings → Monitoring), it
// reports unhandled panics and exceptions to Mahaam. Separate from the top-level feedback package
// (which is the browser widget + "report a problem" intake) — a project has its own key for each.
//
// Stdlib only. Never panics, never blocks the caller: every send runs on a short-lived goroutine
// with a fixed timeout, so a network hiccup at your monitoring vendor is never the reason a
// request got slow.
package monitor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"runtime/debug"
	"strings"
	"time"
)

// Config configures a Client. DSN is the only required field; it may also come from the
// MAHAAM_DSN environment variable.
type Config struct {
	DSN string // https://<public_key>@host/monitor/<project_id>

	// Attached to every event. Environment and Release are worth setting; ServerName defaults to
	// the machine's hostname.
	Environment, Release, ServerName string

	Disabled bool
	HTTP     *http.Client
}

// Client is safe for concurrent use. A zero Client (DSN unparsed) is inert: every method is a
// no-op, so an app can construct one unconditionally and just not set MAHAAM_DSN in dev.
type Client struct {
	cfg               Config
	scheme, host, key string
	projectID         string
}

// New builds a Client from cfg, falling back to MAHAAM_DSN when cfg.DSN is blank. An invalid or
// missing DSN yields a disabled Client, not an error — the same "off unless configured" contract
// as the feedback package, so wiring this in never becomes a reason a service fails to start.
func New(cfg Config) *Client {
	dsn := strings.TrimSpace(cfg.DSN)
	if dsn == "" {
		dsn = strings.TrimSpace(os.Getenv("MAHAAM_DSN"))
	}
	c := &Client{cfg: cfg}
	if cfg.HTTP == nil {
		c.cfg.HTTP = &http.Client{Timeout: 10 * time.Second}
	}
	if c.cfg.ServerName == "" {
		if h, err := os.Hostname(); err == nil {
			c.cfg.ServerName = h
		}
	}
	u, err := url.Parse(dsn)
	if err != nil || u.User == nil || u.Scheme == "" || u.Host == "" {
		return c // disabled: Enabled() is false
	}
	key := u.User.Username()
	project := strings.Trim(u.Path, "/")
	project = strings.TrimPrefix(project, "monitor/")
	if key == "" || project == "" {
		return c
	}
	c.scheme, c.host, c.key, c.projectID = u.Scheme, u.Host, key, project
	return c
}

// Enabled reports whether the Client has a usable DSN and is not disabled.
func (c *Client) Enabled() bool { return c != nil && !c.cfg.Disabled && c.key != "" }

func (c *Client) ingestURL() string {
	return fmt.Sprintf("%s://%s/api/monitor/%s/envelope", c.scheme, c.host, c.projectID)
}

// Event is one occurrence: an exception (Type/Value/Stacktrace) or a plain message. Level is
// fatal, error, warning, info or debug; blank defaults to error server-side.
type Event struct {
	Level                   string
	Message                 string
	Type, Value, Stacktrace string
	Fingerprint             string // override automatic grouping; leave blank in the normal case
	Tags                    map[string]string
	Extra                   map[string]any
}

// Capture sends one event. It never returns an error to keep call sites simple — Send does, for
// callers that want to know.
func (c *Client) Capture(ctx context.Context, ev Event) {
	_ = c.Send(ctx, ev)
}

// Send is Capture with the delivery error, for a caller that wants to log or retry it.
func (c *Client) Send(ctx context.Context, ev Event) error {
	if !c.Enabled() {
		return nil
	}
	body, _ := json.Marshal(map[string]any{
		"public_key": c.key, "level": firstNonEmpty(ev.Level, "error"), "message": ev.Message,
		"exception_type": ev.Type, "exception_value": ev.Value, "stacktrace": ev.Stacktrace,
		"environment": c.cfg.Environment, "release": c.cfg.Release, "server_name": c.cfg.ServerName,
		"fingerprint": ev.Fingerprint, "tags": ev.Tags, "extra": ev.Extra,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.ingestURL(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.cfg.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("mahaam monitor: %s", res.Status)
	}
	return nil
}

// CaptureException reports a Go error as an exception event. Best-effort and asynchronous — it
// returns immediately; the send happens on its own goroutine with a bounded lifetime independent
// of ctx, so a caller that reports from inside a deferred/recovering handler (whose context may
// already be cancelled) still gets the event delivered.
func (c *Client) CaptureException(ctx context.Context, err error, stack string) {
	if !c.Enabled() || err == nil {
		return
	}
	go func() {
		sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		c.Capture(sendCtx, Event{Type: typeName(err), Value: err.Error(), Stacktrace: stack})
	}()
}

func typeName(err error) string {
	t := fmt.Sprintf("%T", err)
	return strings.TrimPrefix(t, "*")
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// Recover wraps an http.Handler: a panic is reported (with the stack, method, path and status
// code the handler would otherwise have left unset), then re-panicked so it still reaches
// whatever outer recovery/logging middleware the app already has. http.ErrAbortHandler is never
// reported — that panic means "the client hung up," not a fault.
func (c *Client) Recover(next http.Handler) http.Handler {
	if !c.Enabled() {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v == http.ErrAbortHandler {
				panic(v)
			}
			c.CaptureException(r.Context(), fmt.Errorf("panic: %v", v), string(debug.Stack()))
			panic(v)
		}()
		next.ServeHTTP(w, r)
	})
}

// LogUnhandled is a last line of defense for a non-HTTP process (a worker, a cron job, a CLI):
// call it in a deferred recover() at the top of main or a goroutine, and it reports then
// re-panics, the same contract as Recover.
func (c *Client) LogUnhandled() {
	v := recover()
	if v == nil {
		return
	}
	if v == http.ErrAbortHandler {
		panic(v)
	}
	c.CaptureException(context.Background(), fmt.Errorf("panic: %v", v), string(debug.Stack()))
	panic(v)
}
