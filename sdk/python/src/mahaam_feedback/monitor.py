"""Mahaam error monitoring: Sentry-shaped, a DSN rather than the feedback widget's pfk_ key, and
it reports to the project's board as an issue rather than the "report a problem" intake. Get a
DSN from a project's Settings -> Monitoring in Mahaam. Stdlib only, separate from __init__.py's
feedback-widget helpers — a project has its own key for each.

    from mahaam_feedback import monitor
    mon = monitor.configure()          # reads MAHAAM_DSN
    monitor.install_monitor_excepthook()

Django: MIDDLEWARE += ["mahaam_feedback.monitor.MonitorMiddleware"]; MAHAAM_MONITOR_DSN=... env,
or settings.MAHAAM_MONITOR = {"dsn": "..."}.
Flask: from mahaam_feedback.monitor import init_app as init_monitor; init_monitor(app).
"""

import json
import os
import sys
import traceback
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

__all__ = [
    "MonitorConfig", "configure", "get_config", "capture", "capture_exception",
    "install_monitor_excepthook", "MonitorMiddleware", "init_app",
]


def _env(name: str) -> str:
    return os.environ.get("MAHAAM_" + name, "")


@dataclass
class MonitorConfig:
    dsn: str = ""
    environment: str = ""
    release: str = ""
    server_name: str = ""
    enabled: bool = True
    timeout: float = 10.0

    def resolved(self) -> "MonitorConfig":
        return MonitorConfig(
            dsn=self.dsn or _env("DSN"),
            environment=self.environment or _env("MONITOR_ENVIRONMENT"),
            release=self.release or _env("MONITOR_RELEASE"),
            server_name=self.server_name or _env("MONITOR_SERVER_NAME"),
            enabled=self.enabled,
            timeout=self.timeout,
        )

    @property
    def parsed(self) -> Optional[Dict[str, str]]:
        """{'ingest_url', 'public_key'}, or None for a blank/invalid DSN."""
        dsn = self.dsn.strip()
        if not dsn:
            return None
        u = urllib.parse.urlsplit(dsn)
        if not u.username or not u.scheme or not u.hostname:
            return None
        project = u.path.strip("/")
        if project.startswith("monitor/"):
            project = project[len("monitor/"):]
        if not project:
            return None
        netloc = u.hostname + (":%d" % u.port if u.port else "")
        return {
            "public_key": u.username,
            "ingest_url": "%s://%s/api/monitor/%s/envelope" % (u.scheme, netloc, project),
        }

    @property
    def active(self) -> bool:
        return bool(self.enabled and self.parsed)


_config = MonitorConfig()


def configure(**kwargs) -> MonitorConfig:
    """Set process-wide defaults, e.g. configure(dsn="...", environment="production")."""
    global _config
    _config = MonitorConfig(**kwargs)
    return _config


def get_config(cfg: Optional[MonitorConfig] = None) -> MonitorConfig:
    return (cfg or _config).resolved()


def capture(
    message: Optional[str] = None,
    type: Optional[str] = None,  # noqa: A002 - matches the JSON field name
    value: Optional[str] = None,
    stacktrace: Optional[str] = None,
    level: str = "error",
    tags: Optional[Dict[str, str]] = None,
    extra: Optional[Dict[str, Any]] = None,
    fingerprint: Optional[str] = None,
    cfg: Optional[MonitorConfig] = None,
) -> None:
    """Sends one event. Never raises — a monitoring hiccup must never be why a request fails;
    failures are silently dropped (this is best-effort by design, not logged to avoid recursively
    reporting-on-the-reporter)."""
    c = get_config(cfg)
    p = c.parsed
    if not c.active or not p:
        return
    body = json.dumps({
        "public_key": p["public_key"], "level": level, "message": message,
        "exception_type": type, "exception_value": value, "stacktrace": stacktrace,
        "environment": c.environment or None, "release": c.release or None,
        "server_name": c.server_name or None, "fingerprint": fingerprint,
        "tags": tags or None, "extra": extra or None,
    }).encode("utf-8")
    req = urllib.request.Request(
        p["ingest_url"], data=body, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=c.timeout):
            pass
    except urllib.error.HTTPError:
        pass
    except urllib.error.URLError:
        pass


def capture_exception(exc: BaseException, extra: Optional[Dict[str, Any]] = None,
                       cfg: Optional[MonitorConfig] = None) -> None:
    """Reports a caught exception. Never raises."""
    try:
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        capture(type=type(exc).__name__, value=str(exc), stacktrace=tb, extra=extra, cfg=cfg)
    except Exception:
        pass


def install_monitor_excepthook(cfg: Optional[MonitorConfig] = None) -> None:
    """Report uncaught exceptions, then defer to the previous sys.excepthook. Independent of
    mahaam_feedback.install_excepthook — install both if you want the exception filed as an issue
    AND recorded on the monitoring DSN."""
    prev = sys.excepthook

    def hook(etype, exc_value, tb):
        if not issubclass(etype, KeyboardInterrupt):
            capture_exception(exc_value, cfg=cfg)
        prev(etype, exc_value, tb)

    sys.excepthook = hook


class MonitorMiddleware:
    """Django: reports an unhandled view exception. Add to MIDDLEWARE (order relative to
    mahaam_feedback.django.FeedbackMiddleware doesn't matter — they act independently)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def _cfg(self) -> MonitorConfig:
        from django.conf import settings

        opts = getattr(settings, "MAHAAM_MONITOR", None) or {}
        return MonitorConfig(**opts)

    def process_exception(self, request, exception):
        capture_exception(exception, {"route": request.path, "method": request.method}, cfg=self._cfg())
        return None


def init_app(app, report_errors: bool = True) -> None:
    """Flask: from mahaam_feedback.monitor import init_app as init_monitor; init_monitor(app)."""
    from flask import got_request_exception, request

    def cfg() -> MonitorConfig:
        c = app.config
        return MonitorConfig(
            dsn=c.get("MAHAAM_DSN", ""), environment=c.get("MAHAAM_MONITOR_ENVIRONMENT", ""),
            release=c.get("MAHAAM_MONITOR_RELEASE", ""),
        )

    if report_errors:
        def on_error(sender, exception, **_):
            capture_exception(exception, {"route": request.path, "method": request.method}, cfg=cfg())

        got_request_exception.connect(on_error, app, weak=False)
