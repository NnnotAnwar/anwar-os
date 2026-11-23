"""Shared screen builders and the in-memory conversation state.

Expenses live in Budget (anwar.os); handlers reach them through `api` (api.BudgetApi,
injected by the dispatcher). FSM data (aiogram MemoryStorage, per chat+user, lost on
restart like the old bot's /add):
  drafts  {picker message id: {"a": amount_minor, "n": note, "d": iso day}}  pending pickers
  used    [picker message ids]                                               pickers already saved
  edit    {"id", "origin", "card"}                                           expense being edited by text
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from typing import Any

from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import InlineKeyboardMarkup

from .. import categories, keyboards, render
from ..api import BudgetApi, Category, Expense, Totals
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


async def put_draft(state: FSMContext, message_id: int, amount_minor: int, note: str | None, day: str | None = None) -> None:
    data = await state.get_data()
    drafts: dict[str, Any] = dict(data.get("drafts", {}))
    drafts[str(message_id)] = {"a": amount_minor, "n": note, "d": day}
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
        await put_draft(state, message_id, draft["a"], draft["n"], draft.get("d"))


async def category_candidates(api: BudgetApi) -> list[Category]:
    """Budget's expense categories, most used first."""
    return (await api.setup()).categories


async def picker_names(api: BudgetApi) -> list[Category]:
    return categories.picker_order(await category_candidates(api))


def category_of(row: Expense, candidates: Sequence[Category]) -> Category | None:
    return next((c for c in candidates if c.id == row.get("category_id")), None)


# --- expense card ------------------------------------------------------------------


def card_text(
    row: Expense,
    origin: str,
    *,
    totals: Totals | None = None,
    currency: str | None = None,
    title: str | None = None,
    prompt: str | None = None,
) -> str:
    """The card for one expense. Right after saving ("s") it carries today's and this month's totals."""
    footer = None
    if origin == "s":
        title = title or "✅ <b>Saved</b>"
        if totals is not None:
            footer = render.running_totals(totals.day, totals.month, Period.current("m"), currency or row["currency"])
    else:
        title = title or "🧾 <b>Expense</b>"
    return render.expense_card(row, render.CardContext(title=title, footer=footer, prompt=prompt))


# --- overview ----------------------------------------------------------------------


def category_rows(rows: Sequence[Expense]) -> list[dict[str, Any]]:
    """Per (category, currency): total_minor and count, largest first."""
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["category"], row["currency"])
        group = groups.setdefault(key, {"category": row["category"], "currency": row["currency"], "total_minor": 0, "n": 0})
        group["total_minor"] += row["amount_minor"]
        group["n"] += 1
    return sorted(groups.values(), key=lambda g: (-g["total_minor"], g["category"]))


def currency_totals(rows: Sequence[Expense]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for row in rows:
        totals[row["currency"]] = totals.get(row["currency"], 0) + row["amount_minor"]
    return totals


async def overview_screen(api: BudgetApi, period: Period) -> tuple[str, InlineKeyboardMarkup]:
    previous_period = period.prev
    # One call for both periods: the previous one directly precedes this one.
    rows = await api.between(previous_period.start, period.end - timedelta(days=1))
    current = [r for r in rows if period.contains(r["occurred_on"])]
    previous = [r for r in rows if previous_period.contains(r["occurred_on"])]

    partial = False
    elapsed_days = None
    if period.is_current():
        # Compare with the previous period up to the same point in time, not its full total.
        start, _ = period.bounds()
        prev_start, prev_end = previous_period.bounds()
        cut = min(prev_start + (now_local() - start), prev_end)
        partial = cut < prev_end
        previous = [r for r in previous if r["when"] < cut]
        elapsed_days = (today_local() - period.start).days + 1

    text = render.overview(
        render.Overview(
            period=period,
            category_rows=category_rows(current),
            previous_totals=currency_totals(previous),
            previous_partial=partial,
            entries=current if period.kind == "d" else [],
            elapsed_days=elapsed_days,
        )
    )
    return text, keyboards.overview_nav(period)


# --- history -----------------------------------------------------------------------


async def history_screen(api: BudgetApi, page: int) -> tuple[str, InlineKeyboardMarkup | None]:
    page = max(page, 0)
    rows, total = await api.recent(HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)
    pages = max(1, -(-total // HISTORY_PAGE_SIZE))
    if not rows and total and page >= pages:
        # The page disappeared (entries deleted): show the last one instead.
        page = pages - 1
        rows, total = await api.recent(HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)
    text = render.history_page(rows, page, pages, total, page * HISTORY_PAGE_SIZE)
    markup = keyboards.history([r["id"] for r in rows], page, pages) if rows else None
    return text, markup
