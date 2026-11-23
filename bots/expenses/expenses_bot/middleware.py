"""Outer update middleware: only the owner is ever served.

Everything the bot saves lands in the site owner's Budget, so nobody else may use it.
Others get one short refusal and nothing reaches the handlers (or the web app).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, Update, User

log = logging.getLogger(__name__)

NOT_OWNER = "🔒 This is a private bot."


class OwnerOnlyMiddleware(BaseMiddleware):
    def __init__(self, owner_id: int):
        self.owner_id = owner_id

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user: User | None = data.get("event_from_user")
        if user is not None and user.id == self.owner_id and not user.is_bot:
            return await handler(event, data)

        chat = data.get("event_chat")
        log.info(
            "refused update from someone else",
            extra={"chat_id": getattr(chat, "id", None), "user_id": getattr(user, "id", None)},
        )
        if isinstance(event, Update):
            try:
                if event.message is not None and event.message.chat.type == "private":
                    await event.message.answer(NOT_OWNER)
                elif event.callback_query is not None:
                    await event.callback_query.answer(NOT_OWNER, show_alert=True)
            except Exception:
                log.warning("could not send the refusal", exc_info=True)
        return None
