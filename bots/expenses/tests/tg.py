"""Minimal stand-ins for aiogram's Telegram objects (no network)."""

from __future__ import annotations

import itertools
from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage

USER_ID = 42
_message_ids = itertools.count(1000)


def fresh_dispatcher(pool):
    """build_dispatcher() for tests: module-level routers can be attached only once."""
    from expenses_bot import app, handlers

    for router in handlers.routers:
        router._parent_router = None
    return app.build_dispatcher(pool)


def new_state(user_id: int = USER_ID) -> FSMContext:
    return FSMContext(storage=MemoryStorage(), key=StorageKey(bot_id=1, chat_id=user_id, user_id=user_id))


def fake_bot():
    return SimpleNamespace(send_message=AsyncMock(), delete_message=AsyncMock(return_value=True))


def _sent(*args, **kwargs):
    return SimpleNamespace(message_id=next(_message_ids), text=args[0] if args else None, kwargs=kwargs)


def fake_message(text, user_id: int = USER_ID, bot=None):
    return SimpleNamespace(
        text=text,
        message_id=next(_message_ids),
        from_user=SimpleNamespace(id=user_id, first_name="Anwar", username="anwar"),
        chat=SimpleNamespace(id=user_id),
        bot=bot or fake_bot(),
        answer=AsyncMock(side_effect=_sent),
        answer_document=AsyncMock(),
    )


def fake_callback(data: str, user_id: int = USER_ID, message_id: int | None = None, bot=None):
    message = SimpleNamespace(
        message_id=message_id if message_id is not None else next(_message_ids),
        edit_text=AsyncMock(),
        answer=AsyncMock(side_effect=_sent),
        answer_document=AsyncMock(),
    )
    return SimpleNamespace(
        data=data,
        from_user=SimpleNamespace(id=user_id),
        message=message,
        bot=bot or fake_bot(),
        answer=AsyncMock(),
    )


def last_text(mock: AsyncMock) -> str:
    return mock.call_args.args[0]


def last_markup(mock: AsyncMock):
    return mock.call_args.kwargs.get("reply_markup")


def button_texts(markup) -> list[list[str]]:
    return [[b.text for b in row] for row in markup.inline_keyboard]


def button_data(markup) -> list[str]:
    return [b.callback_data for row in markup.inline_keyboard for b in row]
