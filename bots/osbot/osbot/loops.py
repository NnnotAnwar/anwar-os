"""Background loops: heartbeat, calendar reminders and feedback alerts.

Each runs once a minute, just after the minute turns (so a reminder due at 13:30
goes out at ~13:30:02). Each step is "send, then ack": the web app only stops
returning an item once the bot acknowledged it, so a crash between the two
can at worst repeat one message, never lose one.

Snoozed reminders (snooze.py) go out from the same reminders step.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .api import OsbotApi
from .config import HEARTBEAT_FILE, POLL_INTERVAL_SECONDS
from .keyboards import feedback_keyboard, reminder_keyboard
from .snooze import ReminderMemory, snooze_options
from .texts import feedback_text, reminder_text
from .tg import send_card

log = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(UTC)


async def heartbeat_once(api: OsbotApi, version: str, started_at: datetime, health_file: Path | None) -> bool:
    try:
        await api.heartbeat(version, started_at)
    except Exception:
        log.warning("heartbeat failed", exc_info=True)
        return False
    if health_file is not None:
        try:
            health_file.touch()
        except OSError:
            log.warning("could not touch heartbeat file", exc_info=True)
    return True


async def send_reminder(
    bot: Any,
    chat_id: int,
    reminder: dict[str, Any],
    now: datetime,
    memory: ReminderMemory | None,
    *,
    footer: str | None = None,
) -> None:
    """The reminder card: ⏰ title, when and where, with Snooze / Got it / Open."""
    text = reminder_text(reminder, now, footer=footer)
    sent = await send_card(bot, chat_id, text, reminder_keyboard(reminder, snooze_options(reminder, now)))
    message_id = getattr(sent, "message_id", None)
    if memory is not None and isinstance(message_id, int):
        memory.remember(message_id, reminder)


async def reminders_once(
    bot: Any, api: OsbotApi, chat_id: int, now: datetime | None = None, memory: ReminderMemory | None = None
) -> int:
    """Sends due reminders, then snoozed ones whose time has come; returns how many were sent."""
    now = now or utcnow()
    sent = 0
    if memory is not None:
        for reminder in memory.due(now):
            try:
                await send_reminder(bot, chat_id, reminder, now, memory, footer="💤 Snoozed")
                sent += 1
            except Exception:
                log.warning("could not send a snoozed reminder", exc_info=True, extra={"event_id": reminder.get("eventId")})
                memory.snooze(reminder, now + timedelta(minutes=1))  # next minute
    try:
        reminders = await api.reminders_due(now)
    except Exception:
        log.warning("could not fetch due reminders", exc_info=True)
        return sent
    for reminder in reminders:
        try:
            await send_reminder(bot, chat_id, reminder, now, memory)
        except Exception:
            log.warning("could not send a reminder", exc_info=True, extra={"event_id": reminder.get("eventId")})
            continue  # not acked: retried next minute
        try:
            await api.ack_reminders(reminder["keys"])
            sent += 1
        except Exception:
            log.warning("could not ack a reminder", exc_info=True, extra={"event_id": reminder.get("eventId")})
    return sent


async def feedback_once(bot: Any, api: OsbotApi, chat_id: int, now: datetime | None = None) -> int:
    """Sends new feedback alerts; returns how many were sent and acknowledged."""
    try:
        items = await api.new_feedback()
    except Exception:
        log.warning("could not fetch new feedback", exc_info=True)
        return 0
    sent = 0
    for item in items:
        try:
            await send_card(bot, chat_id, feedback_text(item, now or utcnow()), feedback_keyboard(item["id"], item.get("url")))
        except Exception:
            log.warning("could not send a feedback alert", exc_info=True, extra={"feedback_id": item.get("id")})
            continue
        try:
            await api.ack_feedback([item["id"]])
            sent += 1
        except Exception:
            log.warning("could not ack a feedback alert", exc_info=True, extra={"feedback_id": item.get("id")})
    return sent


def seconds_to_next_minute(now: float | None = None, interval: float = POLL_INTERVAL_SECONDS) -> float:
    now = time.time() if now is None else now
    return interval - (now % interval) + 1.0


async def every_minute(step: Callable[[], Awaitable[object]], *, name: str, sleep=asyncio.sleep, wait=seconds_to_next_minute) -> None:
    """Runs `step` now and then just after every minute, forever. A failing step never stops the loop."""
    while True:
        try:
            await step()
        except Exception:
            log.exception("loop step failed", extra={"loop": name})
        await sleep(wait())


def background_tasks(
    bot: Any, api: OsbotApi, chat_id: int, version: str, started_at: datetime, memory: ReminderMemory | None = None
) -> list[asyncio.Task]:
    return [
        asyncio.create_task(
            every_minute(lambda: heartbeat_once(api, version, started_at, HEARTBEAT_FILE), name="heartbeat"),
            name="heartbeat",
        ),
        asyncio.create_task(
            every_minute(lambda: reminders_once(bot, api, chat_id, memory=memory), name="reminders"), name="reminders"
        ),
        asyncio.create_task(every_minute(lambda: feedback_once(bot, api, chat_id), name="feedback"), name="feedback"),
    ]
