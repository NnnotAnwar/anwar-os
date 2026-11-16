"""Heartbeat loop: updates bot_expenses.heartbeat every minute and touches a local file."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import Path

import asyncpg

from . import repo
from .config import HEARTBEAT_FILE, HEARTBEAT_INTERVAL_SECONDS

log = logging.getLogger(__name__)


async def beat_once(
    pool: asyncpg.Pool, bot_name: str, version: str, started_at: datetime, health_file: Path | None
) -> bool:
    try:
        await repo.beat(pool, bot_name, version, started_at)
    except Exception:
        log.warning("heartbeat write failed", exc_info=True)
        return False
    if health_file is not None:
        try:
            health_file.touch()
        except OSError:
            log.warning("could not touch heartbeat file", exc_info=True)
    return True


async def heartbeat_loop(
    pool: asyncpg.Pool,
    bot_name: str,
    version: str,
    started_at: datetime,
    *,
    interval: float = HEARTBEAT_INTERVAL_SECONDS,
    health_file: Path | None = HEARTBEAT_FILE,
) -> None:
    while True:
        await beat_once(pool, bot_name, version, started_at, health_file)
        await asyncio.sleep(interval)
