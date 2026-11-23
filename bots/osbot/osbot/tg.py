"""Small Telegram helpers shared by handlers and loops."""

from __future__ import annotations

import logging
from typing import Any

from aiogram.enums import ChatAction
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery, InaccessibleMessage, InlineKeyboardMarkup, Message

log = logging.getLogger(__name__)


async def send_card(bot: Any, chat_id: int, text: str, markup: InlineKeyboardMarkup | None = None) -> Any:
    """Sends a message; if Telegram refuses its keyboard (a bad URL), sends it without one.

    Used by the loops, where a refused message would otherwise be retried (and
    refused) every minute.
    """
    try:
        return await bot.send_message(chat_id, text, reply_markup=markup)
    except TelegramBadRequest:
        if markup is None:
            raise
        log.warning("message refused with its keyboard; sending it without", exc_info=True)
        return await bot.send_message(chat_id, text)


async def edit(message: Any, text: str, markup: Any = None) -> None:
    """Edits a message in place. Same content = no-op; uneditable = a new message instead."""
    try:
        await message.edit_text(text, reply_markup=markup)
    except TelegramBadRequest as error:
        if "not modified" in str(error):
            return
        if "can't be edited" in str(error) or "not found" in str(error):
            await message.answer(text, reply_markup=markup)
            return
        raise


async def edit_markup(message: Any, markup: Any = None) -> None:
    try:
        await message.edit_reply_markup(reply_markup=markup)
    except TelegramBadRequest as error:
        if "not modified" not in str(error):
            raise


async def typing(message: Any) -> None:
    """Shows "typing…" while a slow call runs (cleared by the next message). Never fails."""
    bot = getattr(message, "bot", None)
    chat = getattr(message, "chat", None)
    if bot is None or chat is None:
        return
    try:
        await bot.send_chat_action(chat_id=chat.id, action=ChatAction.TYPING)
    except Exception:
        log.debug("could not send the typing action", exc_info=True)


def accessible(callback: CallbackQuery) -> Message | None:
    """The message a button belongs to, or None when Telegram no longer gives it to us."""
    message = callback.message
    if message is None or isinstance(message, InaccessibleMessage):
        return None  # deleted or too old
    return message
