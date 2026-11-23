"""Logging a new expense: "250 coffee" -> (category picker) -> saved card.

The amount is read here (so a typo gets a hint at once); Budget's quick-add parser then
finds the category ("250 food lunch"), a date word ("250 food yesterday") or the
category this note was filed under before, and saves the expense. When nothing points
to a category, the bot shows its picker and saves on the tap.
"""

from __future__ import annotations

import logging
from datetime import date

from aiogram import F, Router, types
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext

from .. import categories, keyboards, render
from ..api import BudgetApi, Draft
from ..errors import describe
from ..keyboards import PickCb
from ..money import Entry, format_number, parse_entry
from ..ui import show
from .common import (
    Flow,
    card_text,
    category_candidates,
    end_flow,
    picker_names,
    put_draft,
    restore_draft,
    take_draft,
)

log = logging.getLogger(__name__)
router = Router(name="expense")


def budget_text(entry: Entry) -> str:
    """The entry as one line for Budget's parser: amount first, decimal point, no currency word."""
    amount = format_number(entry.amount_minor).replace(" ", "")
    return f"{amount} {entry.text}" if entry.text else amount


async def handle_entry(message: types.Message, state: FSMContext, api: BudgetApi, entry: Entry) -> None:
    await end_flow(state)
    try:
        result = await api.quick(budget_text(entry))
    except Exception as exc:
        await message.answer(describe(exc, action="save expense").html())
        return
    if not isinstance(result, Draft):
        await message.answer(
            card_text(result.expense, "s", totals=result.totals),
            reply_markup=keyboards.expense_actions(result.expense["id"]),
        )
        return
    try:
        names = await picker_names(api)
    except Exception as exc:
        await message.answer(describe(exc, action="load categories").html())
        return
    sent = await message.answer(
        render.picker(result.amount_minor, result.note, result.currency, result.occurred_on),
        reply_markup=keyboards.category_picker(names, result.amount_minor, result.note is not None),
    )
    await put_draft(state, sent.message_id, result.amount_minor, result.note, result.occurred_on.isoformat())


@router.message(StateFilter(Flow.amount))
async def process_amount(message: types.Message, state: FSMContext, api: BudgetApi) -> None:
    """The message after /add. Anything that is not an amount gets a specific hint."""
    entry = parse_entry(message.text)
    if entry is None:
        await message.answer(render.invalid_amount())
        return
    await handle_entry(message, state, api, entry)


@router.message(StateFilter(None), F.text, ~F.text.startswith("/"))
async def quick_entry(message: types.Message, state: FSMContext, api: BudgetApi) -> None:
    entry = parse_entry(message.text)
    if entry is None:
        await message.answer(render.unknown_text())
        return
    await handle_entry(message, state, api, entry)


@router.callback_query(PickCb.filter())
async def process_category(callback: types.CallbackQuery, callback_data: PickCb, state: FSMContext, api: BudgetApi) -> None:
    message = callback.message
    message_id = message.message_id if message is not None else 0

    if callback_data.cat == "x":
        await take_draft(state, message_id)
        await show(callback, "Cancelled. Send an amount whenever you're ready.")
        await callback.answer()
        return

    draft, used = await take_draft(state, message_id)
    if used:
        await callback.answer("Already saved.")
        return
    if draft is not None:
        amount_minor, note, day = draft["a"], draft["n"], draft.get("d")
    elif not callback_data.note and callback_data.amount > 0:
        # No note to lose: the button itself carries the amount (e.g. after a restart).
        amount_minor, note, day = callback_data.amount, None, None
    else:
        await restore_draft(state, message_id, None)
        await callback.answer("This entry expired (the bot restarted). Please send it again.", show_alert=True)
        return

    try:
        category = categories.resolve(callback_data.cat, await category_candidates(api))
        if category is None:
            await restore_draft(state, message_id, draft)
            await callback.answer(render.stale(), show_alert=True)
            return
        saved = await api.create(amount_minor, category.id, note, date.fromisoformat(day) if day else None)
    except Exception as exc:
        # Put the draft back so the owner can simply tap the category again.
        await restore_draft(state, message_id, draft or {"a": amount_minor, "n": note, "d": day})
        await callback.answer(describe(exc, action="save expense").toast(), show_alert=True)
        return

    await show(callback, card_text(saved.expense, "s", totals=saved.totals), keyboards.expense_actions(saved.expense["id"]))
    await callback.answer("Saved")
