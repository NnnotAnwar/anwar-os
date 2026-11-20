"""Background loops: heartbeat, calendar reminders and feedback alerts.

Each runs once a minute, just after the minute turns (so a reminder due at 13:30
goes out at ~13:30:02). Each step is "send, then ack": the web app only stops
returning an item once the bot acknowledged it, so a crash between the two
can at worst repeat one message, never lose one.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path

from aiogram import Bot
from aiogram.types import LinkPreviewOptions

from .api import OsbotApi
from .config import HEARTBEAT_FILE, POLL_INTERVAL_SECONDS
from .texts import feedback_text, reminder_text

log = logging.getLogger(__name__)

NO_PREVIEW = LinkPreviewOptions(is_disabled=True)


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


async def reminders_once(bot: Bot, api: OsbotApi, chat_id: int, now: datetime | None = None) -> int:
    """Sends due reminders; returns how many were sent and acknowledged."""
    now = now or utcnow()
    try:
        reminders = await api.reminders_due(now)
    except Exception:
        log.warning("could not fetch due reminders", exc_info=True)
        return 0
    sent = 0
    for reminder in reminders:
        try:
            await bot.send_message(chat_id, reminder_text(reminder, now), link_preview_options=NO_PREVIEW)
        except Exception:
            log.warning("could not send a reminder", exc_info=True, extra={"event_id": reminder.get("eventId")})
            continue  # not acked: retried next minute
        try:
            await api.ack_reminders(reminder["keys"])
            sent += 1
        except Exception:
            log.warning("could not ack a reminder", exc_info=True, extra={"event_id": reminder.get("eventId")})
    return sent


async def feedback_once(bot: Bot, api: OsbotApi, chat_id: int) -> int:
    """Sends new feedback alerts; returns how many were sent and acknowledged."""
    try:
        items = await api.new_feedback()
    except Exception:
        log.warning("could not fetch new feedback", exc_info=True)
        return 0
    sent = 0
    for item in items:
        try:
            await bot.send_message(chat_id, feedback_text(item), link_preview_options=NO_PREVIEW)
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


def background_tasks(bot: Bot, api: OsbotApi, chat_id: int, version: str, started_at: datetime) -> list[asyncio.Task]:
    return [
        asyncio.create_task(
            every_minute(lambda: heartbeat_once(api, version, started_at, HEARTBEAT_FILE), name="heartbeat"),
            name="heartbeat",
        ),
        asyncio.create_task(every_minute(lambda: reminders_once(bot, api, chat_id), name="reminders"), name="reminders"),
        asyncio.create_task(every_minute(lambda: feedback_once(bot, api, chat_id), name="feedback"), name="feedback"),
    ]
