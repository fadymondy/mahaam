"""Django integration.

settings.py:
    INSTALLED_APPS += ["mahaam_feedback"]            # enables {% load mahaam_feedback %}
    MIDDLEWARE += ["mahaam_feedback.django.FeedbackMiddleware"]   # optional auto-inject + exception reports
    MAHAAM_FEEDBACK = {"key": "pfk_...", "locale": "en", "app_url": "https://app.example.com"}  # optional; env works too
"""

from . import Config, report_exception, script_tag


def _cfg():
    from django.conf import settings

    opts = getattr(settings, "MAHAAM_FEEDBACK", None) or getattr(settings, "MANAGY_FEEDBACK", None) or {}
    return Config(**opts)


class FeedbackMiddleware:
    """Injects the widget before </body> in HTML responses and reports unhandled exceptions."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        ctype = response.get("Content-Type", "")
        if (ctype.startswith("text/html") and not getattr(response, "streaming", False)
                and not response.has_header("Content-Encoding")):
            tag = script_tag(cfg=_cfg())
            content = response.content.decode(response.charset or "utf-8")
            i = content.lower().rfind("</body>")
            if tag and i >= 0:
                response.content = (content[:i] + tag + content[i:]).encode(response.charset or "utf-8")
                if response.has_header("Content-Length"):
                    response["Content-Length"] = str(len(response.content))
        return response

    def process_exception(self, request, exception):
        report_exception(exception, {"route": request.path,
                                     "user_agent": request.META.get("HTTP_USER_AGENT", "")}, cfg=_cfg())
        return None
