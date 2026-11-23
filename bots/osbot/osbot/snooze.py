"""Reminder snoozes, kept in memory.

The web app sends each reminder once; a snooze is the bot's own business: it
remembers the last reminder cards it sent (by message id, so a Snooze button
can find its reminder) and the snoozed ones waiting to go out again. Both are
small and bounded. A restart forgets them, and a Snooze button pressed after
one says so instead of failing silently.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timedelta
from typing import Any

from .fmt import parse_instant

KEEP_SENT = 100
KEEP_SNOOZED = 50
SNOOZE_MINUTES = (10, 60)


def snooze_options(reminder: dict[str, Any], now: datetime) -> list[int]:
    """Snoozes that still end before the event starts (any for all-day events)."""
    if reminder.get("allDay"):
        return list(SNOOZE_MINUTES)
    start = parse_instant(reminder["start"])
    return [m for m in SNOOZE_MINUTES if now + timedelta(minutes=m + 1) <= start]


class ReminderMemory:
    def __init__(self, keep_sent: int = KEEP_SENT, keep_snoozed: int = KEEP_SNOOZED):
        self._sent: OrderedDict[int, dict[str, Any]] = OrderedDict()
        self._snoozed: list[tuple[datetime, dict[str, Any]]] = []
        self._keep_sent = keep_sent
        self._keep_snoozed = keep_snoozed

    def remember(self, message_id: int, reminder: dict[str, Any]) -> None:
        # Only what a card needs again; the delivery keys stay out.
        self._sent[message_id] = {k: reminder.get(k) for k in ("eventId", "title", "location", "allDay", "start", "when", "url")}
        while len(self._sent) > self._keep_sent:
            self._sent.popitem(last=False)

    def get(self, message_id: int) -> dict[str, Any] | None:
        return self._sent.get(message_id)

    def snooze(self, reminder: dict[str, Any], until: datetime) -> None:
        self._snoozed.append((until, reminder))
        self._snoozed.sort(key=lambda item: item[0])
        del self._snoozed[self._keep_snoozed :]  # over the limit: the furthest away go

    def due(self, now: datetime) -> list[dict[str, Any]]:
        """Snoozed reminders whose time has come, removed from the queue."""
        ready = [r for until, r in self._snoozed if until <= now]
        self._snoozed = [(until, r) for until, r in self._snoozed if until > now]
        return ready

    def __len__(self) -> int:
        return len(self._snoozed)
