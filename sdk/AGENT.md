# Install Mahaam Feedback (prompt for your AI coding agent)

Copy everything below the line into your agent. First replace `<PFK_KEY>`, `<MAHAAM_URL>` and `<APP_URL>`.

---

Add the Mahaam Feedback widget and server-side error reporting to this project.

- Public key: `<PFK_KEY>` (looks like `pfk_` + 32 hex chars; it is public-safe but still goes in env, not code)
- Mahaam base URL: `<MAHAAM_URL>` (default `https://console.mahaam.app`)
- App URL: `<APP_URL>`. This is the origin this app is served from, and it must be on the key's allowed origins in Mahaam.

Steps:

1. **Detect the stack** from the repo root. Check in this order and use the first match:
   - `composer.json` requiring `laravel/framework` → **Laravel**
   - `package.json` with `next` → **Next.js**; with `react` → **React**; with `express` → **Express**; any other Node server → **Node**
   - `go.mod` → **Go**
   - `manage.py` or `django` in requirements/pyproject → **Django**; `flask` → **Flask**; other Python → **Python**
   - Anything else (static HTML, Rails, and so on): paste the plain tag before `</body>`:
     `<script src="<MAHAAM_URL>/embed/v1.js" data-key="<PFK_KEY>" data-locale="en" defer></script>`
2. **Add env vars** to `.env` / `.env.example` (and the deploy config): `MAHAAM_FEEDBACK_KEY=<PFK_KEY>`, `MAHAAM_URL=<MAHAAM_URL>`, `MAHAAM_APP_URL=<APP_URL>`. In Next.js, also add `NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY` and `NEXT_PUBLIC_MAHAAM_URL` for the client component.
3. **Install and wire** the SDK:
   - Laravel: `composer require mahaam/feedback`. Put `@mahaamFeedback` before `</body>` in the main layout. In `bootstrap/app.php` (11/12) use `->withExceptions(fn ($e) => $e->report(fn (Throwable $t) => \Mahaam\Feedback\Facades\MahaamFeedback::reportException($t)))`; in Laravel 10, register the same callback in `App\Exceptions\Handler::register()`.
   - Next.js / React: `npm i @mahaam/feedback`. Render `<MahaamFeedback publicKey={process.env.NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY} baseUrl={process.env.NEXT_PUBLIC_MAHAAM_URL} />` from `@mahaam/feedback/react` once in the root layout. It is a client component, and the prop is `publicKey`, not `key`. For server errors, call `reportException(err)` from `@mahaam/feedback` in your error handling.
   - Express / Node: `npm i @mahaam/feedback`. Add `app.use(expressMiddleware())` before routes and call `installExceptionHook()` at startup.
   - Go: `go get github.com/fadymondy/mahaam/sdk/go`. Create `fb := feedback.New(feedback.Config{})` and wrap the root handler: `fb.Recover(fb.Middleware(handler))`.
   - Django: `pip install mahaam-feedback`. Add `"mahaam_feedback"` to `INSTALLED_APPS` and `"mahaam_feedback.django.FeedbackMiddleware"` to `MIDDLEWARE`.
   - Flask: `pip install mahaam-feedback`. Call `from mahaam_feedback.flask import init_app; init_app(app)` and add `{{ mahaam_feedback() }}` before `</body>` in the base template.
4. **Locale.** If the app is multilingual (en/ar), pass the current locale (`data-locale` / `locale` option).
5. **Verify.** Load a page and confirm a "Report a problem" button appears. The browser console must show no 403, because a 403 means the page origin isn't on the key's allowlist. Then run one server-side report (for example `report("SDK install check", type="task")`) and confirm it returns a key like `MG-12`. A 403 there means `MAHAAM_APP_URL` isn't an allowed origin. Delete the test issue afterwards.
6. Don't commit real keys into tracked `.env` files. Only the example file gets placeholders.

---

# Install Mahaam Error Monitoring (Go, Node, Laravel, Python — a separate product from the Feedback widget above)

This is Sentry-shaped, not the feedback widget: a DSN (from a project's Settings → Monitoring),
reporting unhandled errors to Mahaam's issue board directly, with no browser widget involved.

1. Add `MAHAAM_DSN=<DSN>` to `.env` / `.env.example` and the deploy config.
2. Install and wire, by stack:
   - **Go**: `go get github.com/fadymondy/mahaam/sdk/go`
     ```go
     import "github.com/fadymondy/mahaam/sdk/go/monitor"

     mon := monitor.New(monitor.Config{Environment: "production"}) // reads MAHAAM_DSN
     http.ListenAndServe(":8080", mon.Recover(handler))
     ```
     For a non-HTTP process (worker, cron job), use `defer mon.LogUnhandled()` at the top of
     `main` instead of `Recover`.
   - **Node / Express**: `npm i @mahaam/feedback`
     ```js
     import { Monitor, expressErrorHandler } from "@mahaam/feedback/monitor";

     const monitor = new Monitor({ environment: "production" }); // reads MAHAAM_DSN
     app.use(expressErrorHandler(monitor)); // mount LAST, after all routes
     ```
   - **Laravel**: `composer require mahaam/feedback`. In `bootstrap/app.php` (11/12):
     ```php
     ->withExceptions(fn ($e) => $e->report(fn (Throwable $t) => \Mahaam\Feedback\Facades\MahaamMonitor::captureException($t)))
     ```
     In Laravel 10, register the same callback in `App\Exceptions\Handler::register()`.
   - **Django**: `pip install mahaam-feedback`. Add `"mahaam_feedback.monitor.MonitorMiddleware"`
     to `MIDDLEWARE`.
   - **Flask**: `pip install mahaam-feedback`. Call
     `from mahaam_feedback.monitor import init_app as init_monitor; init_monitor(app)`.
   - **Other Python**: `from mahaam_feedback import monitor; monitor.configure(); monitor.install_monitor_excepthook()`.
3. **Verify.** Trigger a deliberate error (a debug-only route works well) and confirm it appears
   as a new issue on the project's board with source "monitor" in Mahaam. Trigger the same error
   again and confirm it bumps the SAME issue's occurrence count rather than creating a second one.
4. Don't commit a real DSN into a tracked `.env` file. Only the example file gets a placeholder.
