from html import escape

import asyncpg
from aiogram import Router, types
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart

from .. import repo
from ..money import format_amount

router = Router()


@router.message(CommandStart())
async def cmd_start(message: types.Message) -> None:
    welcome_text = (
        f"Hello, {message.from_user.first_name}! 👋\n\n"
        "I am your Personal Expense Tracker Bot.\n"
        "Here are my commands:\n"
        "/add - Add a new expense\n"
        "/history - View recent expenses\n"
        "/stats - View current month statistics\n"
        "/help - Show this message again"
    )
    await message.answer(welcome_text)


@router.message(Command("help"))
async def cmd_help(message: types.Message) -> None:
    help_text = (
        "Commands:\n"
        "/add - Add a new expense (e.g. amount -> category)\n"
        "/history - Last 5 expenses\n"
        "/stats - Summary for the current month"
    )
    await message.answer(help_text)


@router.message(Command("history"))
async def cmd_history(message: types.Message, pool: asyncpg.Pool) -> None:
    expenses = await repo.get_recent_expenses(pool, message.from_user.id)
    if not expenses:
        await message.answer("You don't have any expenses yet.")
        return

    text = "🗓 <b>Recent Expenses:</b>\n\n"
    for row in expenses:
        amount = format_amount(row["amount_minor"], row["currency"])
        date_formatted = row["created_at"].strftime("%Y-%m-%d %H:%M")
        text += f"• <b>{amount}</b> - {escape(row['category'])} ({date_formatted})\n"

    await message.answer(text, parse_mode=ParseMode.HTML)


@router.message(Command("stats"))
async def cmd_stats(message: types.Message, pool: asyncpg.Pool) -> None:
    stats = await repo.get_monthly_stats(pool, message.from_user.id)
    if not stats:
        await message.answer("No expenses recorded for this month.")
        return

    totals: dict[str, int] = {}
    text = "📊 <b>Current Month Statistics:</b>\n\n"
    for row in stats:
        totals[row["currency"]] = totals.get(row["currency"], 0) + row["total_minor"]
        text += f"• {escape(row['category'])}: <b>{format_amount(row['total_minor'], row['currency'])}</b>\n"

    total = ", ".join(format_amount(minor, currency) for currency, minor in sorted(totals.items()))
    text += f"\n💰 <b>Total:</b> <b>{total}</b>"
    await message.answer(text, parse_mode=ParseMode.HTML)
