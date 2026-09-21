# Mahaam Feedback for Go

```bash
go get github.com/fadymondy/mahaam/sdk/go
```

```go
fb := feedback.New(feedback.Config{}) // reads MAHAAM_FEEDBACK_KEY, MAHAAM_URL, MAHAAM_APP_URL
http.ListenAndServe(":8080", fb.Recover(fb.Middleware(mux))) // widget on every HTML page, panics reported
```

Other entry points:

- `fb.ScriptTag()` returns a `template.HTML` for your own templates, e.g. `{{ .Feedback }}`.
- `fb.Report(ctx, feedback.Report{Title: "Payment failed", Body: err.Error(), Type: "bug", Priority: "high"})` returns the issue key, such as `MG-12`. Non-2xx responses come back as `*feedback.APIError`: 403 means a bad key or origin, 422 a missing title, 429 rate limiting.

Server-side reports send no `Origin` header. Set `MAHAAM_APP_URL` (or `Config.AppURL`) to a URL on one of the key's allowed origins, and it is sent as `page_url`.

## Error monitoring (separate from the widget above)

`sdk/go/monitor` is a Sentry-shaped client: a DSN, not a `pfk_` key, and it reports to the
project's board as an issue instead of the "report a problem" intake. Get a DSN from a project's
Settings → Monitoring in Mahaam.

```go
import "github.com/fadymondy/mahaam/sdk/go/monitor"

mon := monitor.New(monitor.Config{ // reads MAHAAM_DSN if Config.DSN is blank
	Environment: "production",
	Release:     "v1.4.2",
})
http.ListenAndServe(":8080", mon.Recover(mux)) // panics reported, then re-panicked (your own
                                                // outer recovery/logging middleware still runs)
```

A repeated fault (same exception type + top stack frame) updates the existing open issue's
occurrence count instead of filing a new one every time it fires — a hot-looping error does not
flood the board.

Report anything else directly: `mon.Capture(ctx, monitor.Event{Message: "queue backed up", Level: "warning", Tags: map[string]string{"queue": "emails"}})`. For a non-HTTP process (a worker, a cron job), call `defer mon.LogUnhandled()` at the top of `main` or a goroutine instead of `Recover`.

A `monitor.Client` built with no DSN (or `MAHAAM_DSN` unset) is inert — every method is a safe no-op, so it is fine to construct unconditionally and just leave it unset in development.
