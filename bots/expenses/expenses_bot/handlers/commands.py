"""Commands, main-menu buttons, overviews, history pages and CSV export.

This router comes first, so commands and menu buttons work in any state and end a
pending text-input flow (editing an amount or a note).
"""

from __future__ import annotations

import csv
import io
import logging
import re
from collections.abc import Sequence
from typing import Any

import asyncpg
from aiogram import F, Router, types
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import BufferedInputFile

from .. import keyboards, render, repo
from ..keyboards import ExportCb, HistoryCb, NoopCb, PeriodCb
from ..money import format_number
from ..periods import Period, to_local
from ..ui import show
from .common import Flow, end_flow, history_screen, overview_screen

log = logging.getLogger(__name__)
router = Router(name="commands")


@router.message(CommandStart())
async def cmd_start(message: types.Message, state: FSMContext) -> None:
    await end_flow(state)
    first_name = message.from_user.first_name if message.from_user else None
    await message.answer(render.welcome(first_name), reply_markup=keyboards.main_menu())


@router.message(Command("help"))
@router.message(F.text == keyboards.MENU_HELP)
async def cmd_help(message: types.Message, state: FSMContext) -> None:
    await end_flow(state)
    await message.answer(render.help_text(), reply_markup=keyboards.main_menu())


@router.message(Command("cancel"))
async def cmd_cancel(message: types.Message, state: FSMContext) -> None:
    await end_flow(state)
    await message.answer("Okay, cancelled.", reply_markup=keyboards.main_menu())


@router.message(Command("add"))
async def cmd_add(message: types.Message, state: FSMContext) -> None:
    await end_flow(state)
    await state.set_state(Flow.amount)
    await message.answer(render.ask_amount())


# --- overviews ---------------------------------------------------------------------


async def _send_overview(message: types.Message, state: FSMContext, pool: asyncpg.Pool, kind: str) -> None:
    await end_flow(state)
    text, markup = await overview_screen(pool, message.from_user.id, Period.current(kind))  # type: ignore[arg-type,union-attr]
    await message.answer(text, reply_markup=markup)


@router.message(Command("today"))
@router.message(F.text == keyboards.MENU_TODAY)
async def cmd_today(message: types.Message, state: FSMContext, pool: asyncpg.Pool) -> None:
    await _send_overview(message, state, pool, "d")


@router.message(Command("week"))
@router.message(F.text == keyboards.MENU_WEEK)
async def cmd_week(message: types.Message, state: FSMContext, pool: asyncpg.Pool) -> None:
    await _send_overview(message, state, pool, "w")


@router.message(Command("month", "stats"))
@router.message(F.text == keyboards.MENU_MONTH)
async def cmd_month(message: types.Message, state: FSMContext, pool: asyncpg.Pool) -> None:
    await _send_overview(message, state, pool, "m")


@router.callback_query(PeriodCb.filter())
async def on_period(callback: types.CallbackQuery, callback_data: PeriodCb, pool: asyncpg.Pool) -> None:
    period = Period.decode(callback_data.p)
    if period is None or period.is_future():
        await callback.answer(render.stale(), show_alert=False)
        return
    text, markup = await overview_screen(pool, callback.from_user.id, period)
    await show(callback, text, markup)
    await callback.answer()


# --- history -----------------------------------------------------------------------


@router.message(Command("history"))
@router.message(F.text == keyboards.MENU_HISTORY)
async def cmd_history(message: types.Message, state: FSMContext, pool: asyncpg.Pool) -> None:
    await end_flow(state)
    text, markup = await history_screen(pool, message.from_user.id, 0)  # type: ignore[union-attr]
    await message.answer(text, reply_markup=markup)


@router.callback_query(HistoryCb.filter())
async def on_history_page(
    callback: types.CallbackQuery, callback_data: HistoryCb, state: FSMContext, pool: asyncpg.Pool
) -> None:
    await end_flow(state)
    text, markup = await history_screen(pool, callback.from_user.id, callback_data.page)
    await show(callback, text, markup)
    await callback.answer()


@router.callback_query(NoopCb.filter())
async def on_noop(callback: types.CallbackQuery) -> None:
    await callback.answer()


# --- CSV export --------------------------------------------------------------------

_MONTH_ARG = re.compile(r"^(\d{4})-(\d{1,2})$")


def build_csv(rows: Sequence[Any]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["date", "time", "amount", "currency", "category", "note"])
    for row in rows:
        local = to_local(row["created_at"])
        amount = format_number(row["amount_minor"]).replace("\u00a0", "")
        if "." not in amount:
            amount += ".00"
        writer.writerow(
            [f"{local:%Y-%m-%d}", f"{local:%H:%M}", amount, row["currency"], row["category"], row["note"] or ""]
        )
    # BOM so spreadsheet apps detect UTF-8 (category names, notes).
    return buffer.getvalue().encode("utf-8-sig")


async def send_export(bot_message: types.Message, pool: asyncpg.Pool, user_id: int, period: Period) -> None:
    rows = await repo.expenses_between(pool, user_id, *period.bounds())
    if not rows:
        await bot_message.answer(f"Nothing to export for {period.title()} yet.")
        return
    document = BufferedInputFile(build_csv(rows), filename=f"expenses-{period.start:%Y-%m}.csv")
    await bot_message.answer_document(document, caption=render.export_caption(period, len(rows)))


@router.message(Command("export"))
async def cmd_export(
    message: types.Message, command: CommandObject, state: FSMContext, pool: asyncpg.Pool
) -> None:
    await end_flow(state)
    period = Period.current("m")
    if command.args:
        match = _MONTH_ARG.match(command.args.strip())
        if not match or not 1 <= int(match[2]) <= 12:
            await message.answer("Use <code>/export</code> for this month or <code>/export 2026-10</code> for another one.")
            return
        period = Period.decode(f"m{int(match[1]):04d}{int(match[2]):02d}01") or period
    await send_export(message, pool, message.from_user.id, period)  # type: ignore[union-attr]


@router.callback_query(ExportCb.filter())
async def on_export(callback: types.CallbackQuery, callback_data: ExportCb, pool: asyncpg.Pool) -> None:
    period = Period.decode(callback_data.p)
    message = callback.message
    if period is None or message is None or isinstance(message, types.InaccessibleMessage):
        await callback.answer(render.stale(), show_alert=True)
        return
    await callback.answer("Preparing CSV…")
    await send_export(message, pool, callback.from_user.id, period)
