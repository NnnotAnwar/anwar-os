"""Actions on saved expenses: undo, edit amount / category / note, delete with confirmation.

Every action goes to Budget; an expense deleted there (or in another chat) answers
"no longer exists" and, from the history, shows the list again.
"""

from __future__ import annotations

import logging
from typing import Any

from aiogram import Router, types
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext

from .. import categories, keyboards, render
from ..api import ApiError, BudgetApi, Saved
from ..errors import describe
from ..keyboards import EntryCb, full_id
from ..money import NOTE_MAX_LENGTH, parse_amount
from ..ui import delete_quietly, show
from .common import (
    Flow,
    card_text,
    category_candidates,
    category_of,
    end_flow,
    history_screen,
    picker_names,
)

log = logging.getLogger(__name__)
router = Router(name="entries")

GONE = "This expense no longer exists."


def _valid_origin(origin: str) -> bool:
    return origin == "s" or origin.isdigit()


async def _gone(callback: types.CallbackQuery, origin: str, api: BudgetApi) -> None:
    await callback.answer(GONE, show_alert=True)
    if origin.isdigit():
        text, markup = await history_screen(api, int(origin))
        await show(callback, text, markup)


@router.callback_query(EntryCb.filter())
async def on_entry(callback: types.CallbackQuery, callback_data: EntryCb, state: FSMContext, api: BudgetApi) -> None:
    action, origin = callback_data.action, callback_data.origin
    expense_id = full_id(callback_data.id)
    if expense_id is None or not _valid_origin(origin):
        # A button from the bot's own-database days (numeric ids) or garbage.
        await callback.answer(render.stale(), show_alert=True)
        return
    try:
        await _act(callback, callback_data, state, api, expense_id)
    except ApiError as exc:
        if exc.gone:
            await end_flow(state)
            await _gone(callback, origin, api)
            return
        await callback.answer(describe(exc, action=f"expense {action}").toast(), show_alert=True)
    except Exception as exc:
        await callback.answer(describe(exc, action=f"expense {action}").toast(), show_alert=True)


async def _act(callback: types.CallbackQuery, callback_data: EntryCb, state: FSMContext, api: BudgetApi, expense_id: str) -> None:
    action, origin = callback_data.action, callback_data.origin

    if action in ("u", "dy"):
        await end_flow(state)
        removed = await api.delete(expense_id)
        if action == "u" or not origin.isdigit():
            await show(callback, render.undone(removed.expense))
            await callback.answer("Removed")
            return
        text, markup = await history_screen(api, int(origin))
        await show(callback, text, markup)
        await callback.answer(render.deleted(removed.expense))
        return

    if action == "cs":
        category = categories.resolve(callback_data.cat, await category_candidates(api))
        if category is None:
            await callback.answer(render.stale(), show_alert=True)
            return
        saved = await api.update(expense_id, category_id=category.id)
        title = "✅ <b>Updated</b>" if origin == "s" else None
        await show(callback, card_text(saved.expense, origin, totals=saved.totals, title=title, limit=saved.limit), keyboards.expense_actions(expense_id, origin))
        await callback.answer(f"Category: {category.name}")
        return

    current = await api.get(expense_id)
    row = current.expense

    if action == "v":
        await end_flow(state)
        await show(callback, card_text(row, origin, totals=current.totals), keyboards.expense_actions(expense_id, origin))
    elif action == "c":
        await end_flow(state)
        candidates = await category_candidates(api)
        names = categories.with_current(await picker_names(api), category_of(row, candidates))
        await show(
            callback,
            card_text(row, origin, totals=current.totals, prompt=render.PROMPT_CATEGORY),
            keyboards.category_edit(expense_id, origin, names, row.get("category_id")),
        )
    elif action in ("a", "n"):
        await end_flow(state)
        await state.set_state(Flow.edit_amount if action == "a" else Flow.edit_note)
        card_id = callback.message.message_id if callback.message is not None else None
        await state.update_data(edit={"id": expense_id, "origin": origin, "card": card_id})
        prompt = render.PROMPT_AMOUNT if action == "a" else render.PROMPT_NOTE
        await show(
            callback,
            card_text(row, origin, totals=current.totals, prompt=prompt),
            keyboards.cancel_prompt(expense_id, origin),
        )
    elif action == "d":
        await end_flow(state)
        await show(callback, render.confirm_delete(row), keyboards.confirm_delete(expense_id, origin))
    else:
        await callback.answer(render.stale(), show_alert=True)
        return
    await callback.answer()


async def _finish_edit(message: types.Message, state: FSMContext, saved: Saved | None, edit: dict[str, Any]) -> None:
    """Replace the old card (now above the owner's reply) with a fresh one below it."""
    await end_flow(state)
    if saved is None:
        await message.answer(GONE)
        return
    origin = edit["origin"]
    if edit.get("card") and message.bot is not None:
        await delete_quietly(message.bot, message.chat.id, edit["card"])
    await message.answer(
        card_text(saved.expense, origin, totals=saved.totals, title="✅ <b>Updated</b>", limit=saved.limit),
        reply_markup=keyboards.expense_actions(edit["id"], origin),
    )


async def _update(message: types.Message, state: FSMContext, api: BudgetApi, edit: dict[str, Any], **change: Any) -> None:
    try:
        saved = await api.update(edit["id"], **change)
    except ApiError as exc:
        if exc.gone:
            await _finish_edit(message, state, None, edit)
            return
        # Keep the edit open: the owner can send a corrected value or tap Cancel.
        await message.answer(describe(exc, action="update expense").html())
        return
    except Exception as exc:
        await message.answer(describe(exc, action="update expense").html())
        return
    await _finish_edit(message, state, saved, edit)


@router.message(StateFilter(Flow.edit_amount))
async def on_new_amount(message: types.Message, state: FSMContext, api: BudgetApi) -> None:
    edit = (await state.get_data()).get("edit")
    if not edit:
        await end_flow(state)
        await message.answer(render.unknown_text())
        return
    amount = parse_amount((message.text or "").replace("kč", "").replace("Kč", "").strip())
    if amount is None:
        await message.answer(render.invalid_amount() + "\nOr tap ✖ Cancel on the card.")
        return
    await _update(message, state, api, edit, amount_minor=amount)


@router.message(StateFilter(Flow.edit_note))
async def on_new_note(message: types.Message, state: FSMContext, api: BudgetApi) -> None:
    edit = (await state.get_data()).get("edit")
    if not edit:
        await end_flow(state)
        await message.answer(render.unknown_text())
        return
    text = " ".join((message.text or "").split())
    if not text:
        await message.answer("Send the note as text, or <code>-</code> to remove it.")
        return
    await _update(message, state, api, edit, note="" if text == "-" else text[:NOTE_MAX_LENGTH])
