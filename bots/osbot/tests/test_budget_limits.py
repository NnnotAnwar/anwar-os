"""Budget limit alerts (osbot/budget_limits.py) with a fake bot and a fake API."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

from osbot import app, budget_limits
from osbot.config import Config

from .conftest import buttons

NBSP = " "
CHAT = 42
URL = "https://os.example/app/budget/limits"

FUN = {
    "key": "c1:2026-11:90",
    "keys": ["c1:2026-11:90"],
    "categoryId": "c1",
    "name": "Fun",
    "threshold": 90,
    "limitMinor": 100000,
    "spentMinor": 95000,
    "leftMinor": 5000,
    "percent": 95,
    "paceMinor": 220000,
    "currency": "CZK",
    "month": "2026-11",
}
FOOD = {
    "key": "c2:2026-11:100",
    "keys": ["c2:2026-11:90", "c2:2026-11:100"],
    "categoryId": "c2",
    "name": "Food <home>",
    "threshold": 100,
    "limitMinor": 600000,
    "spentMinor": 730000,
    "leftMinor": -130000,
    "percent": 121,
    "paceMinor": 900000,
    "currency": "CZK",
    "month": "2026-11",
}


def fake_api(items, *, fail_due: bool = False):
    acks: list[list[str]] = []

    async def request(method, path, *, params=None, payload=None):
        if path == "/budget-limits/due":
            assert method == "GET"
            if fail_due:
                raise RuntimeError("web down")
            return {"month": "2026-11", "items": items, "url": URL}
        if path == "/budget-limits/ack":
            assert method == "POST"
            acks.append(payload["keys"])
            return {"acked": len(payload["keys"])}
        raise AssertionError(path)

    return SimpleNamespace(_request=AsyncMock(side_effect=request), acks=acks)


def fake_bot(fail_on: str | None = None):
    async def send(chat_id, text, **kwargs):
        if fail_on and fail_on in text:
            raise RuntimeError("telegram down")
        return SimpleNamespace(message_id=1)

    return SimpleNamespace(send_message=AsyncMock(side_effect=send))


def test_ninety_percent_says_what_is_left_and_where_the_pace_ends():
    assert budget_limits.alert_text(FUN) == "\n".join(
        [
            "⚠️ <b>Fun: 95 % of the monthly limit</b>",
            f"950{NBSP}CZK of 1{NBSP}000{NBSP}CZK · 50{NBSP}CZK left",
            f"<i>At this pace: 2{NBSP}200{NBSP}CZK by the end of the month</i>",
        ]
    )
    # No pace line when the pace stays within the limit (or isn't known yet).
    assert "pace" not in budget_limits.alert_text({**FUN, "paceMinor": None})
    assert "pace" not in budget_limits.alert_text({**FUN, "paceMinor": 99000})


def test_used_up_says_by_how_much_and_escapes_the_name():
    assert budget_limits.alert_text(FOOD) == "\n".join(
        [
            "🔴 <b>Food &lt;home&gt;: monthly limit used up</b>",
            f"7{NBSP}300{NBSP}CZK of 6{NBSP}000{NBSP}CZK · over by 1{NBSP}300{NBSP}CZK",
        ]
    )
    exactly = {**FOOD, "spentMinor": 600000, "leftMinor": 0}
    assert budget_limits.alert_text(exactly).endswith("nothing left this month")


def test_keyboard_links_to_limits_when_the_url_is_public():
    assert buttons(budget_limits.alert_keyboard(URL)) == [("↗ Limits", URL)]
    assert budget_limits.alert_keyboard("http://web:3000/app/budget/limits") is None


async def test_sends_each_crossing_then_acks_all_its_keys():
    api, bot = fake_api([FUN, FOOD]), fake_bot()
    assert await budget_limits.limits_once(bot, api, CHAT) == 2
    texts = [c.args[1] for c in bot.send_message.call_args_list]
    assert [t.splitlines()[0] for t in texts] == ["⚠️ <b>Fun: 95 % of the monthly limit</b>", "🔴 <b>Food &lt;home&gt;: monthly limit used up</b>"]
    assert all(c.args[0] == CHAT for c in bot.send_message.call_args_list)
    # Food's 90 % key goes with its 100 % one: 90 % never follows.
    assert api.acks == [["c1:2026-11:90"], ["c2:2026-11:90", "c2:2026-11:100"]]


async def test_a_failed_send_is_not_acked_and_the_rest_still_go():
    api, bot = fake_api([FUN, FOOD]), fake_bot(fail_on="Fun")
    assert await budget_limits.limits_once(bot, api, CHAT) == 1
    assert api.acks == [["c2:2026-11:90", "c2:2026-11:100"]]


async def test_nothing_due_or_the_app_down_sends_nothing():
    bot = fake_bot()
    assert await budget_limits.limits_once(bot, fake_api([]), CHAT) == 0
    assert await budget_limits.limits_once(bot, fake_api([FUN], fail_due=True), CHAT) == 0
    bot.send_message.assert_not_awaited()


async def test_the_app_starts_the_limits_loop(monkeypatch):
    started = []

    def fake_limits(bot, api, chat_id):
        async def forever():
            started.append(chat_id)
            await asyncio.Event().wait()

        return asyncio.create_task(forever())

    def no_tasks(*args, **kwargs):
        return []

    def no_task(*args, **kwargs):
        return asyncio.create_task(asyncio.Event().wait())

    monkeypatch.setattr(app, "background_tasks", no_tasks)
    monkeypatch.setattr(app, "digest_tasks", no_tasks)
    monkeypatch.setattr(app, "ops_alerts_task", no_task)
    monkeypatch.setattr(app, "limits_task", fake_limits)

    class Dispatcher:
        def __init__(self):
            self._stop = asyncio.Event()

        async def start_polling(self, bot, **kwargs):
            await self._stop.wait()

        async def stop_polling(self):
            self._stop.set()

        def get(self, key, default=None):
            return default

    config = Config(bot_token="unused", api_url="http://web:3000", api_secret="x" * 32, owner_chat_id=CHAT, app_url="https://os.example")
    stop = asyncio.Event()

    task = asyncio.create_task(app._poll_until_stopped(AsyncMock(), Dispatcher(), SimpleNamespace(), config, datetime.now(UTC), stop))
    await asyncio.sleep(0.05)
    assert started == [CHAT]
    stop.set()
    await asyncio.wait_for(task, 2)
