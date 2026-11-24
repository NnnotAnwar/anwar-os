"""/subscriptions: Budget's recurring expenses, rendered (pure: data in, HTML out).

The data comes from GET /api/internal/budget-bot/subscriptions (Budget's own
`subscriptions` action): every recurring expense with its cadence, next charge
and monthly/yearly cost, plus totals. Subscriptions are listed one by one;
other recurring payments (rent, bills) get one summary line.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date
from html import escape
from typing import Any
from urllib.parse import urlsplit

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .money import format_amount
from .periods import human_day

SHOWN = 15

Row = Mapping[str, Any]


class SubscriptionsCb(CallbackData, prefix="subs"):
    """Refresh the /subscriptions card."""


def _when(item: Row, today: date) -> str:
    if not item.get("active"):
        return "paused"
    if not item.get("nextCharge"):
        return "finished"
    day = date.fromisoformat(item["nextCharge"])
    if day == today:
        return "charges today"
    delta = (day - today).days
    return "charges tomorrow" if delta == 1 else f"next {human_day(day, today)}"


def _cost_line(costs: Sequence[Row]) -> str:
    return " + ".join(format_amount(int(c["monthlyMinor"]), c["currency"]) for c in costs)


def subscriptions_text(data: Row) -> str:
    today = date.fromisoformat(data["today"])
    items = data.get("items") or []
    subs = [i for i in items if i.get("subscription")]
    others = [i for i in items if not i.get("subscription") and i.get("active") and i.get("nextCharge")]
    totals = data.get("subscriptions") or []

    if totals:
        main = totals[0]
        head = (
            f"🔁 <b>Subscriptions cost {format_amount(int(main['monthlyMinor']), main['currency'])} a month</b>"
            f" · {format_amount(int(main['yearlyMinor']), main['currency'])} a year"
        )
        extra = [f"also {format_amount(int(c['monthlyMinor']), c['currency'])} a month in {c['currency']}" for c in totals[1:]]
        lines = [head + (f"\n<i>{escape(' · '.join(extra))}</i>" if extra else "")]
    elif subs:
        lines = ["🔁 <b>Subscriptions</b> · all paused"]
    else:
        lines = ["🔁 <b>No subscriptions yet</b>", "Add them in Budget → Subscriptions on anwar.os: you'll see what they cost and get a reminder the day before each charge."]

    if subs:
        lines.append("")
    for item in subs[:SHOWN]:
        amount = format_amount(int(item["amountMinor"]), item["currency"])
        title = escape(item["title"])
        cadence = escape(str(item.get("cadence") or "").lower())
        if not item.get("active") or not item.get("nextCharge"):
            lines.append(f"⏸ <s>{title}</s> · {amount} · <i>{_when(item, today)}</i>")
            continue
        monthly = ""
        if item.get("cadence") != "Every month" and int(item.get("monthlyMinor") or 0) > 0:
            monthly = f" (≈ {format_amount(int(item['monthlyMinor']), item['currency'])} a month)"
        lines.append(f"<b>{title}</b> · {amount} {cadence}{monthly} · <i>{_when(item, today)}</i>")
    if len(subs) > SHOWN:
        lines.append(f"<i>+{len(subs) - SHOWN} more in Budget</i>")

    if others:
        currency_costs: dict[str, int] = {}
        for item in others:
            currency_costs[item["currency"]] = currency_costs.get(item["currency"], 0) + int(item["monthlyMinor"])
        cost = " + ".join(format_amount(v, c) for c, v in currency_costs.items())
        names = ", ".join(escape(i["title"]) for i in others[:3]) + ("…" if len(others) > 3 else "")
        lines += ["", f"Other recurring payments: {len(others)} · {cost} a month <i>({names})</i>"]
    return "\n".join(lines)


def _linkable(url: str | None) -> bool:
    """Telegram refuses URL buttons to localhost, IPs and single-label hosts (the stack's `web`)."""
    if not url:
        return False
    host = urlsplit(url).hostname or ""
    return "." in host and not host.replace(".", "").isdigit() and not host.endswith(".localhost")


def subscriptions_keyboard(data: Row) -> InlineKeyboardMarkup:
    row = [InlineKeyboardButton(text="🔄 Refresh", callback_data=SubscriptionsCb().pack())]
    if _linkable(data.get("url")):
        row.append(InlineKeyboardButton(text="↗ Open in Budget", url=data["url"]))
    return InlineKeyboardMarkup(inline_keyboard=[row])
