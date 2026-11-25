"""The monthly report: on the 1st from 10:00 (OSBOT_TIMEZONE) the bot sends
last month's card once, with its PDF filed into Files → Reports first.

Like the weekly review, the web app remembers the card was sent
(monthly/ack), so a restart doesn't repeat it, and the bot remembers it in
memory so it doesn't ask every minute. /month shows any month on demand
(this month so far by default) and never marks anything as sent.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .digest import fx_parts, money
from .fmt import day_label, esc, iso_day, local, plural, truncate
from .keyboards import url_button
from .loops import every_minute
from .tg import send_card

log = logging.getLogger(__name__)

REPORT_DAY = 1
REPORT_HOUR = 10
CATEGORIES_SHOWN = 3
PAGES_SHOWN = 3

MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class MonthCb(CallbackData, prefix="mo"):
    """ref: refresh a /month card (`month` = the month it shows)."""

    action: str
    month: str = ""


# --- the card ------------------------------------------------------------------------


def _pct(current: int, previous: int) -> str:
    """" · ▲ 24 % vs September", "" without a previous figure."""
    if previous <= 0:
        return ""
    pct = round((current - previous) / previous * 100)
    if pct == 0:
        return " · same as before"
    return f" · {'▲' if pct > 0 else '▼'} {abs(pct)} %"


def _first_word(label: str) -> str:
    return label.split(" ")[0] if label else ""


def monthly_text(data: dict[str, Any]) -> str:
    """Money, subscriptions, tasks, what came in and site views, each line only when there is something to say."""
    partial = bool(data.get("partial"))
    prev = _first_word(data.get("previousLabel", ""))
    head = f"📊 <b>{esc(data['label'])}</b> · {'so far' if partial else 'monthly report'}"
    lines = [head]

    spending = data.get("spending")
    if spending is not None:
        currency = spending["currency"]
        spent, before = int(spending["expenseMinor"]), int(spending["previousExpenseMinor"])
        change = _pct(spent, before)
        ish, rates = fx_parts(spending)
        lines += ["", f"💸 <b>Spent</b> {ish}{money(spent, currency)}{change}{f' vs {esc(prev)}' if change and prev else ''}"]
        income, net = int(spending["incomeMinor"]), int(spending["netMinor"])
        if income or net:
            lines.append(f"Income {ish}{money(income, currency)} · Net {ish}{money(net, currency, signed=True)}")
        top = [c for c in spending.get("categories") or [] if int(c["amountMinor"]) > 0][:CATEGORIES_SHOWN]
        if top:
            lines.append(" · ".join(f"{esc(truncate(c['name'], 24))} {money(c['amountMinor'], currency)}" for c in top))
        changes = spending.get("changes") or []
        if changes:
            moves = [
                f"{esc(truncate(c['name'], 24))} {money(int(c['amountMinor']) - int(c['previousMinor']), currency, signed=True)}"
                for c in changes
            ]
            lines.append("📈 <b>Biggest changes</b>: " + " · ".join(moves))
        if rates:
            lines.append(rates)
        for other in spending.get("otherCurrencies") or []:
            lines.append(f"<i>Also {money(other['expenseMinor'], other['currency'])} spent in {esc(other['currency'])}, not in the total</i>")

    subscriptions = data.get("subscriptions")
    if subscriptions is not None and subscriptions.get("totals"):
        totals = subscriptions["totals"]
        count = sum(int(t["count"]) for t in totals)
        cost = " + ".join(money(t["monthlyMinor"], t["currency"]) for t in totals)
        lines += ["", f"💳 <b>Subscriptions</b> {cost} a month · {count} active"]

    tasks = data.get("tasks")
    captured = data.get("captured") or {}
    counts = [
        plural(n, unit)
        for key, unit in (("notes", "note"), ("ideas", "idea"), ("links", "link"), ("feedback", "feedback message"))
        if (n := captured.get(key))
    ]
    if tasks is not None or counts:
        lines.append("")
        if tasks is not None:
            done, added = int(tasks["done"]), int(tasks["added"])
            lines.append(f"✅ <b>Tasks</b> {done} done{_pct(done, int(tasks.get('previousDone') or 0))} · {added} added")
        if counts:
            lines.append("📥 <b>New</b> · " + " · ".join(counts))

    site = data.get("site")
    if site is not None and (site.get("views") or site.get("previousViews")):
        views = int(site["views"])
        line = f"🌐 <b>Site</b> {plural(views, 'view')}{_pct(views, int(site.get('previousViews') or 0))}"
        pages = (site.get("pages") or [])[:PAGES_SHOWN]
        if pages:
            line += " · top: " + " · ".join(f"{esc(truncate(p['label'], 24))} {p['views']}" for p in pages)
        lines += ["", line]

    journal = data.get("journal")
    if journal and journal.get("written"):
        lines += ["", journal_line(journal)]

    if len(lines) == 1:
        lines += ["", "<i>Nothing recorded this month yet.</i>"]
    return "\n".join(lines)


JOURNAL_FACES = {1: "😞", 2: "🙁", 3: "😐", 4: "🙂", 5: "😄"}


def journal_line(journal: dict[str, Any]) -> str:
    """📓 Journal 18 days · mood 3.8 🙂 · best Tue 12 Nov 😄 · hardest Fri 3 Nov 😞"""
    parts = [f"📓 <b>Journal</b> {plural(int(journal['written']), 'day')}"]
    average = journal.get("averageMood")
    if average is not None:
        parts.append(f"mood {float(average):.1f} {JOURNAL_FACES.get(round(float(average)), '')}".rstrip())
    for key, label in (("best", "best"), ("worst", "hardest")):
        day = journal.get(key)
        when = iso_day(day.get("day")) if day else None
        if day and when:
            parts.append(f"{label} {esc(day_label(when))} {JOURNAL_FACES.get(int(day['mood']), '')}".rstrip())
    return " · ".join(parts)


def monthly_keyboard(data: dict[str, Any], *, pdf_url: str | None = None, refresh: bool = False) -> InlineKeyboardMarkup | None:
    """Open in app and the PDF; /month cards add Refresh."""
    row: list[InlineKeyboardButton] = [
        b for b in (url_button("↗ Open in app", data.get("url")), url_button("📄 PDF", pdf_url or data.get("pdfUrl"))) if b
    ]
    if refresh:
        row.append(InlineKeyboardButton(text="🔄 Refresh", callback_data=MonthCb(action="ref", month=data.get("month", "")).pack()))
    return InlineKeyboardMarkup(inline_keyboard=[row]) if row else None


# --- schedule ------------------------------------------------------------------------


def previous_month(now: datetime) -> str:
    """Last month in the bot's time zone: 2026-10 on any day of November."""
    first = local(now).date().replace(day=1)
    return (first - timedelta(days=1)).strftime("%Y-%m")


def report_time(now: datetime) -> bool:
    """The 1st from REPORT_HOUR until midnight, in the bot's time zone."""
    at = local(now)
    return at.day == REPORT_DAY and at.hour >= REPORT_HOUR


def parse_month_arg(text: str, now: datetime) -> str | None | bool:
    """/month argument: "" → None (this month), "2026-10", "last"/"prev" → last month. False when unreadable."""
    arg = text.strip().lower()
    if not arg:
        return None
    if arg in ("last", "prev", "previous"):
        return previous_month(now)
    return arg if MONTH.match(arg) else False


@dataclass
class MonthlyMemory:
    """The month whose report was last sent. In memory; the web app's ack survives restarts."""

    sent_month: str | None = None


async def monthly_once(bot: Any, api: Any, chat_id: int, now: datetime | None = None, memory: MonthlyMemory | None = None) -> bool:
    """On the 1st: last month's PDF into Files, then the card, then the ack. True when the card was sent."""
    now = now or datetime.now(UTC)
    memory = memory if memory is not None else MonthlyMemory()
    key = previous_month(now)
    if not report_time(now) or memory.sent_month == key:
        return False
    try:
        data = await api.monthly(key)
    except Exception:
        log.warning("could not fetch the monthly report", exc_info=True)
        return False
    if data.get("delivered"):
        memory.sent_month = key
        return False
    pdf_url = data.get("pdfUrl")
    try:
        saved = await api.monthly_pdf(key)
        pdf_url = saved.get("url") or pdf_url
    except Exception:
        # The card still goes out; its PDF button downloads from the app instead.
        log.warning("could not file the monthly report PDF", exc_info=True)
    try:
        await send_card(bot, chat_id, monthly_text(data), monthly_keyboard(data, pdf_url=pdf_url))
    except Exception:
        log.warning("could not send the monthly report", exc_info=True)
        return False  # not acked: retried next minute (saving the PDF again replaces it)
    memory.sent_month = key
    try:
        await api.ack_monthly(key)
    except Exception:
        log.warning("could not ack the monthly report", exc_info=True)
    return True


def monthly_task(bot: Any, api: Any, chat_id: int, memory: MonthlyMemory) -> asyncio.Task:
    return asyncio.create_task(every_minute(lambda: monthly_once(bot, api, chat_id, memory=memory), name="monthly"), name="monthly")
