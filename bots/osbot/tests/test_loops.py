"""Reminder, feedback and heartbeat loops with a fake bot and a fake API."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

from osbot import loops

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
}
STANDUP = {**DENTIST, "keys": ["e2:2026-11-16T12:35:00.000Z:5", "e2:2026-11-16T12:35:00.000Z:15"], "eventId": "e2", "title": "Standup", "start": "2026-11-16T12:35:00.000Z", "when": "13:35"}


def fake_bot(fail_on: str | None = None):
    async def send(chat_id, text, **kwargs):
        if fail_on and fail_on in text:
            raise RuntimeError("telegram down")

    return SimpleNamespace(send_message=AsyncMock(side_effect=send))


async def test_reminders_are_sent_then_acked():
    api = SimpleNamespace(reminders_due=AsyncMock(return_value=[DENTIST, STANDUP]), ack_reminders=AsyncMock(return_value=1))
    bot = fake_bot()
    assert await loops.reminders_once(bot, api, CHAT, NOW) == 2
    api.reminders_due.assert_awaited_once_with(NOW)
    assert [c.args for c in bot.send_message.call_args_list] == [
        (CHAT, "⏰ Dentist in 30 min · 14:00"),
        (CHAT, "⏰ Standup in 5 min · 13:35"),
    ]
    assert [c.args[0] for c in api.ack_reminders.call_args_list] == [DENTIST["keys"], STANDUP["keys"]]


async def test_a_reminder_that_could_not_be_sent_is_not_acked():
    api = SimpleNamespace(reminders_due=AsyncMock(return_value=[DENTIST, STANDUP]), ack_reminders=AsyncMock(return_value=1))
    assert await loops.reminders_once(fake_bot(fail_on="Dentist"), api, CHAT, NOW) == 1
    assert [c.args[0] for c in api.ack_reminders.call_args_list] == [STANDUP["keys"]]


async def test_api_outage_sends_nothing():
    api = SimpleNamespace(reminders_due=AsyncMock(side_effect=OSError("refused")), ack_reminders=AsyncMock())
    bot = fake_bot()
    assert await loops.reminders_once(bot, api, CHAT, NOW) == 0
    bot.send_message.assert_not_awaited()


async def test_feedback_alerts_are_sent_then_acked():
    item = {"id": "f1", "kindLabel": "Thanks", "message": "Great site", "name": "Jana", "contact": None, "url": "https://os/app/feedback/f1"}
    api = SimpleNamespace(new_feedback=AsyncMock(return_value=[item]), ack_feedback=AsyncMock(return_value=1))
    bot = fake_bot()
    assert await loops.feedback_once(bot, api, CHAT) == 1
    assert bot.send_message.call_args.args == (CHAT, "💬 New feedback · Thanks\n\nGreat site\n\n— Jana\nhttps://os/app/feedback/f1")
    api.ack_feedback.assert_awaited_once_with(["f1"])

    failing = fake_bot(fail_on="Great")
    api.ack_feedback.reset_mock()
    assert await loops.feedback_once(failing, api, CHAT) == 0
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
