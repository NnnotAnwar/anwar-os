"""Small helpers for editing messages in place without tripping over Telegram's edge cases."""

from __future__ import annotations

import logging
from typing import Any

from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery, InlineKeyboardMarkup

log = logging.getLogger(__name__)


async def show(
    callback: CallbackQuery, text: str, reply_markup: InlineKeyboardMarkup | None = None
) -> None:
    """Replace the callback's message with `text`; send a new message if it can't be edited.

    "message is not modified" (same content, e.g. a double tap) is ignored. Old messages
    (> 48 h for some actions) or inaccessible ones get a fresh message instead.
    """
    # InaccessibleMessage (too old for the bot to see) has no edit_text.
    edit = getattr(callback.message, "edit_text", None)
    if edit is not None:
        try:
            await edit(text, reply_markup=reply_markup)
            return
        except TelegramBadRequest as exc:
            if "not modified" in str(exc):
                return
            log.info("edit failed, sending a new message", extra={"reason": str(exc)})
    if callback.from_user is not None and callback.bot is not None:
        await callback.bot.send_message(callback.from_user.id, text, reply_markup=reply_markup)


async def delete_quietly(bot: Any, chat_id: int, message_id: int) -> bool:
    try:
        await bot.delete_message(chat_id, message_id)
        return True
    except TelegramBadRequest:
        return False
