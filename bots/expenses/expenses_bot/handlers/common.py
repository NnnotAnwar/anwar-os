"""Shared screen builders and the in-memory conversation state.

FSM data (aiogram MemoryStorage, per chat+user, lost on restart like the old bot's /add):
  drafts  {picker message id: {"a": amount_minor, "n": note}}  pending category pickers
  used    [picker message ids]                                 pickers already saved
  edit    {"id", "origin", "card"}                             expense being edited by text
"""

from __future__ import annotations

from typing import Any

import asyncpg
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import InlineKeyboardMarkup

from .. import categories, keyboards, render, repo
from ..periods import Period, now_local, today_local

HISTORY_PAGE_SIZE = 8
MAX_DRAFTS = 10
MAX_USED = 20


class Flow(StatesGroup):
    amount = State()  # after /add or the "Add" prompt: next message is an amount
    edit_amount = State()
    edit_note = State()


async def end_flow(state: FSMContext) -> None:
    """Leave any text-input flow but keep pending pickers (drafts)."""
    await state.set_state(None)
    data = await state.get_data()
    if "edit" in data:
        data.pop("edit")
        await state.set_data(data)


async def put_draft(state: FSMContext, message_id: int, amount_minor: int, note: str | None) -> None:
    data = await state.get_data()
    drafts: dict[str, Any] = dict(data.get("drafts", {}))
    drafts[str(message_id)] = {"a": amount_minor, "n": note}
    while len(drafts) > MAX_DRAFTS:
        drafts.pop(next(iter(drafts)))
    await state.update_data(drafts=drafts)


async def take_draft(state: FSMContext, message_id: int) -> tuple[dict[str, Any] | None, bool]:
    """Pop the draft for a picker; return (draft or None, already_used).

    Marks the picker as used in the same step, so a double tap cannot save twice.
    """
    data = await state.get_data()
    used: list[int] = list(data.get("used", []))
    if message_id in used:
        return None, True
    drafts: dict[str, Any] = dict(data.get("drafts", {}))
    draft = drafts.pop(str(message_id), None)
    used = [*used, message_id][-MAX_USED:]
    await state.update_data(drafts=drafts, used=used)
    return draft, False


async def restore_draft(state: FSMContext, message_id: int, draft: dict[str, Any] | None) -> None:
    data = await state.get_data()
    used = [m for m in data.get("used", []) if m != message_id]
    await state.update_data(used=used)
    if draft is not None:
        await put_draft(state, message_id, draft["a"], draft["n"])


async def category_candidates(pool: asyncpg.Pool, user_id: int) -> list[str]:
    return categories.merge(categories.DEFAULT_CATEGORIES, await repo.known_categories(pool, user_id))


async def picker_names(pool: asyncpg.Pool, user_id: int) -> list[str]:
    return categories.picker_order(await repo.frequent_categories(pool, user_id))


# --- expense card ------------------------------------------------------------------


async def card_text(
    pool: asyncpg.Pool,
    user_id: int,
    row: Any,
    origin: str,
    *,
    title: str | None = None,
    prompt: str | None = None,
) -> str:
    footer = None
    if origin == "s":
        title = title or "✅ <b>Saved</b>"
        day = Period.current("d")
        month = Period.current("m")
        day_total = await repo.currency_totals(pool, user_id, *day.bounds())
        month_total = await repo.currency_totals(pool, user_id, *month.bounds())
        footer = render.running_totals(day_total, month_total, month)
    else:
        title = title or "🧾 <b>Expense</b>"
    return render.expense_card(row, render.CardContext(title=title, footer=footer, prompt=prompt))


# --- overview ----------------------------------------------------------------------


async def overview_screen(pool: asyncpg.Pool, user_id: int, period: Period) -> tuple[str, InlineKeyboardMarkup]:
    start, end = period.bounds()
    rows = await repo.category_totals(pool, user_id, start, end)

    prev_start, prev_end = period.prev.bounds()
    partial = False
    elapsed_days = None
    if period.is_current():
        # Compare with the previous period up to the same point in time, not its full total.
        cut = min(prev_start + (now_local() - start), prev_end)
        partial = cut < prev_end
        prev_end = cut
        elapsed_days = (today_local() - period.start).days + 1
    previous = await repo.currency_totals(pool, user_id, prev_start, prev_end)

    entries: list[Any] = []
    if period.kind == "d" and rows:
        entries = await repo.expenses_between(pool, user_id, start, end)

    text = render.overview(
        render.Overview(
            period=period,
            category_rows=rows,
            previous_totals=previous,
            previous_partial=partial,
            entries=entries,
            elapsed_days=elapsed_days,
        )
    )
    return text, keyboards.overview_nav(period)


# --- history -----------------------------------------------------------------------


async def history_screen(
    pool: asyncpg.Pool, user_id: int, page: int
) -> tuple[str, InlineKeyboardMarkup | None]:
    page = max(page, 0)
    rows, total = await repo.list_expenses(pool, user_id, HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)
    pages = max(1, -(-total // HISTORY_PAGE_SIZE))
    if not rows and total and page >= pages:
        # The page disappeared (entries deleted): show the last one instead.
        page = pages - 1
        rows, total = await repo.list_expenses(pool, user_id, HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)
    text = render.history_page(rows, page, pages, total, page * HISTORY_PAGE_SIZE)
    markup = keyboards.history([r["id"] for r in rows], page, pages) if rows else None
    return text, markup
