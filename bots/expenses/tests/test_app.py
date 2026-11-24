"""Shutdown path of the polling loop, the dispatcher wiring and the heartbeat (no Telegram traffic)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

from expenses_bot import app, heartbeat
from expenses_bot.config import Config
from expenses_bot.middleware import OwnerOnlyMiddleware

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


CONFIG = Config(api_url="http://web:3000", api_secret="s" * 32, owner_id=42, bot_token="unused", version="v1")


async def test_stop_event_stops_polling_and_heartbeat(monkeypatch):
    beats = []

    async def fake_heartbeat(api, version, started_at):
        beats.append(version)
        await asyncio.Event().wait()  # runs until cancelled

    monkeypatch.setattr(app, "heartbeat_loop", fake_heartbeat)
    bot = AsyncMock()
    dp = FakeDispatcher()
    stop = asyncio.Event()

    task = asyncio.create_task(app._poll_until_stopped(bot, dp, object(), CONFIG, datetime.now(UTC), stop))
    await asyncio.sleep(0.05)
    assert beats == ["v1"]
    bot.delete_webhook.assert_awaited_once_with(drop_pending_updates=False)

    stop.set()  # what the SIGTERM handler does
    await asyncio.wait_for(task, 2)
    assert dp.stopped


def test_build_dispatcher_wires_api_owner_and_routers():
    api = object()
    dp = fresh_dispatcher(api, owner_id=7)
    assert dp["api"] is api
    (middleware,) = [m for m in dp.update.outer_middleware if isinstance(m, OwnerOnlyMiddleware)]
    assert middleware.owner_id == 7
    assert [r.name for r in dp.sub_routers] == ["commands", "subscriptions", "limits", "entries", "receipt", "expense", "fallback"]


async def test_heartbeat_touches_the_health_file_only_when_budget_accepted_it(budget, tmp_path):
    health = tmp_path / "beat"
    started = datetime(2026, 11, 23, 8, 0, tzinfo=UTC)
    assert await heartbeat.beat_once(budget.api, "v2", started, health) is True
    assert health.exists() and budget.fake.beats[-1]["version"] == "v2"

    health.unlink()
    budget.fake.fail["/heartbeat"] = (401, {"error": "unauthorized"})
    assert await heartbeat.beat_once(budget.api, "v2", started, health) is False
    assert not health.exists()
