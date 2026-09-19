"""Flask integration: init_app(app) adds {{ mahaam_feedback() }} to Jinja and reports unhandled exceptions.

Config keys (optional; env vars work too): MAHAAM_FEEDBACK_KEY, MAHAAM_URL, MAHAAM_APP_URL,
MAHAAM_FEEDBACK_LOCALE, MAHAAM_FEEDBACK_ENABLED.
"""

from . import Config, report_exception, script_tag


def init_app(app, report_errors: bool = True) -> None:
    from flask import got_request_exception, request
    from markupsafe import Markup

    def cfg() -> Config:
        c = app.config
        return Config(key=c.get("MAHAAM_FEEDBACK_KEY", c.get("MANAGY_FEEDBACK_KEY", "")), base_url=c.get("MAHAAM_URL", c.get("MANAGY_URL", "")),
                      app_url=c.get("MAHAAM_APP_URL", c.get("MANAGY_APP_URL", "")), locale=c.get("MAHAAM_FEEDBACK_LOCALE", c.get("MANAGY_FEEDBACK_LOCALE", "en")),
                      enabled=c.get("MAHAAM_FEEDBACK_ENABLED", c.get("MANAGY_FEEDBACK_ENABLED", True)))

    app.jinja_env.globals["mahaam_feedback"] = lambda locale=None: Markup(script_tag(locale, cfg=cfg()))

    if report_errors:
        def on_error(sender, exception, **_):
            report_exception(exception, {"route": request.path,
                                         "user_agent": request.headers.get("User-Agent", "")}, cfg=cfg())

        got_request_exception.connect(on_error, app, weak=False)
