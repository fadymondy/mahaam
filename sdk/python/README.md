# mahaam-feedback for Python

```bash
pip install mahaam-feedback   # env: MAHAAM_FEEDBACK_KEY=pfk_..., optional MAHAAM_URL, MAHAAM_APP_URL
```

```python
import mahaam_feedback as mf
mf.report("Payment failed", body=details, type="bug", priority="high")  # returns "MG-12"
mf.install_excepthook()   # reports uncaught exceptions; or call mf.report_exception(e) yourself
html = mf.script_tag()    # escaped <script> tag
```

**Django.** Add `"mahaam_feedback"` to `INSTALLED_APPS`, then put `{% load mahaam_feedback %}{% mahaam_feedback %}` before `</body>`. You can instead add `"mahaam_feedback.django.FeedbackMiddleware"` to `MIDDLEWARE`, which injects the tag automatically and reports unhandled exceptions. To configure it in code, set `MAHAAM_FEEDBACK = {"key": ..., "locale": "ar"}` in settings.

**Flask.** Call `from mahaam_feedback.flask import init_app; init_app(app)`, then use `{{ mahaam_feedback() }}` in Jinja. Unhandled exceptions are reported.

Server-side reports send no `Origin` header, so `MAHAAM_APP_URL` must be a URL on one of the key's allowed origins. It is sent as `page_url`. The package uses only the standard library (`urllib`).

## Error monitoring (separate from the widget above)

`mahaam_feedback.monitor` is Sentry-shaped: a DSN, not a `pfk_` key, and it reports to the
project's board as an issue instead of the "report a problem" intake. Get a DSN from a project's
Settings → Monitoring, and set `MAHAAM_DSN=https://...` in the environment.

```python
from mahaam_feedback import monitor

monitor.configure()  # reads MAHAAM_DSN, or pass dsn=... directly
monitor.install_monitor_excepthook()  # reports uncaught exceptions, then re-raises as before
```

**Django.** Add `"mahaam_feedback.monitor.MonitorMiddleware"` to `MIDDLEWARE`, and set
`MAHAAM_MONITOR_DSN` or `settings.MAHAAM_MONITOR = {"dsn": "..."}`.

**Flask.** Call `from mahaam_feedback.monitor import init_app as init_monitor; init_monitor(app)`.

A repeated fault (same exception class + top stack line) updates the existing open issue's
occurrence count instead of filing a new one every time it fires. `monitor` is independent of the
feedback-widget helpers above — use both, either, or neither. With no DSN, every call is a safe
no-op.
