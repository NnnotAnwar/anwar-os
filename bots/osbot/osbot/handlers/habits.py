"""/habits and the habit buttons (on the card, on reminders and on the evening nudge)."""

from __future__ import annotations

import logging

from aiogram import F, Router, types
from aiogram.filters import Command

from .. import texts
from ..api import OsbotApi
from ..brief import is_brief
from . import brief
from ..errors import describe
from ..habits import HabitCb, habits_keyboard, habits_text, toggled_toast
from ..keyboards import RetryCb, retry_keyboard
from ..tg import accessible, edit, typing

log = logging.getLogger(__name__)


async def cmd_habits(message: types.Message, api: OsbotApi) -> None:
    await typing(message)
    try:
        data = await api.habits()
    except Exception as error:
        problem = describe(error, action="habits")
        retry = retry_keyboard(RetryCb(what="habits")) if problem.retry else None
        await message.answer(problem.html(), reply_markup=retry)
        return
    await message.answer(habits_text(data), reply_markup=habits_keyboard(data))


async def on_habit(callback: types.CallbackQuery, callback_data: HabitCb, api: OsbotApi) -> None:
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.TOO_OLD)
        return
    day = callback_data.d or None
    try:
        if callback_data.action == "t" and callback_data.id:
            data = await api.toggle_habit(callback_data.id, day)
            toast = toggled_toast(data)
        elif callback_data.action == "r":
            data = await api.habits(day)
            toast = None
        else:
            await callback.answer(texts.STALE)
            return
    except Exception as error:
        await callback.answer(describe(error, action="habit").toast(), show_alert=True)
        return
    if is_brief(card.text) and day == data.get("today"):
        # A tick on the morning brief keeps the brief (redrawn with the new state).
        await brief.redraw(callback, api, toast)
        return
    # Reminders and the evening nudge turn into the full card for their day.
    await edit(card, habits_text(data), habits_keyboard(data))
    await callback.answer(toast)


async def on_habits_retry(callback: types.CallbackQuery, api: OsbotApi) -> None:
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.STALE)
        return
    try:
        data = await api.habits()
    except Exception as error:
        await callback.answer(describe(error, action="habits").toast(), show_alert=True)
        return
    await edit(card, habits_text(data), habits_keyboard(data))
    await callback.answer()


def make_router() -> Router:
    router = Router(name="habits")
    router.message.register(cmd_habits, Command("habits"))
    router.callback_query.register(on_habit, HabitCb.filter())
    router.callback_query.register(on_habits_retry, RetryCb.filter(F.what == "habits"))
    return router
