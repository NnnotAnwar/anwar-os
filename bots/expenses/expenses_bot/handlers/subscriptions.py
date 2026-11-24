"""/subscriptions: what recurring expenses cost and when each one charges next.

A failed call to Budget is answered by fallback.on_error with what went wrong.
"""

from __future__ import annotations

from aiogram import Router, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext

from ..api import BudgetApi
from ..subscriptions import SubscriptionsCb, subscriptions_keyboard, subscriptions_text
from ..ui import show
from .common import end_flow

router = Router(name="subscriptions")


@router.message(Command("subscriptions", "subs"))
async def cmd_subscriptions(message: types.Message, state: FSMContext, api: BudgetApi) -> None:
    await end_flow(state)
    data = await api.subscriptions()
    await message.answer(subscriptions_text(data), reply_markup=subscriptions_keyboard(data))


@router.callback_query(SubscriptionsCb.filter())
async def on_refresh(callback: types.CallbackQuery, api: BudgetApi) -> None:
    data = await api.subscriptions()
    await show(callback, subscriptions_text(data), subscriptions_keyboard(data))
    await callback.answer()
