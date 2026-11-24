"""Server alerts loop (osbot/ops_alerts.py) with a fake bot and a fake API."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

from osbot import app, ops_alerts
from osbot.api import ApiError, ApiUnreachable
from osbot.config import Config
from osbot.fmt import set_timezone

from .conftest import buttons

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)
CHAT = 42
APP = "https://os.example"

DISK = {
    "key": "disk",
    "kind": "disk",
    "event": "firing",
    "title": "Disk 91 % full",
    "detail": "3.4 GB free of 38.0 GB on /. Docker uses 7.7 GB (images 7.0 GB).",
    "since": "2026-11-24T11:55:00.000Z",
}
BOT_DOWN = {
    "key": "container:bot-expenses",
    "kind": "container",
    "event": "firing",
    "title": "bot-expenses is down <oom>",
    "detail": "killed: out of memory · image tag abc1234.",
    "since": "2026-11-24T11:58:00.000Z",
}
DISK_OK = {**DISK, "event": "resolved", "since": "2026-11-24T11:59:00.000Z"}


def fake_api(*results):
    """`check` answers come from `results` in order (an exception is raised)."""
    answers = list(results)
    acks: list[dict] = []

    async def request(method, path, *, params=None, payload=None):
        if path == "/ops-alerts/check":
            assert method == "POST"
            answer = answers.pop(0)
            if isinstance(answer, BaseException):
                raise answer
            return answer
        if path == "/ops-alerts/ack":
            acks.extend(payload["items"])
            return {"acked": len(payload["items"])}
        raise AssertionError(path)

    return SimpleNamespace(_request=AsyncMock(side_effect=request), acks=acks)


def fake_bot(fail_on: str | None = None):
    async def send(chat_id, text, **kwargs):
        if fail_on and fail_on in text:
            raise RuntimeError("telegram down")
        return SimpleNamespace(message_id=1)

    return SimpleNamespace(send_message=AsyncMock(side_effect=send))


def setup_module():
    set_timezone("Europe/Prague")


async def test_sends_each_notification_then_acks_it():
    api = fake_api({"notifications": [DISK, BOT_DOWN, DISK_OK], "firing": [], "mutedUntil": None})
    bot = fake_bot()
    sent = await ops_alerts.ops_alerts_once(bot, api, CHAT, ops_alerts.WebHealth(), APP, NOW)
    assert sent == 3
    texts = [c.args[1] for c in bot.send_message.call_args_list]
    assert texts == [
        "🔴 💾 <b>Disk 91 % full</b>\n3.4 GB free of 38.0 GB on /. Docker uses 7.7 GB (images 7.0 GB).\n<i>Since 12:55</i>",
        "🔴 📦 <b>bot-expenses is down &lt;oom&gt;</b>\nkilled: out of memory · image tag abc1234.\n<i>Since 12:58</i>",
        "✅ <b>Resolved</b> · 💾 Disk 91 % full\n<i>Back to normal since 12:59.</i>",
    ]
    assert buttons(bot.send_message.call_args_list[0].kwargs["reply_markup"]) == [("↗ Open Ops", f"{APP}/app/ops#server")]
    assert api.acks == [
        {"key": "disk", "event": "firing"},
        {"key": "container:bot-expenses", "event": "firing"},
        {"key": "disk", "event": "resolved"},
    ]


async def test_an_alert_that_could_not_be_sent_is_not_acked():
    api = fake_api({"notifications": [DISK, BOT_DOWN]})
    assert await ops_alerts.ops_alerts_once(fake_bot(fail_on="Disk"), api, CHAT, ops_alerts.WebHealth(), APP, NOW) == 1
    assert api.acks == [{"key": "container:bot-expenses", "event": "firing"}]


async def test_no_link_button_for_an_internal_app_url():
    api = fake_api({"notifications": [DISK]})
    bot = fake_bot()
    await ops_alerts.ops_alerts_once(bot, api, CHAT, ops_alerts.WebHealth(), "http://web:3000", NOW)
    assert bot.send_message.call_args_list[0].kwargs["reply_markup"] is None


async def test_says_when_the_app_stops_answering_and_when_it_is_back():
    down = ApiUnreachable("POST /ops-alerts/check: ClientConnectorError")
    api = fake_api(down, ApiError(502, "error"), down, {"notifications": [DISK]})
    bot = fake_bot()
    health = ops_alerts.WebHealth()

    assert await ops_alerts.ops_alerts_once(bot, api, CHAT, health, APP, NOW) == 0
    bot.send_message.assert_not_awaited()  # one failure is a restart, not an outage
    await ops_alerts.ops_alerts_once(bot, api, CHAT, health, APP, NOW)
    await ops_alerts.ops_alerts_once(bot, api, CHAT, health, APP, NOW)
    texts = [c.args[1] for c in bot.send_message.call_args_list]
    assert texts == [ops_alerts.WEB_DOWN]  # once, not every check

    assert await ops_alerts.ops_alerts_once(bot, api, CHAT, health, APP, NOW) == 2
    texts = [c.args[1] for c in bot.send_message.call_args_list]
    assert texts[1] == ops_alerts.WEB_BACK and texts[2].startswith("🔴 💾 <b>Disk 91 % full</b>")
    assert health == ops_alerts.WebHealth()


async def test_a_refused_check_is_a_setup_problem_not_an_outage():
    api = fake_api(ApiError(401, "unauthorized"), ApiError(404, "not_found"), ApiError(401, "unauthorized"))
    bot = fake_bot()
    health = ops_alerts.WebHealth()
    for _ in range(3):
        assert await ops_alerts.ops_alerts_once(bot, api, CHAT, health, APP, NOW) == 0
    bot.send_message.assert_not_awaited()
    assert health.failures == 0


async def test_alert_text_without_a_time_or_detail():
    assert ops_alerts.alert_text({"kind": "weird", "event": "firing", "title": "Something", "detail": ""}, NOW) == "🔴 ⚠️ <b>Something</b>"
    assert ops_alerts.alert_text({"kind": "reboot", "event": "resolved", "title": "Reboot pending for 3 d", "since": "x"}, NOW) == (
        "✅ <b>Resolved</b> · 🔁 Reboot pending for 3 d"
    )


async def test_the_loop_runs_now_and_then_every_five_minutes(monkeypatch):
    calls = []

    async def once(*args):
        calls.append(args)
        if len(calls) == 2:
            raise asyncio.CancelledError

    waits = []

    async def no_sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr(ops_alerts, "ops_alerts_once", once)
    task = ops_alerts.ops_alerts_task(fake_bot(), fake_api(), CHAT, APP, sleep=no_sleep)
    try:
        await asyncio.wait_for(task, 1)
    except asyncio.CancelledError:
        pass
    assert len(calls) == 2
    assert 0 < waits[0] <= ops_alerts.CHECK_INTERVAL_SECONDS + 1


async def test_the_app_starts_the_alert_loop(monkeypatch):
    started = []

    def fake_alerts(bot, api, chat_id, app_url):
        async def forever():
            started.append((chat_id, app_url))
            await asyncio.Event().wait()

        return asyncio.create_task(forever())

    def fake_tasks(*args, **kwargs):
        return []

    monkeypatch.setattr(app, "background_tasks", fake_tasks)
    monkeypatch.setattr(app, "ops_alerts_task", fake_alerts)

    class Dispatcher:
        def __init__(self):
            self._stop = asyncio.Event()

        async def start_polling(self, bot, **kwargs):
            await self._stop.wait()

        async def stop_polling(self):
            self._stop.set()

    config = Config(bot_token="unused", api_url="http://web:3000", api_secret="x" * 32, owner_chat_id=CHAT, app_url=APP)
    stop = asyncio.Event()
    task = asyncio.create_task(app._poll_until_stopped(AsyncMock(), Dispatcher(), SimpleNamespace(), config, NOW, stop))
    await asyncio.sleep(0.05)
    assert started == [(CHAT, APP)]
    stop.set()
    await asyncio.wait_for(task, 2)
