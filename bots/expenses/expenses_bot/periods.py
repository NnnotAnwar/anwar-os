"""Calendar periods (day / ISO week / month) in the owner's timezone, and human dates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from .config import TIMEZONE

TZ = ZoneInfo(TIMEZONE)

Kind = Literal["d", "w", "m"]
KINDS: tuple[Kind, ...] = ("d", "w", "m")


def now_local() -> datetime:
    return datetime.now(UTC).astimezone(TZ)


def today_local() -> date:
    return now_local().date()


def local_midnight(day: date) -> datetime:
    """Aware datetime of 00:00 Prague time on `day` (DST-correct)."""
    return datetime.combine(day, time(), TZ)


def _add_months(day: date, months: int) -> date:
    index = day.year * 12 + day.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


@dataclass(frozen=True)
class Period:
    kind: Kind
    start: date  # first day (inclusive)

    @classmethod
    def containing(cls, kind: Kind, day: date) -> Period:
        if kind == "d":
            return cls(kind, day)
        if kind == "w":
            return cls(kind, day - timedelta(days=day.weekday()))
        return cls(kind, day.replace(day=1))

    @classmethod
    def current(cls, kind: Kind) -> Period:
        return cls.containing(kind, today_local())

    @property
    def end(self) -> date:
        """First day after the period (exclusive)."""
        if self.kind == "d":
            return self.start + timedelta(days=1)
        if self.kind == "w":
            return self.start + timedelta(days=7)
        return _add_months(self.start, 1)

    @property
    def days(self) -> int:
        return (self.end - self.start).days

    def shift(self, steps: int) -> Period:
        if self.kind == "d":
            return Period(self.kind, self.start + timedelta(days=steps))
        if self.kind == "w":
            return Period(self.kind, self.start + timedelta(days=7 * steps))
        return Period(self.kind, _add_months(self.start, steps))

    @property
    def prev(self) -> Period:
        return self.shift(-1)

    @property
    def next(self) -> Period:
        return self.shift(1)

    def contains(self, day: date) -> bool:
        return self.start <= day < self.end

    def is_current(self) -> bool:
        return self.contains(today_local())

    def is_future(self) -> bool:
        return self.start > today_local()

    def bounds(self) -> tuple[datetime, datetime]:
        return local_midnight(self.start), local_midnight(self.end)

    # --- callback data: "m20261101" -------------------------------------------------
    def encode(self) -> str:
        return f"{self.kind}{self.start:%Y%m%d}"

    @classmethod
    def decode(cls, value: str) -> Period | None:
        kind, digits = value[:1], value[1:]
        if kind not in KINDS or len(digits) != 8 or not digits.isdigit():
            return None
        try:
            day = datetime.strptime(digits, "%Y%m%d").date()
        except ValueError:
            return None
        return cls.containing(kind, day)

    # --- labels -------------------------------------------------------------------
    def title(self) -> str:
        today = today_local()
        if self.kind == "d":
            if self.start == today:
                return f"Today · {self.start:%a} {self.start.day} {self.start:%b}"
            if self.start == today - timedelta(days=1):
                return f"Yesterday · {self.start:%a} {self.start.day} {self.start:%b}"
            return f"{self.start:%A} {short_date(self.start, today)}"
        if self.kind == "w":
            last = self.end - timedelta(days=1)
            iso_week = self.start.isocalendar().week
            if self.start.month == last.month:
                span = f"{self.start.day}–{last.day} {last:%b}"
            else:
                span = f"{self.start.day} {self.start:%b} – {last.day} {last:%b}"
            if last.year != today.year or self.start.year != last.year:
                span += f" {last.year}"
            prefix = "This week" if self.contains(today) else f"Week {iso_week}"
            return f"{prefix} · {span}"
        return f"{self.start:%B %Y}"

    def short(self) -> str:
        """Compact label for navigation buttons."""
        today = today_local()
        if self.kind == "d":
            if self.start == today:
                return "Today"
            if self.start == today - timedelta(days=1):
                return "Yesterday"
            return f"{self.start.day} {self.start:%b}"
        if self.kind == "w":
            if self.contains(today):
                return "This week"
            return f"Week {self.start.isocalendar().week}"
        if self.start.year == today.year:
            return f"{self.start:%b}"
        return f"{self.start:%b %Y}"

    def comparison_label(self) -> str:
        """How the previous period is named in "vs …" lines."""
        if self.kind == "d":
            return "yesterday" if self.is_current() else "the day before"
        if self.kind == "w":
            return "last week" if self.is_current() else "the week before"
        return self.prev.start.strftime("%B")


def short_date(day: date, today: date | None = None) -> str:
    """"17 Nov", or "17 Nov 2025" outside the current year."""
    today = today or today_local()
    if day.year == today.year:
        return f"{day.day} {day:%b}"
    return f"{day.day} {day:%b} {day.year}"


def human_day(day: date, today: date | None = None) -> str:
    """"Today", "Yesterday", "Mon 17 Nov", "3 Feb 2025"."""
    today = today or today_local()
    if day == today:
        return "Today"
    if day == today - timedelta(days=1):
        return "Yesterday"
    if day.year == today.year:
        return f"{day:%a} {day.day} {day:%b}"
    return f"{day.day} {day:%b} {day.year}"


def human_datetime(at: datetime, today: date | None = None) -> str:
    """"Today, 09:15" in Prague time. Naive datetimes are taken as Prague local time."""
    local = at.astimezone(TZ) if at.tzinfo else at
    return f"{human_day(local.date(), today)}, {local:%H:%M}"


def to_local(at: datetime) -> datetime:
    return at.astimezone(TZ) if at.tzinfo else at.replace(tzinfo=TZ)
