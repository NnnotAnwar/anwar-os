"""/limits: this month's category limits, rendered (pure: data in, HTML out).

The data comes from GET /api/internal/budget-bot/limits (Budget's own `limits`
action): each category with a monthly limit, what the month has spent (its
subcategories included), what's left and its status, the fullest first.
Amounts are minor units in Budget's base currency.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date
from html import escape
from typing import Any

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .money import format_amount
from .subscriptions import _linkable

SHOWN = 12
BAR_WIDTH = 10

Row = Mapping[str, Any]

STATUS_ICON = {"ok": "🟢", "near": "🟠", "over": "🔴"}


class LimitsCb(CallbackData, prefix="lim"):
    """Refresh the /limits card."""


def bar(spent: int, limit: int, width: int = BAR_WIDTH) -> str:
    """▰▰▰▰▱▱▱▱▱▱ — filled to the share used, full once over."""
    filled = width if limit <= 0 or spent >= limit else round(spent / limit * width)
    if 0 < spent < limit and filled == 0:
        filled = 1  # something was spent: show it
    return "▰" * filled + "▱" * (width - filled)


def _item(item: Row, currency: str) -> list[str]:
    spent, limit, left = int(item["spentMinor"]), int(item["limitMinor"]), int(item["leftMinor"])
    icon = STATUS_ICON.get(item.get("status") or "ok", "🟢")
    head = f"{icon} <b>{escape(item['name'])}</b> · {format_amount(spent, currency)} of {format_amount(limit, currency)}"
    if left < 0:
        tail = f"over by {format_amount(-left, currency)}"
    elif left == 0:
        tail = "used up"
    else:
        tail = f"{format_amount(left, currency)} left"
    line = f"<code>{bar(spent, limit)}</code> {int(item.get('percent') or 0)} % · {tail}"
    pace = item.get("paceMinor")
    if item.get("status") == "ok" and pace is not None and int(pace) > limit:
        line += f"\n<i>On pace for {format_amount(int(pace), currency)} this month</i>"
    return [head, line]


def limits_text(data: Row) -> str:
    currency = data.get("currency") or "CZK"
    items = data.get("items") or []
    month = date.fromisoformat(f"{data['month']}-01") if data.get("month") else date.today()
    if not items:
        return (
            "🎯 <b>No limits yet</b>\n"
            "Set a monthly limit for a category in Budget → Limits on anwar.os. "
            "I'll show what's left under every expense, and osbot warns you at 90 % and when it's used up."
        )
    spent = sum(int(i["spentMinor"]) for i in items)
    total = sum(int(i["limitMinor"]) for i in items)
    over = sum(1 for i in items if i.get("status") == "over")
    near = sum(1 for i in items if i.get("status") == "near")
    summary = [f"{format_amount(spent, currency)} of {format_amount(total, currency)}"]
    if over:
        summary.append(f"{over} over")
    if near:
        summary.append(f"{near} close")
    lines = [f"🎯 <b>Limits · {month:%B}</b>", f"<i>{' · '.join(summary)}</i>"]
    for item in items[:SHOWN]:
        lines += ["", *_item(item, currency)]
    if len(items) > SHOWN:
        lines += ["", f"<i>+{len(items) - SHOWN} more in Budget</i>"]
    return "\n".join(lines)


def limits_keyboard(data: Row) -> InlineKeyboardMarkup:
    row = [InlineKeyboardButton(text="🔄 Refresh", callback_data=LimitsCb().pack())]
    if _linkable(data.get("url")):
        row.append(InlineKeyboardButton(text="↗ Open in Budget", url=data["url"]))
    return InlineKeyboardMarkup(inline_keyboard=[row])
