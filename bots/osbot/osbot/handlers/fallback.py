"""Last resort: buttons nobody handles (old formats, removed features) and handler errors."""

from __future__ import annotations

import logging

from aiogram import Router, types
from aiogram.types import ErrorEvent

from .. import texts
from ..keyboards import only_links
from ..tg import accessible, edit_markup

log = logging.getLogger(__name__)


async def stale_button(callback: types.CallbackQuery) -> None:
    log.info("stale button", extra={"data": callback.data})
    await callback.answer(texts.STALE)
    card = accessible(callback)
    if card is not None:
        try:
            await edit_markup(card, only_links(card.reply_markup))
        except Exception:
            log.debug("could not drop the stale buttons", exc_info=True)


async def on_error(event: ErrorEvent) -> bool:
    """Logs the failure and tells the owner, instead of leaving a button spinning."""
    log.error("handler failed", exc_info=event.exception)
    update = event.update
    try:
        if update.callback_query is not None:
            await update.callback_query.answer(texts.SOMETHING_WRONG, show_alert=True)
        elif update.message is not None:
            await update.message.answer(f"<b>💥 {texts.SOMETHING_WRONG}</b>")
    except Exception:  # e.g. the button was already answered
        log.debug("could not report the failure", exc_info=True)
    return True


def make_router() -> Router:
    router = Router(name="fallback")
    router.callback_query.register(stale_button)
    return router
