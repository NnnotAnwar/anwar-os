"""Owner gate, dispatcher wiring and the shutdown path (no Telegram traffic)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from aiogram.types import BotDescription, BotShortDescription, CallbackQuery, Message, Update

from osbot import app, texts
from osbot.config import Config
from osbot.digest import WeeklyMemory
from osbot.middleware import OwnerOnlyMiddleware
from osbot.snooze import ReminderMemory
from osbot.texts import NOT_OWNER

OWNER = 42


def message_update(chat_id: int) -> Update:
    return Update.model_validate(
        {
            "update_id": 1,
            "message": {
                "message_id": 1,
                "date": 0,
                "chat": {"id": chat_id, "type": "private"},
                "from": {"id": chat_id, "is_bot": False, "first_name": "X"},
                "text": "hi",
            },
        }
    )


async def test_owner_messages_pass_through():
    handler = AsyncMock(return_value="handled")
    update = message_update(OWNER)
    result = await OwnerOnlyMiddleware(OWNER)(handler, update, {"event_chat": update.message.chat})
    assert result == "handled"
    handler.assert_awaited_once()


async def test_everyone_else_gets_a_polite_refusal():
    handler = AsyncMock()
    update = message_update(7)
    with patch.object(Message, "answer", AsyncMock()) as answer:
        result = await OwnerOnlyMiddleware(OWNER)(handler, update, {"event_chat": update.message.chat})
    assert result is None
    handler.assert_not_awaited()
    answer.assert_awaited_once_with(NOT_OWNER)


async def test_groups_get_no_reply_at_all():
    handler = AsyncMock()
    update = Update.model_validate(
        {
            "update_id": 3,
            "message": {
                "message_id": 1,
                "date": 0,
                "chat": {"id": -100123, "type": "supergroup", "title": "G"},
                "from": {"id": OWNER, "is_bot": False, "first_name": "X"},
                "text": "/today",
            },
        }
    )
    with patch.object(Message, "answer", AsyncMock()) as answer:
        result = await OwnerOnlyMiddleware(OWNER)(handler, update, {"event_chat": update.message.chat})
    assert result is None
    handler.assert_not_awaited()
    answer.assert_not_awaited()


async def test_foreign_button_presses_are_refused_too():
    update = Update.model_validate(
        {
            "update_id": 2,
            "callback_query": {
                "id": "c1",
                "chat_instance": "x",
                "from": {"id": 7, "is_bot": False, "first_name": "X"},
                "data": "cap:note",
                "message": {"message_id": 1, "date": 0, "chat": {"id": 7, "type": "private"}, "text": "Save this?"},
            },
        }
    )
    handler = AsyncMock()
    with patch.object(CallbackQuery, "answer", AsyncMock()) as answer:
        await OwnerOnlyMiddleware(OWNER)(handler, update, {"event_chat": update.callback_query.message.chat})
    handler.assert_not_awaited()
    answer.assert_awaited_once_with(NOT_OWNER, show_alert=True)


async def test_updates_without_a_chat_are_dropped():
    handler = AsyncMock()
    await OwnerOnlyMiddleware(OWNER)(handler, SimpleNamespace(), {})
    handler.assert_not_awaited()


def test_build_dispatcher_wires_api_targets_and_routers():
    api = SimpleNamespace()
    dp = app.build_dispatcher(api, OWNER, app_url="https://os.example")
    assert dp["api"] is api
    assert dp["targets"].default == "inbox"
    assert dp["app_url"] == "https://os.example"
    assert isinstance(dp["reminders"], ReminderMemory)
    assert isinstance(dp["weekly"], WeeklyMemory)
    assert [r.name for r in dp.sub_routers] == ["menu", "today", "weekly", "monthly", "habits", "alerts", "capture", "fallback"]
    # Routers are built per dispatcher, so a second one works too.
    assert len(app.build_dispatcher(api, OWNER).sub_routers) == 8


async def test_profile_is_only_written_when_it_differs():
    bot = AsyncMock()
    bot.get_my_commands.return_value = app.COMMANDS
    bot.get_my_short_description.return_value = BotShortDescription(short_description=texts.SHORT_DESCRIPTION)
    bot.get_my_description.return_value = BotDescription(description="old")
    await app.set_up_profile(bot)
    bot.set_my_commands.assert_not_awaited()
    bot.set_my_short_description.assert_not_awaited()
    bot.set_my_description.assert_awaited_once_with(description=texts.DESCRIPTION)

    # One failing call doesn't stop the others (or the bot).
    bot = AsyncMock()
    bot.get_my_commands.side_effect = RuntimeError("telegram down")
    bot.get_my_short_description.return_value = BotShortDescription(short_description="old")
    await app.set_up_profile(bot)
    bot.set_my_short_description.assert_awaited_once()
    assert all(len(c.description) <= 256 and c.command.islower() for c in app.COMMANDS)


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

    def get(self, key, default=None):
        return default


async def test_stop_event_stops_polling_and_loops(monkeypatch):
    started = []

    def fake_tasks(bot, api, chat_id, version, started_at, reminders=None):
        async def forever():
            started.append((chat_id, version))
            await asyncio.Event().wait()

        return [asyncio.create_task(forever())]

    monkeypatch.setattr(app, "background_tasks", fake_tasks)
    bot = AsyncMock()
    dp = FakeDispatcher()
    stop = asyncio.Event()
    config = Config(bot_token="unused", api_url="http://web:3000", api_secret="x" * 32, owner_chat_id=OWNER, version="v1")

    task = asyncio.create_task(app._poll_until_stopped(bot, dp, SimpleNamespace(), config, datetime.now(UTC), stop))
    await asyncio.sleep(0.05)
    assert started == [(OWNER, "v1")]
    bot.delete_webhook.assert_awaited_once_with(drop_pending_updates=False)
    bot.set_my_commands.assert_awaited_once()

    stop.set()  # what the SIGTERM handler does
    await asyncio.wait_for(task, 2)
    assert dp.stopped
