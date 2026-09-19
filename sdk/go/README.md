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
