"""Outer update middleware: only the owner's chat is ever served."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import Chat, TelegramObject, Update

from .texts import NOT_OWNER

log = logging.getLogger(__name__)


class OwnerOnlyMiddleware(BaseMiddleware):
    def __init__(self, owner_chat_id: int):
        self.owner_chat_id = owner_chat_id

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        chat: Chat | None = data.get("event_chat")
        if chat is not None and chat.id == self.owner_chat_id:
            return await handler(event, data)

        user = data.get("event_from_user")
        log.info(
            "refused update from someone else",
            extra={"chat_id": getattr(chat, "id", None), "user_id": getattr(user, "id", None)},
        )
        if isinstance(event, Update):
            try:
                if event.message is not None:
                    await event.message.answer(NOT_OWNER)
                elif event.callback_query is not None:
                    await event.callback_query.answer(NOT_OWNER, show_alert=True)
            except Exception:
                log.warning("could not send the refusal", exc_info=True)
        return None
