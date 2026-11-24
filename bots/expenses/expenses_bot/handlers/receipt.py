"""A photo of a receipt -> a draft expense card -> Save.

    📷 photo ─▶ "Reading the receipt…" ─▶ anwar.os asks Claude (the bot holds no key)
                                          │
    💸 312 CZK · Albert · today · 🍔 Food?   [✅ Save] [🏷 Category] [✏️ Amount] [✖ Cancel]
                                          │
    Save ─▶ POST expenses (into the account in the receipt's currency) ─▶ the usual saved card

The photo is downloaded into memory, sent once and dropped. Drafts live in FSM memory
(per chat), keyed by the card's message id, like the category picker's drafts; a card
from before a restart answers "expired".
"""

from __future__ import annotations

import logging
from html import escape as _escape
from typing import Any

from aiogram import F, Router, types
from aiogram.filters.callback_data import CallbackData
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .. import categories, keyboards, render
from ..api import ApiError, BudgetApi
from ..errors import describe
from ..money import format_amount, parse_amount
from ..periods import human_day
from ..receipt_api import NotRead, ReceiptDraft, read_receipt, save_receipt
from ..ui import delete_quietly, show
from .common import card_text, end_flow, picker_names

log = logging.getLogger(__name__)
router = Router(name="receipt")

# The Claude API takes images up to 5 MB; Telegram photos are far smaller.
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_RECEIPTS = 5
EXPIRED = "This receipt expired (the bot restarted). Send the photo again."


def escape(text: str) -> str:
    """Telegram HTML: <, > and & only (quotes stay readable)."""
    return _escape(text, quote=False)


class ReceiptFlow(StatesGroup):
    amount = State()  # the next message is the corrected total


class ReceiptCb(CallbackData, prefix="rc"):
    """s save · c category picker · cs set category (cat) · a amount · b back to the card · x cancel."""

    action: str
    cat: str = ""


# --- texts and keyboards -------------------------------------------------------------


def receipt_card(draft: ReceiptDraft, prompt: str | None = None) -> str:
    category = f"{categories.label(draft.category_name)}?" if draft.category_name else "no category yet"
    parts = [f"<b>{format_amount(draft.amount_minor, draft.currency)}</b>"]
    if draft.merchant:
        parts.append(escape(draft.merchant))
    day = human_day(draft.occurred_on)
    parts += [day.lower() if day in ("Today", "Yesterday") else day, escape(category)]
    lines = ["🧾 <b>Receipt</b>", "", "💸 " + " · ".join(parts)]
    if draft.summary and draft.summary != draft.merchant:
        lines.append(f"🛒 {escape(draft.summary)}")
    if draft.currency_mismatch and draft.account_currency:
        lines.append(
            f"⚠️ The receipt is in {escape(draft.currency)} but your account is in {escape(draft.account_currency)}: "
            "fix the amount or add an account in that currency in Budget."
        )
    if draft.date_assumed:
        lines.append("📅 No date on the receipt, so it's today.")
    lines += ["", prompt or "Save it?"]
    return "\n".join(lines)


def receipt_actions() -> InlineKeyboardMarkup:
    def btn(text: str, action: str) -> InlineKeyboardButton:
        return InlineKeyboardButton(text=text, callback_data=ReceiptCb(action=action).pack())

    return InlineKeyboardMarkup(
        inline_keyboard=[[btn("✅ Save", "s"), btn("🏷 Category", "c")], [btn("✏️ Amount", "a"), btn("✖ Cancel", "x")]]
    )


def receipt_categories(names: list[Any], current_id: str | None) -> InlineKeyboardMarkup:
    buttons = [
        InlineKeyboardButton(
            text=("✓ " if c.id == current_id else "") + categories.label(c.name),
            callback_data=ReceiptCb(action="cs", cat=categories.token(c.id)).pack(),
        )
        for c in names
    ]
    rows = [buttons[i : i + 3] for i in range(0, len(buttons), 3)]
    rows.append([InlineKeyboardButton(text="‹ Back", callback_data=ReceiptCb(action="b").pack())])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def back_only() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="‹ Back", callback_data=ReceiptCb(action="b").pack())]])


# --- drafts in FSM memory ------------------------------------------------------------


async def _put(state: FSMContext, message_id: int, draft: ReceiptDraft) -> None:
    receipts: dict[str, Any] = dict((await state.get_data()).get("receipts", {}))
    receipts[str(message_id)] = draft.to_state()
    while len(receipts) > MAX_RECEIPTS:
        receipts.pop(next(iter(receipts)))
    await state.update_data(receipts=receipts)


async def _get(state: FSMContext, message_id: int) -> ReceiptDraft | None:
    saved = (await state.get_data()).get("receipts", {}).get(str(message_id))
    return ReceiptDraft.from_state(saved) if saved else None


async def _drop(state: FSMContext, message_id: int) -> ReceiptDraft | None:
    receipts: dict[str, Any] = dict((await state.get_data()).get("receipts", {}))
    saved = receipts.pop(str(message_id), None)
    await state.update_data(receipts=receipts)
    return ReceiptDraft.from_state(saved) if saved else None


# --- photo in ------------------------------------------------------------------------


def _problem_text(exc: Exception) -> str:
    if isinstance(exc, ApiError) and exc.code == "ai_disabled":
        return "<b>🔌 Receipt reading is off</b>\nAdd ANTHROPIC_API_KEY to the web app's environment, then send the photo again."
    if isinstance(exc, ApiError) and exc.code in ("unreadable", "bad_image", "rate_limited", "ai_failed") and exc.message:
        return f"<b>✋ {escape(exc.message)}</b>"
    return describe(exc, action="read receipt").html()


@router.message(F.photo | (F.document & F.document.mime_type.startswith("image/")))
async def on_photo(message: types.Message, state: FSMContext, api: BudgetApi) -> None:
    await end_flow(state)
    item = message.photo[-1] if message.photo else message.document  # the largest size Telegram has
    if item is None:
        return
    if (getattr(item, "file_size", 0) or 0) > MAX_PHOTO_BYTES:
        await message.answer("That image is over 5 MB. Send it as a photo (not a file) and I'll read it.")
        return

    status = await message.answer("🔎 Reading the receipt…")
    try:
        # Into memory only (never written to disk); the bytes are gone with this call.
        buffer = await message.bot.download(item.file_id)
        result = await read_receipt(api, buffer.getvalue() if buffer is not None else b"")
    except Exception as exc:  # noqa: BLE001 (every failure gets a specific message)
        await _replace(message, status, _problem_text(exc))
        return

    if isinstance(result, NotRead):
        await _replace(message, status, f"🤔 {escape(result.message)}\nSend a sharper photo, or type the amount like <code>250 food</code>.")
        return
    sent = await _replace(message, status, receipt_card(result), receipt_actions())
    await _put(state, sent.message_id, result)


async def _replace(message: types.Message, status: Any, text: str, markup: InlineKeyboardMarkup | None = None) -> Any:
    """Turn the "Reading…" message into `text`; send a new message if it can't be edited."""
    edit = getattr(status, "edit_text", None)
    if edit is not None:
        try:
            edited = await edit(text, reply_markup=markup)
            return edited if hasattr(edited, "message_id") else status
        except Exception:  # noqa: BLE001
            log.info("could not edit the status message, sending a new one")
    return await message.answer(text, reply_markup=markup)


# --- buttons -------------------------------------------------------------------------


@router.callback_query(ReceiptCb.filter())
async def on_receipt(callback: types.CallbackQuery, callback_data: ReceiptCb, state: FSMContext, api: BudgetApi) -> None:
    message_id = callback.message.message_id if callback.message is not None else 0
    draft = await _get(state, message_id)
    if draft is None:
        await callback.answer(EXPIRED, show_alert=True)
        return
    action = callback_data.action

    if action == "x":
        await _drop(state, message_id)
        await end_flow(state)
        await show(callback, "Cancelled. Nothing was saved.")
        await callback.answer()
        return

    if action == "b":
        await end_flow(state)
        await show(callback, receipt_card(draft), receipt_actions())
        await callback.answer()
        return

    if action == "a":
        await state.set_state(ReceiptFlow.amount)
        await state.update_data(receipt_edit=message_id)
        await show(callback, receipt_card(draft, "✏️ Send the total as it should be, e.g. <code>312.50</code>."), back_only())
        await callback.answer()
        return

    if action == "c" or (action == "s" and not draft.category_id):
        try:
            names = await picker_names(api)
        except Exception as exc:  # noqa: BLE001
            await callback.answer(describe(exc, action="load categories").toast(), show_alert=True)
            return
        prompt = "Pick a category:" if action == "c" else "Pick a category, then save:"
        await show(callback, receipt_card(draft, prompt), receipt_categories(names, draft.category_id))
        await callback.answer()
        return

    if action == "cs":
        try:
            category = categories.resolve(callback_data.cat, (await api.setup()).categories)
        except Exception as exc:  # noqa: BLE001
            await callback.answer(describe(exc, action="load categories").toast(), show_alert=True)
            return
        if category is None:
            await callback.answer(render.stale(), show_alert=True)
            return
        draft = draft.with_category(category.id, category.name)
        await _put(state, message_id, draft)
        await show(callback, receipt_card(draft), receipt_actions())
        await callback.answer(f"Category: {category.name}")
        return

    if action == "s":
        # Taken out first, so a double tap can't save twice; put back if saving fails.
        await _drop(state, message_id)
        try:
            saved = await save_receipt(api, draft)
        except Exception as exc:  # noqa: BLE001
            await _put(state, message_id, draft)
            await callback.answer(describe(exc, action="save receipt").toast(), show_alert=True)
            return
        await show(callback, card_text(saved.expense, "s", totals=saved.totals), keyboards.expense_actions(saved.expense["id"]))
        await callback.answer("Saved")
        return

    await callback.answer(render.stale(), show_alert=True)


@router.message(ReceiptFlow.amount)
async def on_receipt_amount(message: types.Message, state: FSMContext) -> None:
    amount = parse_amount(message.text)
    if amount is None:
        await message.answer(render.invalid_amount())
        return
    card_id = (await state.get_data()).get("receipt_edit")
    draft = await _drop(state, card_id) if card_id else None
    await end_flow(state)
    if draft is None:
        await message.answer(EXPIRED)
        return
    draft = draft.with_amount(amount)
    sent = await message.answer(receipt_card(draft), reply_markup=receipt_actions())
    await _put(state, sent.message_id, draft)
    if message.bot is not None and card_id:
        await delete_quietly(message.bot, message.chat.id, card_id)
