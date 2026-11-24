"""Weekly files storage check (osbot/files_check.py) with a fake API."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from osbot import app, files_check
from osbot.api import ApiError, ApiUnreachable
from osbot.config import Config
from osbot.fmt import set_timezone, zone

# 2026-11-30 is a Monday; Europe/Prague is UTC+1 in winter.
MONDAY_0430 = datetime(2026, 11, 30, 3, 30, tzinfo=UTC)
MONDAY_0330 = datetime(2026, 11, 30, 2, 30, tzinfo=UTC)
SUNDAY_2300 = datetime(2026, 11, 29, 22, 0, tzinfo=UTC)

OK = {"ok": True, "ran": True, "check": {"status": "ok", "checkedAt": "2026-11-30T03:30:00.000Z"}}


@pytest.fixture(autouse=True)
def prague():
    before = zone().key
    set_timezone("Europe/Prague")
    yield
    set_timezone(before)


def fake_api(*answers):
    queue = list(answers)
    calls: list[dict] = []

    async def request(method, path, *, params=None, payload=None):
        assert (method, path) == ("POST", "/files-check/run")
        calls.append(payload)
        answer = queue.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return answer

    return SimpleNamespace(_request=AsyncMock(side_effect=request), calls=calls)


def test_runs_on_monday_from_four_in_the_bot_time_zone():
    assert files_check.check_time(MONDAY_0430)
    assert not files_check.check_time(MONDAY_0330)
    assert not files_check.check_time(SUNDAY_2300)
    assert not files_check.check_time(MONDAY_0430 + timedelta(days=1))


async def test_runs_once_a_week_and_asks_the_app_to_skip_a_fresh_run():
    api = fake_api(OK)
    memory = files_check.FilesCheckMemory()
    assert await files_check.files_check_once(api, memory, MONDAY_0430)
    assert api.calls == [{"maxAgeHours": files_check.MAX_AGE_HOURS}]
    # The rest of Monday: nothing more.
    assert not await files_check.files_check_once(api, memory, MONDAY_0430 + timedelta(hours=5))
    assert len(api.calls) == 1


async def test_waits_for_its_hour():
    api = fake_api()
    assert not await files_check.files_check_once(api, files_check.FilesCheckMemory(), MONDAY_0330)
    assert api.calls == []


async def test_an_unreachable_or_failing_app_is_retried_next_minute():
    api = fake_api(ApiUnreachable("down"), ApiError(502, "bad_gateway"), OK)
    memory = files_check.FilesCheckMemory()
    assert not await files_check.files_check_once(api, memory, MONDAY_0430)
    assert not await files_check.files_check_once(api, memory, MONDAY_0430 + timedelta(minutes=1))
    assert await files_check.files_check_once(api, memory, MONDAY_0430 + timedelta(minutes=2))
    assert len(api.calls) == 3


async def test_a_refusal_is_not_retried_all_week():
    api = fake_api(ApiError(404, "not_found"))
    memory = files_check.FilesCheckMemory()
    assert not await files_check.files_check_once(api, memory, MONDAY_0430)
    assert not await files_check.files_check_once(api, memory, MONDAY_0430 + timedelta(minutes=1))
    assert len(api.calls) == 1


async def test_storage_not_configured_counts_as_done():
    api = fake_api({"ok": False, "error": "File storage isn't configured."})
    memory = files_check.FilesCheckMemory()
    assert await files_check.files_check_once(api, memory, MONDAY_0430)
    assert memory.done_week == "2026-11-30"


async def test_the_next_week_runs_again():
    api = fake_api(OK, OK)
    memory = files_check.FilesCheckMemory()
    assert await files_check.files_check_once(api, memory, MONDAY_0430)
    assert await files_check.files_check_once(api, memory, MONDAY_0430 + timedelta(days=7))
    assert len(api.calls) == 2


async def test_the_app_starts_the_files_check_loop(monkeypatch):
    started = []

    def fake_check(api):
        async def forever():
            started.append(api)
            await asyncio.Event().wait()

        return asyncio.create_task(forever())

    def no_tasks(*args, **kwargs):
        return []

    async def never(*args, **kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(app, "background_tasks", no_tasks)
    monkeypatch.setattr(app, "digest_tasks", no_tasks)
    monkeypatch.setattr(app, "ops_alerts_task", lambda *a: asyncio.create_task(never()))
    monkeypatch.setattr(app, "files_check_task", fake_check)

    class Dispatcher:
        def __init__(self):
            self._stop = asyncio.Event()

        async def start_polling(self, bot, **kwargs):
            await self._stop.wait()

        async def stop_polling(self):
            self._stop.set()

        def get(self, key, default=None):
            return default

    api = SimpleNamespace()
    config = Config(bot_token="unused", api_url="http://web:3000", api_secret="x" * 32, owner_chat_id=1)
    stop = asyncio.Event()
    task = asyncio.create_task(app._poll_until_stopped(AsyncMock(), Dispatcher(), api, config, MONDAY_0430, stop))
    await asyncio.sleep(0.05)
    assert started == [api]
    stop.set()
    await asyncio.wait_for(task, 2)
