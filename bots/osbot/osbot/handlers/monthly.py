"""/month [YYYY-MM | last] and the Refresh button on its card."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from aiogram import F, Router, types
from aiogram.filters import Command, CommandObject

from .. import texts
from ..api import OsbotApi
from ..errors import describe
from ..keyboards import RetryCb, retry_keyboard
from ..monthly import MonthCb, monthly_keyboard, monthly_text, parse_month_arg
from ..tg import accessible, edit, typing

log = logging.getLogger(__name__)

USAGE = "<b>Which month?</b>\n/month shows this month so far; <code>/month last</code> or <code>/month 2026-10</code> another one."


async def cmd_month(message: types.Message, command: CommandObject, api: OsbotApi, now: datetime | None = None) -> None:
    month = parse_month_arg(command.args or "", now or datetime.now(UTC))
    if month is False:
        await message.answer(USAGE)
        return
    await typing(message)
    try:
        data = await api.monthly(month)
    except Exception as error:
        problem = describe(error, action="monthly")
        retry = retry_keyboard(RetryCb(what="month", kind=month or "")) if problem.retry else None
        await message.answer(problem.html(), reply_markup=retry)
        return
    await message.answer(monthly_text(data), reply_markup=monthly_keyboard(data, refresh=True))


async def _refresh(callback: types.CallbackQuery, api: OsbotApi, month: str) -> None:
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.STALE)
        return
    try:
        data = await api.monthly(month or None)
    except Exception as error:
        await callback.answer(describe(error, action="monthly").toast(), show_alert=True)
        return
    await edit(card, monthly_text(data), monthly_keyboard(data, refresh=True))
    await callback.answer()


async def on_month(callback: types.CallbackQuery, callback_data: MonthCb, api: OsbotApi) -> None:
    if callback_data.action == "ref":
        await _refresh(callback, api, callback_data.month)
        return
    await callback.answer(texts.STALE)


async def on_month_retry(callback: types.CallbackQuery, callback_data: RetryCb, api: OsbotApi) -> None:
    await _refresh(callback, api, callback_data.kind)


def make_router() -> Router:
    router = Router(name="monthly")
    router.message.register(cmd_month, Command("month"))
    router.callback_query.register(on_month, MonthCb.filter())
    router.callback_query.register(on_month_retry, RetryCb.filter(F.what == "month"))
    return router
