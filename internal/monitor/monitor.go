// Package monitor sends Mahaam's own errors to Mahaam (MH-129): the API is wired with the same Go
// SDK customers use, github.com/fadymondy/mahaam-go, so a panic or a logged error becomes an issue
// on our own board. It is also the best test of the SDK there is.
//
// Off unless MAHAAM_DSN is set (the SDK is inert without one), so development and the tests send
// nothing.
package monitor

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	mahaam "github.com/fadymondy/mahaam-go"
)

// New builds the client from the environment. Release is the VCS revision the binary was built
// from, when the build recorded one, so an issue says which deploy it came from.
func New() *mahaam.Client {
	env := os.Getenv("APP_ENV")
	if env == "" {
		env = "development"
	}
	return mahaam.New(mahaam.Config{Environment: env, Release: revision()})
}

func revision() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, s := range info.Settings {
		if s.Key == "vcs.revision" && len(s.Value) >= 7 {
			return s.Value[:7]
		}
	}
	return ""
}

// Recover is the outermost middleware: a panicking request is reported through the SDK and then
// answered 500. The kernel has no recovery of its own, so without this a panic fell through to
// net/http, which drops the connection: the client saw a network error, not an error response,
// and nothing recorded what happened beyond one line in the process log.
//
// The SDK's own Recover reports and re-panics (so an app's existing recovery still runs); this is
// that existing recovery. http.ErrAbortHandler passes straight through: it means the client went
// away.
func Recover(c *mahaam.Client, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		inner := c.Recover(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if v == http.ErrAbortHandler {
					panic(v)
				}
				if log != nil {
					log.Error("panic serving request", "method", r.Method, "path", r.URL.Path, "panic", fmt.Sprint(v), monitored, true)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"something went wrong"}`))
			}()
			inner.ServeHTTP(w, r)
		})
	}
}

// monitored marks a log record that was already reported (the panic above), so the log bridge
// doesn't file it a second time.
const monitored = "monitored"

// throttle is how often one message may be reported from this process. The dedup on the server
// counts occurrences either way; this keeps a hot error loop from becoming a hot request loop, and
// bounds the one real hazard of an API reporting to itself: an error in the monitor intake that is
// logged, reported to the intake, fails, and is logged again.
const throttle = 5 * time.Minute

// Bridge wraps a slog handler so that every record at Error or above is also reported as an issue,
// grouped by its message. The attributes travel as extra; an "err" attribute that holds an error
// becomes the exception.
func Bridge(inner slog.Handler, c *mahaam.Client) slog.Handler {
	if !c.Enabled() {
		return inner
	}
	return &bridge{inner: inner, c: c, last: &sync.Map{}}
}

type bridge struct {
	inner slog.Handler
	c     *mahaam.Client
	attrs []slog.Attr
	group string
	last  *sync.Map // message → time.Time of its last report
}

func (b *bridge) Enabled(ctx context.Context, l slog.Level) bool { return b.inner.Enabled(ctx, l) }

func (b *bridge) Handle(ctx context.Context, r slog.Record) error {
	err := b.inner.Handle(ctx, r)
	if r.Level >= slog.LevelError {
		b.report(ctx, r)
	}
	return err
}

func (b *bridge) report(ctx context.Context, r slog.Record) {
	extra := map[string]any{}
	ev := mahaam.Event{Level: "error", Message: r.Message, Fingerprint: "log:" + r.Message}
	skip := false
	add := func(a slog.Attr) bool {
		key := a.Key
		if b.group != "" {
			key = b.group + "." + key
		}
		if a.Key == monitored {
			skip = true
			return true
		}
		if e, ok := a.Value.Any().(error); ok && ev.Type == "" {
			// The intake titles an issue "type: value". The Go type of an error is almost always
			// *errors.errorString or *fmt.wrapError, which says nothing; the log message says what
			// failed. So the card reads "could not send the invoice: smtp down", not
			// "*errors.errorString: smtp down". The type still travels, in extra.
			ev.Type, ev.Value = r.Message, e.Error()
			extra["error_type"] = fmt.Sprintf("%T", e)
			return true
		}
		extra[key] = a.Value.String()
		return true
	}
	for _, a := range b.attrs {
		add(a)
	}
	r.Attrs(add)
	if skip {
		return
	}
	now := time.Now()
	if prev, ok := b.last.Load(r.Message); ok && now.Sub(prev.(time.Time)) < throttle {
		return
	}
	b.last.Store(r.Message, now)
	if len(extra) > 0 {
		ev.Extra = extra
	}
	// Captured on its own context: a request that is finishing must not cancel the report.
	b.c.Capture(context.WithoutCancel(ctx), ev)
}

func (b *bridge) WithAttrs(attrs []slog.Attr) slog.Handler {
	n := *b
	n.inner = b.inner.WithAttrs(attrs)
	n.attrs = append(append([]slog.Attr{}, b.attrs...), attrs...)
	return &n
}

func (b *bridge) WithGroup(name string) slog.Handler {
	n := *b
	n.inner = b.inner.WithGroup(name)
	if n.group != "" {
		name = n.group + "." + name
	}
	n.group = strings.TrimSpace(name)
	return &n
}
