"""Error alerts (kind "errors", ops_alerts.py) and the bot's own error reports (error_report.py)."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

from osbot import error_report, ops_alerts
from osbot.api import ApiUnreachable
from osbot.fmt import set_timezone

from .conftest import APP_URL as APP
from .conftest import FEEDBACK_ID, Tg, bot_message, buttons

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)
CHAT = 42
E1 = "11111111-1111-4111-8111-111111111111"
E2 = "22222222-2222-4222-8222-222222222222"

NEW = {
    "id": E1,
    "event": "new",
    "name": "TypeError",
    "message": "Cannot read properties of undefined (reading 'title')",
    "where": "GET /app/notes/[id]",
    "count": 3,
    "lastSeen": "2026-11-24T11:59:00.000Z",
}
BACK = {**NEW, "id": E2, "event": "reopened", "name": "Error", "message": "<b>boom</b>", "where": "osbot · ops-alerts", "count": 12}


def fake_api(check: dict):
    acks: list[list[str]] = []
    server_acks: list[dict] = []

    async def request(method, path, *, params=None, payload=None):
        if path == "/ops-alerts/check":
            return check
        if path == "/ops-alerts/ack":
            server_acks.extend(payload["items"])
            return {"acked": len(payload["items"])}
        if path == "/ops-alerts/errors/ack":
            acks.append(payload["ids"])
            return {"acked": len(payload["ids"])}
        raise AssertionError(path)

    return SimpleNamespace(_request=AsyncMock(side_effect=request), acks=acks, server_acks=server_acks)


def fake_bot(fail_on: str | None = None):
    async def send(chat_id, text, **kwargs):
        if fail_on and fail_on in text:
            raise RuntimeError("telegram down")
        return SimpleNamespace(message_id=1)

    return SimpleNamespace(send_message=AsyncMock(side_effect=send))


def setup_module():
    set_timezone("Europe/Prague")


async def test_each_new_or_returning_error_is_one_message_with_open_and_resolve():
    api = fake_api({"notifications": [], "errors": {"items": [NEW, BACK], "summary": None, "held": 0}})
    bot = fake_bot()
    assert await ops_alerts.ops_alerts_once(bot, api, CHAT, ops_alerts.WebHealth(), APP, NOW) == 2
    texts = [c.args[1] for c in bot.send_message.call_args_list]
    assert texts == [
        "🐞 <b>New error</b>: TypeError: Cannot read properties of undefined (reading 'title') · GET /app/notes/[id] · ×3",
        "🐞 <b>Error again</b>: Error: &lt;b&gt;boom&lt;/b&gt; · osbot · ops-alerts · ×12",
    ]
    assert buttons(bot.send_message.call_args_list[0].kwargs["reply_markup"]) == [
        ("↗ Open", f"{APP}/app/ops#error-{E1}"),
        ("✓ Resolve", f"er:{E1}:resolved"),
    ]
    assert api.acks == [[E1], [E2]]


async def test_the_rest_comes_as_one_summary_acked_together():
    summary = {"ids": [E1, E2, FEEDBACK_ID], "count": 7, "titles": ["A: one", "B: two"]}
    api = fake_api({"notifications": [], "errors": {"items": [], "summary": summary, "held": 0}})
    bot = fake_bot()
    assert await ops_alerts.ops_alerts_once(bot, api, CHAT, ops_alerts.WebHealth(), APP, NOW) == 1
    text = bot.send_message.call_args_list[0].args[1]
    assert text.startswith("🐞 <b>7 more errors</b> (new or back)\n• A: one\n• B: two")
    assert text.endswith("<i>…and 2 more in Ops → Errors</i>")
    assert buttons(bot.send_message.call_args_list[0].kwargs["reply_markup"]) == [("↗ Open errors", f"{APP}/app/ops#errors")]
    assert api.acks == [[E1, E2, FEEDBACK_ID]]


async def test_an_error_alert_that_could_not_be_sent_is_not_acked():
    api = fake_api({"notifications": [], "errors": {"items": [NEW, BACK], "summary": None, "held": 0}})
    assert await ops_alerts.ops_alerts_once(fake_bot(fail_on="New error"), api, CHAT, ops_alerts.WebHealth(), APP, NOW) == 1
    assert api.acks == [[E2]]


async def test_an_app_without_the_error_log_sends_nothing_extra():
    api = fake_api({"notifications": []})
    bot = fake_bot()
    assert await ops_alerts.ops_alerts_once(bot, api, CHAT, ops_alerts.WebHealth(), APP, NOW) == 0
    bot.send_message.assert_not_awaited()


async def test_new_kinds_have_icons():
    assert ops_alerts.alert_text({"kind": "drill", "event": "firing", "title": "Restore drill failed", "detail": ""}, NOW) == (
        "🔴 🧪 <b>Restore drill failed</b>"
    )


def test_footer_comes_and_goes():
    card = "🐞 <b>New error</b>: x · ×1"
    resolved = ops_alerts.with_error_footer(card, "resolved")
    assert resolved == card + "\n\n<i>✓ Resolved</i>"
    assert ops_alerts.with_error_footer(resolved, "resolved") == resolved
    assert ops_alerts.with_error_footer(resolved, "open") == card


# --- the Resolve button ----------------------------------------------------------------


async def test_resolve_and_undo_from_telegram(tg: Tg):
    tg.api.error_status = AsyncMock(return_value={"id": E1, "status": "resolved", "previous": "open"})
    card = bot_message(
        "🐞 New error: TypeError: x · GET /app · ×3",
        entities=[{"type": "bold", "offset": 3, "length": 9}],
        reply_markup={"inline_keyboard": [[{"text": "↗ Open", "url": f"https://os.example/app/ops#error-{E1}"}]]},
    )
    await tg.press(f"er:{E1}:resolved", message=card)
    tg.api.error_status.assert_awaited_once_with(E1, "resolved")
    edited = tg.session.last("EditMessageText")
    assert edited.text.startswith("🐞 <b>New error</b>")
    assert edited.text.endswith("\n\n<i>✓ Resolved</i>")
    assert buttons(edited.reply_markup) == [("↗ Open", f"https://os.example/app/ops#error-{E1}"), ("↩ Undo", f"er:{E1}:open")]
    assert tg.toast().text == "✓ Resolved"


async def test_resolving_an_error_that_is_gone(tg: Tg):
    from osbot.api import ApiError

    tg.api.error_status = AsyncMock(side_effect=ApiError(404, "gone", "That error isn't in the log any more."))
    await tg.press(f"er:{E1}:resolved")
    assert tg.toast().show_alert and "isn't in the log" in tg.toast().text


# --- reporting the bot's own exceptions ------------------------------------------------------


def _record(level=logging.ERROR, exc: BaseException | None = None, **extra) -> logging.LogRecord:
    exc_info = None
    if exc is not None:
        try:
            raise exc
        except BaseException as caught:  # noqa: BLE001 - building a record
            exc_info = (type(caught), caught, caught.__traceback__)
    record = logging.LogRecord("osbot.loops", level, __file__, 1, "loop step failed", (), exc_info)
    for k, v in extra.items():
        setattr(record, k, v)
    return record


def test_payload_only_for_errors_with_an_exception():
    assert error_report.report_payload(_record(logging.WARNING, ValueError("x"))) is None
    assert error_report.report_payload(_record(logging.ERROR)) is None
    p = error_report.report_payload(_record(exc=KeyError("title"), loop="ops-alerts"))
    assert p is not None
    assert p["name"] == "KeyError" and p["message"] == "'title'" and p["where"] == "ops-alerts"
    assert p["stack"].startswith("Traceback (most recent call last)") and "KeyError" in p["stack"]


async def test_reports_in_the_background_with_limits():
    sent: list[dict] = []

    async def request(method, path, *, params=None, payload=None):
        assert (method, path) == ("POST", "/errors/report")
        sent.append(payload)
        return {"recorded": True}

    clock = [100.0]
    reporter = error_report.ErrorReporter(SimpleNamespace(_request=request), clock=lambda: clock[0])
    reporter.emit(_record(exc=ValueError("boom"), loop="a"))
    reporter.emit(_record(exc=ValueError("boom"), loop="a"))  # same error within a minute: once
    for i in range(20):
        reporter.emit(_record(exc=ValueError(f"other {i}"), loop="b"))
    await reporter.drain()
    assert len(sent) == error_report.MAX_PER_MINUTE
    assert sent[0]["message"] == "boom"

    clock[0] += 61
    reporter.emit(_record(exc=ValueError("boom"), loop="a"))
    await reporter.drain()
    assert len(sent) == error_report.MAX_PER_MINUTE + 1


async def test_a_failed_report_is_a_warning_and_never_reported_again(caplog):
    calls = 0

    async def request(*args, **kwargs):
        nonlocal calls
        calls += 1
        raise ApiUnreachable("down")

    reporter = error_report.ErrorReporter(SimpleNamespace(_request=request))
    root = logging.getLogger()
    root.addHandler(reporter)
    try:
        with caplog.at_level(logging.WARNING):
            logging.getLogger("osbot.loops").error("loop step failed", exc_info=RuntimeError("x"))
            await reporter.drain()
            await asyncio.sleep(0)
    finally:
        root.removeHandler(reporter)
    assert calls == 1
    assert any(r.name == "osbot.error_report" and r.levelno == logging.WARNING and not r.exc_info for r in caplog.records)
