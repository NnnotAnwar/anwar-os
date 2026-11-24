"""/week and the buttons on the weekly review card (Snooze, Skip, Refresh)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from aiogram import F, Router, types
from aiogram.filters import Command

from .. import texts
from ..api import OsbotApi
from ..digest import SNOOZE_MINUTES, WeekCb, WeeklyMemory, weekly_keyboard, weekly_text
from ..errors import describe
from ..fmt import clock
from ..keyboards import RetryCb, only_links, retry_keyboard
from ..tg import accessible, edit, typing

log = logging.getLogger(__name__)

SKIPPED = "⏭ Skipped. See you next Sunday."


async def cmd_week(message: types.Message, api: OsbotApi) -> None:
    await typing(message)
    try:
        data = await api.weekly()
    except Exception as error:
        problem = describe(error, action="weekly")
        retry = retry_keyboard(RetryCb(what="week")) if problem.retry else None
        await message.answer(problem.html(), reply_markup=retry)
        return
    await message.answer(weekly_text(data), reply_markup=weekly_keyboard(data, scheduled=False))


async def _refresh(callback: types.CallbackQuery, api: OsbotApi) -> None:
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.STALE)
        return
    try:
        data = await api.weekly()
    except Exception as error:
        await callback.answer(describe(error, action="weekly").toast(), show_alert=True)
        return
    await edit(card, weekly_text(data), weekly_keyboard(data, scheduled=False))
    await callback.answer()


async def on_week(
    callback: types.CallbackQuery, callback_data: WeekCb, api: OsbotApi, weekly: WeeklyMemory, now: datetime | None = None
) -> None:
    if callback_data.action == "ref":
        await _refresh(callback, api)
        return
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.TOO_OLD)
        return
    if callback_data.action == "snz":
        until = (now or datetime.now(UTC)) + timedelta(minutes=SNOOZE_MINUTES)
        weekly.snooze(until)
        await edit(card, f"{card.html_text}\n\n<i>💤 Snoozed until {clock(until)}</i>", only_links(card.reply_markup))
        await callback.answer(f"💤 I'll send it again at {clock(until)}")
        return
    if callback_data.action == "skip":
        await edit(card, f"{card.html_text}\n\n<i>⏭ Skipped</i>", only_links(card.reply_markup))
        await callback.answer(SKIPPED)
        return
    await callback.answer(texts.STALE)


async def on_week_retry(callback: types.CallbackQuery, api: OsbotApi) -> None:
    await _refresh(callback, api)


def make_router() -> Router:
    router = Router(name="weekly")
    router.message.register(cmd_week, Command("week"))
    router.callback_query.register(on_week, WeekCb.filter())
    router.callback_query.register(on_week_retry, RetryCb.filter(F.what == "week"))
    return router
