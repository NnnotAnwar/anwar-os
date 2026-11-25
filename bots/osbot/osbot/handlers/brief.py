"""/brief and the 🔄 Refresh button on the morning brief.

Its task numbers are /today's TaskCb buttons (handled in today.py) and its habit
buttons are /habits' HabitCb (habits.py, which redraws the brief when a tap
comes from one).
"""

from __future__ import annotations

import logging

from aiogram import F, Router, types
from aiogram.filters import Command

from .. import texts
from ..api import OsbotApi
from ..brief import BriefCb, brief_keyboard, brief_text
from ..errors import describe
from ..keyboards import RetryCb, retry_keyboard
from ..tg import accessible, edit, typing

log = logging.getLogger(__name__)


async def cmd_brief(message: types.Message, api: OsbotApi) -> None:
    await typing(message)
    try:
        data = await api.brief()
    except Exception as error:
        problem = describe(error, action="brief")
        retry = retry_keyboard(RetryCb(what="brief")) if problem.retry else None
        await message.answer(problem.html(), reply_markup=retry)
        return
    await message.answer(brief_text(data), reply_markup=brief_keyboard(data))


async def redraw(callback: types.CallbackQuery, api: OsbotApi, toast: str | None = None) -> None:
    """Fetches the brief again and draws it over the message the button belongs to."""
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.STALE)
        return
    try:
        data = await api.brief()
    except Exception as error:
        await callback.answer(describe(error, action="brief").toast(), show_alert=True)
        return
    await edit(card, brief_text(data), brief_keyboard(data))
    await callback.answer(toast)


async def on_brief(callback: types.CallbackQuery, callback_data: BriefCb, api: OsbotApi) -> None:
    if callback_data.action == "ref":
        await redraw(callback, api)
        return
    await callback.answer(texts.STALE)


async def on_brief_retry(callback: types.CallbackQuery, api: OsbotApi) -> None:
    await redraw(callback, api)


def make_router() -> Router:
    router = Router(name="brief")
    router.message.register(cmd_brief, Command("brief"))
    router.callback_query.register(on_brief, BriefCb.filter())
    router.callback_query.register(on_brief_retry, RetryCb.filter(F.what == "brief"))
    return router
