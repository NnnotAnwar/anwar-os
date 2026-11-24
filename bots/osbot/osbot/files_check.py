"""Weekly files storage check (Ops → Server → Files storage in the app).

Every Monday from 04:00 (the bot's time zone) the bot asks the web app to
compare every file with the objects in the bucket
(POST files-check/run, src/modules/ops/files-check.ts). The app stores the
result; what is wrong reaches Telegram through the ordinary 5-minute server
alerts (kind "files", ops_alerts.py): once when a problem appears and once
when it is gone, silenced with the other kinds in Ops → Server. A clean week
sends nothing.

The bot sends `maxAgeHours`, so a retry, a restart or a check made by hand
earlier that day doesn't list the bucket again. A failed request is retried
the next minute; after a success the week is remembered in memory.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .api import ApiError, ApiUnreachable, OsbotApi
from .digest import week_key
from .fmt import local
from .loops import every_minute

log = logging.getLogger(__name__)

CHECK_WEEKDAY = 0  # Monday
CHECK_HOUR = 4
# A run made in the last day (by hand, or before a restart) counts as this week's.
MAX_AGE_HOURS = 20


@dataclass
class FilesCheckMemory:
    """The week (its Monday) whose check is done."""

    done_week: str | None = None


def check_time(now: datetime) -> bool:
    """Monday from CHECK_HOUR on, in the bot's time zone."""
    at = local(now)
    return at.weekday() == CHECK_WEEKDAY and at.hour >= CHECK_HOUR


async def run(api: OsbotApi) -> dict[str, Any]:
    """{"ok": true, "ran": bool, "check": {...}} or {"ok": false, "error": "..."}."""
    return await api._request("POST", "/files-check/run", payload={"maxAgeHours": MAX_AGE_HOURS})


async def files_check_once(api: OsbotApi, memory: FilesCheckMemory, now: datetime | None = None) -> bool:
    """Runs this week's check once it is due. True when the app answered (ran or skipped)."""
    now = now or datetime.now(UTC)
    if not check_time(now):
        return False
    week = week_key(now)
    if memory.done_week == week:
        return False
    try:
        result = await run(api)
    except ApiError as error:
        if error.status < 500:
            # An app from before the files check (404) or a refused signature:
            # not worth a retry every minute until next week.
            log.warning("files check refused", extra={"status": error.status, "code": error.code})
            memory.done_week = week
        else:
            log.warning("files check failed", extra={"status": error.status})
        return False
    except ApiUnreachable:
        log.warning("files check: the app didn't answer; retrying next minute")
        return False
    memory.done_week = week
    if not result.get("ok"):
        # Storage isn't configured: nothing to check, nothing to say.
        log.info("files check skipped", extra={"reason": result.get("error")})
        return True
    check = result.get("check") or {}
    log.info("files check", extra={"ran": result.get("ran"), "status": check.get("status")})
    return True


def files_check_task(api: OsbotApi, memory: FilesCheckMemory | None = None, *, sleep=asyncio.sleep) -> asyncio.Task:
    memory = memory if memory is not None else FilesCheckMemory()
    return asyncio.create_task(
        every_minute(lambda: files_check_once(api, memory), name="files-check", sleep=sleep),
        name="files-check",
    )
