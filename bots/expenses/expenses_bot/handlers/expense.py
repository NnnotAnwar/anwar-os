"""Logging a new expense: "250 coffee" -> (category picker) -> saved card."""

from __future__ import annotations

import logging

import asyncpg
from aiogram import F, Router, types
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext

from .. import categories, keyboards, render, repo
from ..config import DEFAULT_CURRENCY
from ..keyboards import PickCb
from ..money import Entry, parse_entry
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

SAVE_FAILED = "⚠️ Couldn't save that, the database didn't answer. Please try again in a moment."


async def resolve_category(pool: asyncpg.Pool, user_id: int, text: str) -> tuple[str, str | None] | None:
    """Category (and remaining note) for the text after the amount, if it is clear.

    "food" / "food lunch" name a category directly; otherwise a note used before is filed
    under the category it was filed under most often.
    """
    found = categories.match(text, await category_candidates(pool, user_id))
    if found is not None:
        return found
    learned = await repo.category_for_note(pool, user_id, text)
    if learned is not None:
        return learned, text
    return None


async def save_and_reply(
    message: types.Message, pool: asyncpg.Pool, user_id: int, amount_minor: int, category: str, note: str | None
) -> None:
    try:
        expense_id = await repo.add_expense(pool, user_id, amount_minor, category, DEFAULT_CURRENCY, note=note)
        row = await repo.get_expense(pool, user_id, expense_id)
        text = await card_text(pool, user_id, row, "s")
    except Exception:
        log.exception("failed to save expense")
        await message.answer(SAVE_FAILED)
        return
    await message.answer(text, reply_markup=keyboards.expense_actions(expense_id))


async def handle_entry(message: types.Message, state: FSMContext, pool: asyncpg.Pool, entry: Entry) -> None:
    await end_flow(state)
    user_id = message.from_user.id  # type: ignore[union-attr]
    if entry.text:
        resolved = await resolve_category(pool, user_id, entry.text)
        if resolved is not None:
            category, note = resolved
            await save_and_reply(message, pool, user_id, entry.amount_minor, category, note)
            return
    names = await picker_names(pool, user_id)
    sent = await message.answer(
        render.picker(entry.amount_minor, entry.text),
        reply_markup=keyboards.category_picker(names, entry.amount_minor, entry.text is not None),
    )
    await put_draft(state, sent.message_id, entry.amount_minor, entry.text)


@router.message(StateFilter(Flow.amount))
async def process_amount(message: types.Message, state: FSMContext, pool: asyncpg.Pool) -> None:
    """The message after /add. Anything that is not an amount gets a specific hint."""
    entry = parse_entry(message.text)
    if entry is None:
        await message.answer(render.invalid_amount())
        return
    await handle_entry(message, state, pool, entry)


@router.message(StateFilter(None), F.text, ~F.text.startswith("/"))
async def quick_entry(message: types.Message, state: FSMContext, pool: asyncpg.Pool) -> None:
    entry = parse_entry(message.text)
    if entry is None:
        await message.answer(render.unknown_text())
        return
    await handle_entry(message, state, pool, entry)


@router.callback_query(PickCb.filter())
async def process_category(
    callback: types.CallbackQuery, callback_data: PickCb, state: FSMContext, pool: asyncpg.Pool
) -> None:
    message = callback.message
    message_id = message.message_id if message is not None else 0
    user_id = callback.from_user.id

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
        amount_minor, note = draft["a"], draft["n"]
    elif not callback_data.note and callback_data.amount > 0:
        # No note to lose: the button itself carries the amount (e.g. after a restart).
        amount_minor, note = callback_data.amount, None
    else:
        await restore_draft(state, message_id, None)
        await callback.answer("This entry expired (the bot restarted). Please send it again.", show_alert=True)
        return

    try:
        category = categories.resolve(callback_data.cat, await category_candidates(pool, user_id))
        if category is None:
            await restore_draft(state, message_id, draft)
            await callback.answer(render.stale(), show_alert=True)
            return
        expense_id = await repo.add_expense(pool, user_id, amount_minor, category, DEFAULT_CURRENCY, note=note)
    except Exception:
        log.exception("failed to save expense")
        # Put the draft back so the user can simply tap the category again.
        await restore_draft(state, message_id, draft or {"a": amount_minor, "n": note})
        await callback.answer("❌ Could not save the expense, please try again.", show_alert=True)
        return

    row = await repo.get_expense(pool, user_id, expense_id)
    await show(callback, await card_text(pool, user_id, row, "s"), keyboards.expense_actions(expense_id))
    await callback.answer("Saved")
