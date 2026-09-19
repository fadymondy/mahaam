"""Mahaam Feedback: widget script tag + server-side issue reporting (stdlib only)."""

import html
import json
import os
import sys
import traceback
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

__all__ = [
    "DEFAULT_BASE_URL", "Config", "FeedbackError", "configure", "get_config",
    "script_tag", "report", "report_exception", "install_excepthook",
]

DEFAULT_BASE_URL = "https://console.mahaam.app"


def _env(name: str) -> str:
    """MAHAAM_<name>, falling back to the pre-rebrand MANAGY_<name>."""
    return os.environ.get("MAHAAM_" + name) or os.environ.get("MANAGY_" + name, "")


@dataclass
class Config:
    """Blank values fall back to MAHAAM_FEEDBACK_KEY, MAHAAM_URL and MAHAAM_APP_URL."""

    key: str = ""
    base_url: str = ""
    locale: str = "en"
    endpoint: str = ""
    app_url: str = ""  # a URL on the key's allowed origins; sent as page_url by server reports
    enabled: bool = True
    timeout: float = 10.0
    extra: Dict[str, str] = field(default_factory=dict)

    def resolved(self) -> "Config":
        return Config(
            key=self.key or _env("FEEDBACK_KEY"),
            base_url=(self.base_url or _env("URL") or DEFAULT_BASE_URL).rstrip("/"),
            locale=self.locale or "en",
            endpoint=self.endpoint,
            app_url=self.app_url or _env("APP_URL"),
            enabled=self.enabled,
            timeout=self.timeout,
            extra=dict(self.extra),
        )

    @property
    def active(self) -> bool:
        return bool(self.enabled and self.key)


_config = Config()


def configure(**kwargs) -> Config:
    """Set process-wide defaults, e.g. configure(key="pfk_...", locale="ar")."""
    global _config
    _config = Config(**kwargs)
    return _config


def get_config(cfg: Optional[Config] = None) -> Config:
    return (cfg or _config).resolved()


class FeedbackError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__("mahaam feedback: %d %s" % (status, message))
        self.status = status
        self.message = message


def script_tag(locale: Optional[str] = None, cfg: Optional[Config] = None) -> str:
    """The widget <script> tag, HTML-escaped; '' when disabled."""
    c = get_config(cfg)
    if not c.active:
        return ""
    e = lambda v: html.escape(str(v), quote=True)  # noqa: E731
    tag = '<script src="%s/embed/v1.js" data-key="%s" data-locale="%s"' % (
        e(c.base_url), e(c.key), e(locale or c.locale))
    if c.endpoint:
        tag += ' data-endpoint="%s"' % e(c.endpoint)
    return tag + " defer></script>"


def _multipart(fields: Dict[str, str]):
    boundary = "mahaam" + uuid.uuid4().hex
    out = []
    for k, v in fields.items():
        out.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n" % (boundary, k)).encode())
        out.append(str(v).encode("utf-8") + b"\r\n")
    out.append(("--%s--\r\n" % boundary).encode())
    return b"".join(out), "multipart/form-data; boundary=" + boundary


def report(title: str, body: Optional[str] = None, type: Optional[str] = None,
           priority: Optional[str] = None, extra: Optional[Dict[str, str]] = None,
           cfg: Optional[Config] = None) -> Optional[str]:
    """POST to {base}/api/feedback/embed. Returns the issue key (e.g. "MG-12"), None when disabled.

    type: bug|feature|task. priority: highest|high|medium|low|lowest.
    extra: page_url, route, selector, user_agent, viewport, console_log, network_log.
    Raises FeedbackError on non-2xx (403 key/origin, 422 validation, 429 rate limit).
    """
    c = get_config(cfg)
    if not c.active:
        return None
    if not (title or "").strip():
        raise ValueError("mahaam feedback: title is required")
    fields = {"page_url": c.app_url}
    fields.update(c.extra)
    fields.update(extra or {})
    fields.update({"public_key": c.key, "title": title[:200], "body": body,
                   "issue_type": type, "priority": priority})
    data, ctype = _multipart({k: v for k, v in fields.items() if v})
    req = urllib.request.Request(c.base_url + "/api/feedback/embed", data=data, method="POST",
                                 headers={"Content-Type": ctype, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=c.timeout) as res:
            payload = json.loads(res.read().decode("utf-8") or "{}")
            return payload.get("key")
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")
        try:
            msg = json.loads(raw).get("error") or raw
        except ValueError:
            msg = raw
        raise FeedbackError(err.code, msg.strip()) from None


def report_exception(exc: BaseException, extra: Optional[Dict[str, str]] = None,
                     cfg: Optional[Config] = None) -> Optional[str]:
    """Report an exception as a bug. Never raises."""
    try:
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        return report("%s: %s" % (type(exc).__name__, exc), tb, "bug", "high", extra, cfg)
    except Exception:
        return None


def install_excepthook(cfg: Optional[Config] = None) -> None:
    """Report uncaught exceptions, then defer to the previous sys.excepthook."""
    prev = sys.excepthook

    def hook(etype, value, tb):
        if not issubclass(etype, KeyboardInterrupt):
            report_exception(value, cfg=cfg)
        prev(etype, value, tb)

    sys.excepthook = hook
