"""Formatting primitives: HTML escaping, truncation and human dates.

Every message goes out with parse_mode=HTML (set once on the Bot), so anything
that came from people (titles, feedback, forwarded text) must pass through
`esc` before it is put into a message.
"""

from __future__ import annotations

import html
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .config import DEFAULT_TIMEZONE

_zone = ZoneInfo(DEFAULT_TIMEZONE)


def set_timezone(name: str) -> None:
    """Where the bot's own dates are shown (OSBOT_TIMEZONE). Called once at startup."""
    global _zone
    _zone = ZoneInfo(name)


def zone() -> ZoneInfo:
    return _zone


def esc(value: object) -> str:
    return html.escape(str(value), quote=False)


def truncate(text: str, limit: int) -> str:
    """One line, at most `limit` characters, with an ellipsis when cut."""
    line = " ".join(text.split())
    return line if len(line) <= limit else line[: limit - 1].rstrip() + "…"


def plural(n: int, unit: str, units: str | None = None) -> str:
    return f"{n} {unit}" if n == 1 else f"{n} {units or unit + 's'}"


def parse_instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def local(instant: datetime) -> datetime:
    return instant.astimezone(_zone)


def clock(instant: datetime) -> str:
    """14:05 in the bot's time zone."""
    return local(instant).strftime("%H:%M")


def day_label(day: date) -> str:
    """Mon 16 Nov"""
    return f"{day.strftime('%a')} {day.day} {day.strftime('%b')}"


def human_day(day: date, today: date) -> str:
    """today, tomorrow, yesterday, else Mon 16 Nov."""
    delta = (day - today).days
    return {0: "today", 1: "tomorrow", -1: "yesterday"}.get(delta) or day_label(day)


def stamp(instant: datetime, now: datetime) -> str:
    """When something happened: "14:05", "yesterday 14:05", "Mon 16 Nov 14:05"."""
    day = local(instant).date()
    today = local(now).date()
    if day == today:
        return clock(instant)
    return f"{human_day(day, today)} {clock(instant)}"


def iso_day(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def today_local(now: datetime) -> date:
    return local(now).date()


def plus_minutes(now: datetime, minutes: int) -> datetime:
    return now + timedelta(minutes=minutes)
