"""Updates fed through the real dispatcher (filters, router order, middleware, errors).

The Bot uses a recording session instead of the network: no Telegram traffic.
"""

from __future__ import annotations

import itertools
from datetime import UTC, datetime
from typing import Any

from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import AnswerCallbackQuery, EditMessageText, SendMessage, TelegramMethod
from aiogram.types import CallbackQuery, Chat, InlineKeyboardMarkup, Message, Update, User

from expenses_bot import app, categories

from .conftest import needs_db
from .tg import fresh_dispatcher

pytestmark = needs_db

USER = User(id=4242, is_bot=False, first_name="Anwar", username="anwar")
CHAT = Chat(id=4242, type="private")
_ids = itertools.count(1)


class RecordingSession(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod[Any]] = []

    async def make_request(self, bot: Bot, method: TelegramMethod[Any], timeout: int | None = None) -> Any:
        self.calls.append(method)
        if isinstance(method, SendMessage | EditMessageText):
            return Message(
                message_id=next(_ids),
                date=datetime.now(UTC),
                chat=CHAT,
                from_user=User(id=1, is_bot=True, first_name="bot"),
                text=method.text,
                reply_markup=method.reply_markup if isinstance(method.reply_markup, InlineKeyboardMarkup) else None,
            )
        return True

    async def stream_content(self, *args: Any, **kwargs: Any):  # pragma: no cover - unused
        raise NotImplementedError
        yield b""

    async def close(self) -> None:
        pass


def _message(text: str | None) -> Update:
    message = Message(message_id=next(_ids), date=datetime.now(UTC), chat=CHAT, from_user=USER, text=text)
    return Update(update_id=next(_ids), message=message)


def _tap(data: str, message_id: int) -> Update:
    message = Message(message_id=message_id, date=datetime.now(UTC), chat=CHAT, from_user=USER, text="x")
    query = CallbackQuery(id=str(next(_ids)), from_user=USER, chat_instance="c", message=message, data=data)
    return Update(update_id=next(_ids), callback_query=query)


async def test_dispatcher_routes_a_full_session(clean):
    pool = clean
    session = RecordingSession()
    bot = app.create_bot("42:TEST")
    bot.session = session
    dp = fresh_dispatcher(pool)

    async def feed(update: Update) -> list[TelegramMethod[Any]]:
        start = len(session.calls)
        await dp.feed_update(bot, update)
        return session.calls[start:]

    # /start -> welcome with the persistent menu
    (sent,) = await feed(_message("/start"))
    assert isinstance(sent, SendMessage) and "250 coffee" in sent.text
    assert sent.reply_markup.is_persistent

    # Menu button text is not mistaken for an expense
    (sent,) = await feed(_message("📅 Today"))
    assert "Nothing logged yet" in sent.text

    # Quick entry -> picker
    (picker,) = await feed(_message("250 coffee"))
    assert picker.text.startswith("💸 <b>250")
    food = next(
        b.callback_data
        for row in picker.reply_markup.inline_keyboard
        for b in row
        if b.callback_data.startswith("pk:" + categories.token("Food"))
    )
    # Drafts are keyed by the picker's message id (assigned by the recording session).
    state = dp.fsm.get_context(bot, CHAT.id, USER.id)
    draft_ids = list((await state.get_data())["drafts"])
    calls = await feed(_tap(food, int(draft_ids[0])))
    edit = next(c for c in calls if isinstance(c, EditMessageText))
    answer = next(c for c in calls if isinstance(c, AnswerCallbackQuery))
    assert "✅ <b>Saved</b>" in edit.text and answer.text == "Saved"
    assert await pool.fetchval("select note from bot_expenses.expenses") == "coffee"

    # Unknown / stale button and non-text message are answered politely
    (answer,) = await feed(_tap("pk:zzzz", 1))
    assert isinstance(answer, AnswerCallbackQuery) and "expired" in answer.text
    (sent,) = await feed(_message(None))
    assert "didn't catch an amount" in sent.text
    (sent,) = await feed(_message("/nope"))
    assert "/help" in sent.text

    # Middleware still records activity for the stats views
    assert await pool.fetchval("select updates from bot_expenses.activity_daily where telegram_user_id = $1", USER.id) >= 7
