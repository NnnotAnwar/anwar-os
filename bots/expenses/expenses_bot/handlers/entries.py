"""Actions on saved expenses: undo, edit amount / category / note, delete with confirmation."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg
from aiogram import Router, types
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext

from .. import categories, keyboards, render, repo
from ..keyboards import EntryCb
from ..money import NOTE_MAX_LENGTH, parse_amount
from ..ui import delete_quietly, show
from .common import (
    Flow,
    card_text,
    category_candidates,
    end_flow,
    history_screen,
    picker_names,
)

log = logging.getLogger(__name__)
router = Router(name="entries")

GONE = "This expense no longer exists."


def _valid_origin(origin: str) -> bool:
    return origin == "s" or origin.isdigit()


async def _gone(callback: types.CallbackQuery, origin: str, pool: asyncpg.Pool) -> None:
    await callback.answer(GONE, show_alert=True)
    if origin.isdigit():
        text, markup = await history_screen(pool, callback.from_user.id, int(origin))
        await show(callback, text, markup)


@router.callback_query(EntryCb.filter())
async def on_entry(
    callback: types.CallbackQuery, callback_data: EntryCb, state: FSMContext, pool: asyncpg.Pool
) -> None:
    action, expense_id, origin = callback_data.action, callback_data.id, callback_data.origin
    user_id = callback.from_user.id
    if not _valid_origin(origin):
        await callback.answer(render.stale(), show_alert=True)
        return

    if action in ("u", "dy"):
        await end_flow(state)
        row = await repo.delete_expense(pool, user_id, expense_id)
        if row is None:
            await _gone(callback, origin, pool)
            return
        if action == "u" or not origin.isdigit():
            await show(callback, render.undone(row))
            await callback.answer("Removed")
            return
        text, markup = await history_screen(pool, user_id, int(origin))
        await show(callback, text, markup)
        await callback.answer(render.deleted(row))
        return

    if action == "cs":
        candidates = await category_candidates(pool, user_id)
        category = categories.resolve(callback_data.cat, candidates)
        if category is None:
            await callback.answer(render.stale(), show_alert=True)
            return
        row = await repo.update_expense(pool, user_id, expense_id, category=category)
        if row is None:
            await _gone(callback, origin, pool)
            return
        title = "✅ <b>Updated</b>" if origin == "s" else None
        await show(callback, await card_text(pool, user_id, row, origin, title=title), keyboards.expense_actions(expense_id, origin))
        await callback.answer(f"Category: {category}")
        return

    row = await repo.get_expense(pool, user_id, expense_id)
    if row is None:
        await end_flow(state)
        await _gone(callback, origin, pool)
        return

    if action == "v":
        await end_flow(state)
        await show(callback, await card_text(pool, user_id, row, origin), keyboards.expense_actions(expense_id, origin))
    elif action == "c":
        await end_flow(state)
        names = categories.merge(await picker_names(pool, user_id), [row["category"]])
        await show(
            callback,
            await card_text(pool, user_id, row, origin, prompt=render.PROMPT_CATEGORY),
            keyboards.category_edit(expense_id, origin, names, row["category"]),
        )
    elif action in ("a", "n"):
        await end_flow(state)
        await state.set_state(Flow.edit_amount if action == "a" else Flow.edit_note)
        card_id = callback.message.message_id if callback.message is not None else None
        await state.update_data(edit={"id": expense_id, "origin": origin, "card": card_id})
        prompt = render.PROMPT_AMOUNT if action == "a" else render.PROMPT_NOTE
        await show(
            callback,
            await card_text(pool, user_id, row, origin, prompt=prompt),
            keyboards.cancel_prompt(expense_id, origin),
        )
    elif action == "d":
        await end_flow(state)
        await show(callback, render.confirm_delete(row), keyboards.confirm_delete(expense_id, origin))
    else:
        await callback.answer(render.stale(), show_alert=True)
        return
    await callback.answer()


async def _finish_edit(
    message: types.Message, state: FSMContext, pool: asyncpg.Pool, row: Any, edit: dict[str, Any]
) -> None:
    """Replace the old card (now above the user's reply) with a fresh one below it."""
    await end_flow(state)
    user_id = message.from_user.id  # type: ignore[union-attr]
    if row is None:
        await message.answer(GONE)
        return
    origin = edit["origin"]
    if edit.get("card") and message.bot is not None:
        await delete_quietly(message.bot, message.chat.id, edit["card"])
    title = "✅ <b>Updated</b>"
    await message.answer(
        await card_text(pool, user_id, row, origin, title=title),
        reply_markup=keyboards.expense_actions(edit["id"], origin),
    )


@router.message(StateFilter(Flow.edit_amount))
async def on_new_amount(message: types.Message, state: FSMContext, pool: asyncpg.Pool) -> None:
    edit = (await state.get_data()).get("edit")
    if not edit:
        await end_flow(state)
        await message.answer(render.unknown_text())
        return
    amount = parse_amount((message.text or "").replace("kč", "").replace("Kč", "").strip())
    if amount is None:
        await message.answer(render.invalid_amount() + "\nOr tap ✖ Cancel on the card.")
        return
    row = await repo.update_expense(pool, message.from_user.id, edit["id"], amount_minor=amount)  # type: ignore[union-attr]
    await _finish_edit(message, state, pool, row, edit)


@router.message(StateFilter(Flow.edit_note))
async def on_new_note(message: types.Message, state: FSMContext, pool: asyncpg.Pool) -> None:
    edit = (await state.get_data()).get("edit")
    if not edit:
        await end_flow(state)
        await message.answer(render.unknown_text())
        return
    text = " ".join((message.text or "").split())
    if not text:
        await message.answer("Send the note as text, or <code>-</code> to remove it.")
        return
    user_id = message.from_user.id  # type: ignore[union-attr]
    if text == "-":
        row = await repo.update_expense(pool, user_id, edit["id"], clear_note=True)
    else:
        row = await repo.update_expense(pool, user_id, edit["id"], note=text[:NOTE_MAX_LENGTH])
    await _finish_edit(message, state, pool, row, edit)
