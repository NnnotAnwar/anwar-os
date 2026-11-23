"""Reminder, feedback and heartbeat loops with a fake bot and a fake API."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import SendMessage

from osbot import loops
from osbot.snooze import ReminderMemory

from .conftest import buttons

NOW = datetime(2026, 11, 16, 12, 30, tzinfo=UTC)
CHAT = 42

DENTIST = {
    "keys": ["e1:2026-11-16T13:00:00.000Z:30"],
    "eventId": "e1",
    "title": "Dentist",
    "location": "",
    "allDay": False,
    "start": "2026-11-16T13:00:00.000Z",
    "end": "2026-11-16T14:00:00.000Z",
    "minutesBefore": 30,
    "dueAt": "2026-11-16T12:30:00.000Z",
    "when": "14:00",
    "url": "https://os.example/app/calendar?view=week&date=2026-11-16&event=e1",
}
STANDUP = {**DENTIST, "keys": ["e2:2026-11-16T12:35:00.000Z:5", "e2:2026-11-16T12:35:00.000Z:15"], "eventId": "e2", "title": "Standup", "start": "2026-11-16T12:35:00.000Z", "when": "13:35", "url": "http://web:3000/app/calendar"}


def fake_bot(fail_on: str | None = None):
    ids = iter(range(100, 200))

    async def send(chat_id, text, **kwargs):
        if fail_on and fail_on in text:
            raise RuntimeError("telegram down")
        return SimpleNamespace(message_id=next(ids))

    return SimpleNamespace(send_message=AsyncMock(side_effect=send))


async def test_reminders_are_sent_as_cards_then_acked():
    api = SimpleNamespace(reminders_due=AsyncMock(return_value=[DENTIST, STANDUP]), ack_reminders=AsyncMock(return_value=1))
    bot = fake_bot()
    memory = ReminderMemory()
    assert await loops.reminders_once(bot, api, CHAT, NOW, memory) == 2
    api.reminders_due.assert_awaited_once_with(NOW)
    calls = bot.send_message.call_args_list
    assert [c.args for c in calls] == [
        (CHAT, "⏰ <b>Dentist</b> in 30 min · 14:00"),
        (CHAT, "⏰ <b>Standup</b> in 5 min · 13:35"),
    ]
    # 30 min ahead: 10 min snooze fits, 1 h doesn't. Open in calendar when the link is public.
    assert buttons(calls[0].kwargs["reply_markup"]) == [
        ("💤 10 min", "rm:snz:10"),
        ("✓ Got it", "rm:ok:0"),
        ("↗ Open in calendar", DENTIST["url"]),
    ]
    # 5 min ahead: no snooze; an internal URL gets no button (Telegram would refuse it).
    assert buttons(calls[1].kwargs["reply_markup"]) == [("✓ Got it", "rm:ok:0")]
    assert [c.args[0] for c in api.ack_reminders.call_args_list] == [DENTIST["keys"], STANDUP["keys"]]
    assert memory.get(100)["title"] == "Dentist" and "keys" not in memory.get(100)


async def test_a_reminder_that_could_not_be_sent_is_not_acked():
    api = SimpleNamespace(reminders_due=AsyncMock(return_value=[DENTIST, STANDUP]), ack_reminders=AsyncMock(return_value=1))
    assert await loops.reminders_once(fake_bot(fail_on="Dentist"), api, CHAT, NOW) == 1
    assert [c.args[0] for c in api.ack_reminders.call_args_list] == [STANDUP["keys"]]


async def test_a_refused_keyboard_doesnt_block_the_reminder():
    bad = TelegramBadRequest(method=SendMessage(chat_id=1, text="x"), message="Bad Request: BUTTON_URL_INVALID")
    bot = SimpleNamespace(send_message=AsyncMock(side_effect=[bad, SimpleNamespace(message_id=5)]))
    api = SimpleNamespace(reminders_due=AsyncMock(return_value=[DENTIST]), ack_reminders=AsyncMock(return_value=1))
    assert await loops.reminders_once(bot, api, CHAT, NOW) == 1
    assert "reply_markup" not in bot.send_message.call_args_list[1].kwargs


async def test_snoozed_reminders_come_back_once():
    api = SimpleNamespace(reminders_due=AsyncMock(return_value=[]), ack_reminders=AsyncMock())
    memory = ReminderMemory()
    memory.snooze(DENTIST, NOW + timedelta(minutes=10))
    bot = fake_bot()
    assert await loops.reminders_once(bot, api, CHAT, NOW, memory) == 0
    later = NOW + timedelta(minutes=10)
    assert await loops.reminders_once(bot, api, CHAT, later, memory) == 1
    assert bot.send_message.call_args.args == (CHAT, "⏰ <b>Dentist</b> in 20 min · 14:00\n<i>💤 Snoozed</i>")
    assert await loops.reminders_once(bot, api, CHAT, later, memory) == 0
    api.ack_reminders.assert_not_awaited()  # the API already had it acked


async def test_api_outage_sends_nothing():
    api = SimpleNamespace(reminders_due=AsyncMock(side_effect=OSError("refused")), ack_reminders=AsyncMock())
    bot = fake_bot()
    assert await loops.reminders_once(bot, api, CHAT, NOW) == 0
    bot.send_message.assert_not_awaited()


async def test_feedback_alerts_are_sent_as_cards_then_acked():
    item = {
        "id": "f1",
        "kindLabel": "Thanks",
        "message": "Great site",
        "name": "Jana",
        "contact": None,
        "createdAt": "2026-11-16T12:00:00.000Z",
        "url": "https://os.example/app/feedback/f1",
    }
    api = SimpleNamespace(new_feedback=AsyncMock(return_value=[item]), ack_feedback=AsyncMock(return_value=1))
    bot = fake_bot()
    assert await loops.feedback_once(bot, api, CHAT, NOW) == 1
    call = bot.send_message.call_args
    assert call.args == (CHAT, "💬 <b>New feedback</b> · Thanks\n<blockquote>Great site</blockquote>\n— Jana · <i>13:00</i>")
    assert buttons(call.kwargs["reply_markup"]) == [
        ("↗ Open", "https://os.example/app/feedback/f1"),
        ("✓ Mark read", "fb:f1:read"),
        ("🚫 Spam", "fb:f1:spam"),
    ]
    api.ack_feedback.assert_awaited_once_with(["f1"])

    failing = fake_bot(fail_on="Great")
    api.ack_feedback.reset_mock()
    assert await loops.feedback_once(failing, api, CHAT, NOW) == 0
    api.ack_feedback.assert_not_awaited()


async def test_heartbeat_touches_the_health_file_only_on_success(tmp_path):
    health = tmp_path / "hb"
    api = SimpleNamespace(heartbeat=AsyncMock())
    assert await loops.heartbeat_once(api, "v1", NOW, health)
    assert health.exists()
    api.heartbeat.assert_awaited_once_with("v1", NOW)

    health.unlink()
    api.heartbeat = AsyncMock(side_effect=OSError("down"))
    assert not await loops.heartbeat_once(api, "v1", NOW, health)
    assert not health.exists()


def test_waits_until_just_after_the_next_minute():
    assert loops.seconds_to_next_minute(1_794_832_200.0) == 61.0  # exactly on the minute
    assert loops.seconds_to_next_minute(1_794_832_259.5) == 1.5


async def test_every_minute_survives_a_failing_step():
    steps = []

    async def step():
        steps.append(len(steps))
        if len(steps) == 1:
            raise RuntimeError("boom")

    sleeps = 0

    async def sleep(_seconds):
        nonlocal sleeps
        sleeps += 1
        if sleeps == 3:
            raise asyncio.CancelledError

    try:
        await loops.every_minute(step, name="test", sleep=sleep, wait=lambda: 0)
    except asyncio.CancelledError:
        pass
    assert steps == [0, 1, 2]
