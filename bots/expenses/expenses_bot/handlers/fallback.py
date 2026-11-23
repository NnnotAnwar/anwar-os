"""Last-resort handlers: stale buttons, unknown commands, non-text messages, errors."""

from __future__ import annotations

import logging

from aiogram import F, Router, types
from aiogram.types import ErrorEvent

from .. import render
from ..errors import describe, is_api_failure
from ..keyboards import LEGACY_CATEGORY_PREFIX

log = logging.getLogger(__name__)
router = Router(name="fallback")

OOPS = "⚠️ Something went wrong on my side. Please try again."


@router.callback_query(F.data.startswith(LEGACY_CATEGORY_PREFIX))
async def stale_category(callback: types.CallbackQuery) -> None:
    """A category button from the old bot's messages."""
    await callback.answer(
        "This button is from an older version. Send an amount like 250 coffee to add an expense.",
        show_alert=True,
    )


@router.callback_query()
async def stale_button(callback: types.CallbackQuery) -> None:
    await callback.answer(render.stale() + " Send /help to see what I can do.", show_alert=True)


@router.message(F.text.startswith("/"))
async def unknown_command(message: types.Message) -> None:
    await message.answer("I don't know that command. /help lists what I can do.")


@router.message()
async def anything_else(message: types.Message) -> None:
    """Stickers, photos, voice, or text that is not an amount."""
    await message.answer(render.unknown_text())


async def on_error(event: ErrorEvent) -> bool:
    """Registered on the dispatcher: log, then tell the owner instead of staying silent.

    A failed call to Budget says what failed (app down, signature, gone, ...)."""
    update = event.update
    if is_api_failure(event.exception):
        problem = describe(event.exception, action="handler")
        toast, html = problem.toast(), problem.html()
    else:
        log.error("handler failed", exc_info=event.exception)
        toast, html = OOPS, OOPS
    try:
        if update.callback_query is not None:
            await update.callback_query.answer(toast, show_alert=True)
        elif update.message is not None:
            await update.message.answer(html)
    except Exception:
        log.warning("could not report the error to the user", exc_info=True)
    return True
