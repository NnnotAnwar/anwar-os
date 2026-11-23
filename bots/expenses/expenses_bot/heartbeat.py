"""Heartbeat loop: tells the web app the bot is alive every minute and touches a local file.

The beat goes to /api/internal/budget-bot/heartbeat (shown in the Bots panel); the file
is touched only when the web app accepted it, so the Docker HEALTHCHECK is healthy only
while token, secret, internal network and owner account all work.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import Path

from .api import BudgetApi
from .config import HEARTBEAT_FILE, HEARTBEAT_INTERVAL_SECONDS

log = logging.getLogger(__name__)


async def beat_once(api: BudgetApi, version: str, started_at: datetime, health_file: Path | None) -> bool:
    try:
        await api.heartbeat(version, started_at)
    except Exception as exc:
        log.warning("heartbeat failed", extra={"error": f"{type(exc).__name__}: {exc}"})
        return False
    if health_file is not None:
        try:
            health_file.touch()
        except OSError:
            log.warning("could not touch heartbeat file", exc_info=True)
    return True


async def heartbeat_loop(
    api: BudgetApi,
    version: str,
    started_at: datetime,
    *,
    interval: float = HEARTBEAT_INTERVAL_SECONDS,
    health_file: Path | None = HEARTBEAT_FILE,
) -> None:
    while True:
        await beat_once(api, version, started_at, health_file)
        await asyncio.sleep(interval)
