"""/limits: what's left this month in each category with a monthly limit.

A failed call to Budget is answered by fallback.on_error with what went wrong.
"""

from __future__ import annotations

from aiogram import Router, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext

from ..api import BudgetApi
from ..limits import LimitsCb, limits_keyboard, limits_text
from ..ui import show
from .common import end_flow

router = Router(name="limits")


@router.message(Command("limits", "limit"))
async def cmd_limits(message: types.Message, state: FSMContext, api: BudgetApi) -> None:
    await end_flow(state)
    data = await api.limits()
    await message.answer(limits_text(data), reply_markup=limits_keyboard(data))


@router.callback_query(LimitsCb.filter())
async def on_refresh(callback: types.CallbackQuery, api: BudgetApi) -> None:
    data = await api.limits()
    await show(callback, limits_text(data), limits_keyboard(data))
    await callback.answer()
