"""A real Dispatcher and Bot with Telegram faked at the session level.

`tg` feeds updates through the whole stack (owner middleware, routers,
filters, callback data parsing, dependency injection) and records every Bot API
call instead of sending it. The web API is an AsyncMock-based fake.
"""

from __future__ import annotations

import itertools
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.enums import ParseMode
from aiogram.methods import TelegramMethod
from aiogram.types import Message, Update

from osbot import app
from osbot.snooze import ReminderMemory

OWNER = 42
BOT_ID = 777
APP_URL = "https://os.example"

TASK_ID = "11111111-1111-4111-8111-111111111111"
TASK2_ID = "22222222-2222-4222-8222-222222222222"
NOTE_ID = "33333333-3333-4333-8333-333333333333"
FEEDBACK_ID = "44444444-4444-4444-8444-444444444444"

TARGETS = {
    "default": "inbox",
    "targets": [
        {"kind": "inbox", "label": "Inbox", "button": "Save to Inbox", "needsUrl": False},
        {"kind": "task", "label": "Task", "button": "Save as task", "needsUrl": False},
        {"kind": "note", "label": "Note", "button": "Save as note", "needsUrl": False},
        {"kind": "link", "label": "Link", "button": "Save as link", "needsUrl": True},
        {"kind": "idea", "label": "Idea", "button": "Save as idea", "needsUrl": False},
    ],
}
SAVED = {"kind": "note", "id": NOTE_ID, "title": "Milk", "url": "https://os.example/app/notes/1", "duplicate": False}
TODAY = {
    "date": "Monday 16 Nov",
    "timezone": "Europe/Prague",
    "events": [{"title": "Dentist", "location": "", "allDay": False, "start": "", "end": "", "time": "14:00 – 15:00"}],
    "tasks": [
        {"id": TASK_ID, "title": "Pay rent", "overdue": True, "dueDate": "2026-11-14", "time": None, "url": f"https://os.example/app/tasks?task={TASK_ID}"},
        {"id": TASK2_ID, "title": "Call the bank", "overdue": False, "dueDate": "2026-11-16", "time": "10:00", "url": f"https://os.example/app/tasks?task={TASK2_ID}"},
    ],
    "tasksTotal": 2,
    "newFeedback": 0,
    "url": "https://os.example/app/calendar",
}


def fake_api(**overrides: Any) -> SimpleNamespace:
    api = SimpleNamespace(
        capture=AsyncMock(return_value=SAVED),
        undo_capture=AsyncMock(return_value=None),
        capture_targets=AsyncMock(return_value=TARGETS),
        today=AsyncMock(return_value=TODAY),
        task_action=AsyncMock(),
        feedback_status=AsyncMock(),
    )
    for name, value in overrides.items():
        setattr(api, name, value)
    return api


class FakeSession(BaseSession):
    """Records Bot API calls; answers each with a plausible result."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod[Any]] = []
        self.fail: dict[str, Exception] = {}
        self._ids = itertools.count(1000)

    async def close(self) -> None:
        pass

    async def stream_content(self, *args: Any, **kwargs: Any):  # pragma: no cover
        raise NotImplementedError
        yield b""

    async def make_request(self, bot: Bot, method: TelegramMethod[Any], timeout: int | None = None) -> Any:
        self.calls.append(method)
        name = type(method).__name__
        if name in self.fail:
            raise self.fail[name]
        if name in ("SendMessage", "EditMessageText"):
            return Message.model_validate(
                {
                    "message_id": getattr(method, "message_id", None) or next(self._ids),
                    "date": 0,
                    "chat": {"id": OWNER, "type": "private"},
                    "from": {"id": BOT_ID, "is_bot": True, "first_name": "osbot"},
                    "text": method.text,
                }
            )
        return True

    def of(self, name: str) -> list[Any]:
        return [c for c in self.calls if type(c).__name__ == name]

    def last(self, name: str) -> Any:
        found = self.of(name)
        assert found, f"no {name} among {[type(c).__name__ for c in self.calls]}"
        return found[-1]


class Tg:
    def __init__(self, api: SimpleNamespace):
        self.api = api
        self.session = FakeSession()
        self.bot = Bot("42:TEST", session=self.session, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
        self.reminders = ReminderMemory()
        self.dp = app.build_dispatcher(api, OWNER, app_url=APP_URL, reminders=self.reminders)
        self._update_ids = itertools.count(1)

    async def feed(self, update: dict[str, Any]) -> None:
        await self.dp.feed_update(self.bot, Update.model_validate({"update_id": next(self._update_ids), **update}, context={"bot": self.bot}))

    async def send(self, text: str | None = None, *, chat_id: int = OWNER, reply_to: dict | None = None, **extra: Any) -> None:
        message: dict[str, Any] = {
            "message_id": 1,
            "date": int(datetime(2026, 11, 16, tzinfo=UTC).timestamp()),
            "chat": {"id": chat_id, "type": "private"},
            "from": {"id": chat_id, "is_bot": False, "first_name": "Anwar"},
            **extra,
        }
        if text is not None:
            message["text"] = text
            if text.startswith("/"):
                message["entities"] = [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}]
        if reply_to is not None:
            message["reply_to_message"] = reply_to
        await self.feed({"message": message})

    async def press(self, data: str, *, message: dict | None = None, chat_id: int = OWNER) -> None:
        await self.feed(
            {
                "callback_query": {
                    "id": "cb1",
                    "chat_instance": "ci",
                    "from": {"id": chat_id, "is_bot": False, "first_name": "Anwar"},
                    "data": data,
                    "message": message or bot_message("card", chat_id=chat_id),
                }
            }
        )

    def toast(self) -> Any:
        return self.session.last("AnswerCallbackQuery")


def user_message(text: str, message_id: int = 1, **extra: Any) -> dict[str, Any]:
    return {
        "message_id": message_id,
        "date": 1,
        "chat": {"id": OWNER, "type": "private"},
        "from": {"id": OWNER, "is_bot": False, "first_name": "Anwar"},
        "text": text,
        **extra,
    }


def bot_message(text: str, *, reply_to: dict | None = None, chat_id: int = OWNER, message_id: int = 50, **extra: Any) -> dict[str, Any]:
    message: dict[str, Any] = {
        "message_id": message_id,
        "date": 1,
        "chat": {"id": chat_id, "type": "private"},
        "from": {"id": BOT_ID, "is_bot": True, "first_name": "osbot"},
        "text": text,
        **extra,
    }
    if reply_to is not None:
        message["reply_to_message"] = reply_to
    return message


def buttons(markup: Any) -> list[tuple[str, str | None]]:
    """[(text, callback_data or url)] of an inline keyboard, row by row."""
    if markup is None:
        return []
    return [(b.text, b.callback_data or b.url) for row in markup.inline_keyboard for b in row]


@pytest.fixture
def tg() -> Tg:
    return Tg(fake_api())
