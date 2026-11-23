"""Keyboards and callback data.

Callback data stays well under Telegram's 64-byte limit and carries everything needed to
act on it (expense ids, period anchors), so buttons keep working after a restart. The one
exception is the category picker for a new expense with a note: the note lives in memory
(see handlers/expense.py) and an expired picker says so.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from aiogram.filters.callback_data import CallbackData
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from . import categories
from .api import Category
from .periods import Period

# Old bot's picker ("category_Food"); still answered as expired if tapped in old chats.
LEGACY_CATEGORY_PREFIX = "category_"

# --- main menu (reply keyboard) --------------------------------------------------

MENU_TODAY = "📅 Today"
MENU_WEEK = "🗓 Week"
MENU_MONTH = "📊 Month"
MENU_HISTORY = "🧾 History"
MENU_HELP = "❓ Help"
MENU_BUTTONS = (MENU_TODAY, MENU_WEEK, MENU_MONTH, MENU_HISTORY, MENU_HELP)


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=MENU_TODAY), KeyboardButton(text=MENU_WEEK), KeyboardButton(text=MENU_MONTH)],
            [KeyboardButton(text=MENU_HISTORY), KeyboardButton(text=MENU_HELP)],
        ],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="250 coffee",
    )


# --- callback data ---------------------------------------------------------------


class PickCb(CallbackData, prefix="pk"):
    """Category for a new expense. cat = categories.token(category id), or "x" to cancel."""

    cat: str
    amount: int
    note: bool  # the draft has a note (kept in memory, not in the button)


class EntryCb(CallbackData, prefix="ex"):
    """Action on a saved expense.

    action: v view, u undo, a amount, n note, c category picker, cs set category (cat),
            d ask delete, dy delete confirmed.
    id: the Budget transaction id as 32 hex digits (a uuid without dashes).
    origin: "s" = the card shown right after saving, digits = history page to return to.
    """

    action: str
    id: str
    origin: str = "s"
    cat: str = ""


def short_id(expense_id: str) -> str:
    """Budget's uuid as 32 hex digits, to fit callback data."""
    return uuid.UUID(expense_id).hex


def full_id(value: str) -> str | None:
    """The uuid behind short_id(), or None for anything else (e.g. the old bot's numeric ids)."""
    if len(value) != 32:
        return None
    try:
        return str(uuid.UUID(hex=value))
    except ValueError:
        return None


class PeriodCb(CallbackData, prefix="ov"):
    p: str  # Period.encode()


class ExportCb(CallbackData, prefix="csv"):
    p: str


class HistoryCb(CallbackData, prefix="hs"):
    page: int


class NoopCb(CallbackData, prefix="noop"):
    pass


def _rows(buttons: Sequence[InlineKeyboardButton], width: int) -> list[list[InlineKeyboardButton]]:
    return [list(buttons[i : i + width]) for i in range(0, len(buttons), width)]


# --- new expense ------------------------------------------------------------------


def category_picker(names: Sequence[Category], amount_minor: int, has_note: bool) -> InlineKeyboardMarkup:
    buttons = [
        InlineKeyboardButton(
            text=categories.label(c.name),
            callback_data=PickCb(cat=categories.token(c.id), amount=amount_minor, note=has_note).pack(),
        )
        for c in names
    ]
    rows = _rows(buttons, 3)
    rows.append(
        [InlineKeyboardButton(text="✖ Cancel", callback_data=PickCb(cat="x", amount=0, note=False).pack())]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


# --- saved expense ---------------------------------------------------------------


def _entry(action: str, expense_id: str, origin: str, cat: str = "") -> str:
    return EntryCb(action=action, id=short_id(expense_id), origin=origin, cat=cat).pack()


def expense_actions(expense_id: str, origin: str = "s") -> InlineKeyboardMarkup:
    def btn(text: str, action: str) -> InlineKeyboardButton:
        return InlineKeyboardButton(text=text, callback_data=_entry(action, expense_id, origin))

    if origin == "s":
        rows = [
            [btn("↩️ Undo", "u"), btn("✏️ Amount", "a")],
            [btn("🏷 Category", "c"), btn("📝 Note", "n")],
        ]
    else:
        rows = [
            [btn("✏️ Amount", "a"), btn("🏷 Category", "c")],
            [btn("📝 Note", "n"), btn("🗑 Delete", "d")],
            [InlineKeyboardButton(text="‹ Back to list", callback_data=HistoryCb(page=int(origin)).pack())],
        ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


def category_edit(expense_id: str, origin: str, names: Sequence[Category], current_id: str | None) -> InlineKeyboardMarkup:
    buttons = [
        InlineKeyboardButton(
            text=("✓ " if c.id == current_id else "") + categories.label(c.name),
            callback_data=_entry("cs", expense_id, origin, categories.token(c.id)),
        )
        for c in names
    ]
    rows = _rows(buttons, 3)
    rows.append([InlineKeyboardButton(text="‹ Back", callback_data=_entry("v", expense_id, origin))])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def cancel_prompt(expense_id: str, origin: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="✖ Cancel", callback_data=_entry("v", expense_id, origin))]]
    )


def confirm_delete(expense_id: str, origin: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🗑 Yes, delete", callback_data=_entry("dy", expense_id, origin)),
                InlineKeyboardButton(text="Keep it", callback_data=_entry("v", expense_id, origin)),
            ]
        ]
    )


# --- overviews -------------------------------------------------------------------

_TAB_LABELS = {"d": "Day", "w": "Week", "m": "Month"}


def overview_nav(period: Period) -> InlineKeyboardMarkup:
    nav = [InlineKeyboardButton(text=f"◀ {period.prev.short()}", callback_data=PeriodCb(p=period.prev.encode()).pack())]
    if not period.is_current():
        current = Period.current(period.kind)
        if not period.is_future():
            nav.append(InlineKeyboardButton(text=f"↺ {current.short()}", callback_data=PeriodCb(p=current.encode()).pack()))
    if not period.next.is_future():
        nav.append(
            InlineKeyboardButton(text=f"{period.next.short()} ▶", callback_data=PeriodCb(p=period.next.encode()).pack())
        )

    tabs = []
    for kind, text in _TAB_LABELS.items():
        if kind == period.kind:
            tabs.append(InlineKeyboardButton(text=f"· {text} ·", callback_data=NoopCb().pack()))
            continue
        # Switch granularity around the viewed period: today if it is the current one.
        anchor = Period.current(kind) if period.is_current() else Period.containing(kind, period.start)  # type: ignore[arg-type]
        tabs.append(InlineKeyboardButton(text=text, callback_data=PeriodCb(p=anchor.encode()).pack()))

    rows = [nav, tabs]
    if period.kind == "m":
        rows.append([InlineKeyboardButton(text="⬇️ Export CSV", callback_data=ExportCb(p=period.encode()).pack())])
    return InlineKeyboardMarkup(inline_keyboard=rows)


# --- history ---------------------------------------------------------------------


def history(expense_ids: Sequence[str], page: int, pages: int) -> InlineKeyboardMarkup:
    numbers = [
        InlineKeyboardButton(text=str(n), callback_data=_entry("v", expense_id, str(page)))
        for n, expense_id in enumerate(expense_ids, start=1)
    ]
    rows = _rows(numbers, 4)
    if pages > 1:
        nav = []
        if page > 0:
            nav.append(InlineKeyboardButton(text="◀ Newer", callback_data=HistoryCb(page=page - 1).pack()))
        nav.append(InlineKeyboardButton(text=f"{page + 1}/{pages}", callback_data=NoopCb().pack()))
        if page < pages - 1:
            nav.append(InlineKeyboardButton(text="Older ▶", callback_data=HistoryCb(page=page + 1).pack()))
        rows.append(nav)
    return InlineKeyboardMarkup(inline_keyboard=rows)
