"""Shutdown path of the polling loop, with a fake dispatcher (no Telegram traffic)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

from expenses_bot import app
from expenses_bot.config import Config

from .tg import fresh_dispatcher


class FakeDispatcher:
    def __init__(self):
        self._stop = asyncio.Event()
        self.stopped = False

    async def start_polling(self, bot, **kwargs):
        assert kwargs["handle_signals"] is False
        await self._stop.wait()

    async def stop_polling(self):
        self.stopped = True
        self._stop.set()


async def test_stop_event_stops_polling_and_heartbeat(monkeypatch):
    beats = []

    async def fake_heartbeat(pool, name, version, started_at):
        beats.append(version)
        await asyncio.Event().wait()  # runs until cancelled

    monkeypatch.setattr(app, "heartbeat_loop", fake_heartbeat)
    bot = AsyncMock()
    dp = FakeDispatcher()
    stop = asyncio.Event()
    config = Config(database_url="postgresql://unused", bot_token="unused", version="v1")

    task = asyncio.create_task(app._poll_until_stopped(bot, dp, object(), config, datetime.now(UTC), stop))
    await asyncio.sleep(0.05)
    assert beats == ["v1"]
    bot.delete_webhook.assert_awaited_once_with(drop_pending_updates=False)

    stop.set()  # what the SIGTERM handler does
    await asyncio.wait_for(task, 2)
    assert dp.stopped


def test_build_dispatcher_wires_pool_and_routers():
    pool = object()
    dp = fresh_dispatcher(pool)
    assert dp["pool"] is pool
    assert [r.name for r in dp.sub_routers] == ["commands", "entries", "expense", "fallback"]
