"""Outer update middleware: records seen users and daily activity for the stats views."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, User

from . import repo

log = logging.getLogger(__name__)


class SeenUsersMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user: User | None = data.get("event_from_user")
        if user is not None and not user.is_bot:
            try:
                await repo.touch_user(data["pool"], user.id, user.username)
            except Exception:
                # Stats bookkeeping must never block the actual handler.
                log.exception("failed to record user activity")
        return await handler(event, data)
