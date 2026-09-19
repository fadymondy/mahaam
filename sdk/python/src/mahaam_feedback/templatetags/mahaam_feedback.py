"""{% load mahaam_feedback %} ... {% mahaam_feedback %} or {% mahaam_feedback "ar" %}"""

from django import template
from django.utils.safestring import mark_safe

from .. import script_tag
from ..django import _cfg

register = template.Library()


@register.simple_tag
def mahaam_feedback(locale=None):
    return mark_safe(script_tag(locale, cfg=_cfg()))  # script_tag escapes every attribute
