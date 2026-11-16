import logging

import asyncpg
from aiogram import F, Router, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from .. import repo
from ..config import DEFAULT_CURRENCY
from ..keyboards import CATEGORIES, CATEGORY_PREFIX, get_categories_keyboard
from ..money import format_amount, parse_amount

log = logging.getLogger(__name__)
router = Router()


class ExpenseStates(StatesGroup):
    waiting_for_amount = State()
    waiting_for_category = State()


@router.message(Command("add"))
async def cmd_add(message: types.Message, state: FSMContext) -> None:
    await message.answer("Please enter the expense amount (e.g., 15.50 or 50):")
    await state.set_state(ExpenseStates.waiting_for_amount)


@router.message(ExpenseStates.waiting_for_amount)
async def process_amount(message: types.Message, state: FSMContext) -> None:
    # message.text is None for stickers, photos etc.; the old bot crashed on those.
    amount_minor = parse_amount(message.text)
    if amount_minor is None:
        await message.answer("❌ Invalid amount. Please enter a positive number (e.g., 15.50):")
        return

    await state.update_data(amount_minor=amount_minor)

    await message.answer(
        f"Amount set to {format_amount(amount_minor, DEFAULT_CURRENCY)}. Now, select a category:",
        reply_markup=get_categories_keyboard(),
    )
    await state.set_state(ExpenseStates.waiting_for_category)


@router.callback_query(ExpenseStates.waiting_for_category, F.data.startswith(CATEGORY_PREFIX))
async def process_category(callback: types.CallbackQuery, state: FSMContext, pool: asyncpg.Pool) -> None:
    category = callback.data.removeprefix(CATEGORY_PREFIX)
    amount_minor = (await state.get_data()).get("amount_minor")
    if category not in CATEGORIES or amount_minor is None:
        await state.clear()
        await callback.answer("This button has expired. Use /add to start again.", show_alert=True)
        return

    # Clear first so a fast double tap cannot save the same expense twice.
    await state.clear()
    try:
        await repo.add_expense(pool, callback.from_user.id, amount_minor, category, DEFAULT_CURRENCY)
    except Exception:
        log.exception("failed to save expense")
        # Put the flow back so the user can simply tap the category again.
        await state.set_state(ExpenseStates.waiting_for_category)
        await state.update_data(amount_minor=amount_minor)
        await callback.answer("❌ Could not save the expense, please try again.", show_alert=True)
        return

    await callback.message.edit_text(
        f"✅ Successfully added expense:\n"
        f"Amount: {format_amount(amount_minor, DEFAULT_CURRENCY)}\n"
        f"Category: {category}"
    )
    await callback.answer()


@router.callback_query(F.data.startswith(CATEGORY_PREFIX))
async def stale_category(callback: types.CallbackQuery) -> None:
    """A category button pressed outside the /add flow (old message, bot restart, double tap).

    The old bot ignored these, leaving the button spinning forever.
    """
    await callback.answer("This button has expired. Use /add to start again.", show_alert=True)
