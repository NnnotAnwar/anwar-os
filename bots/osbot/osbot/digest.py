"""Scheduled digests: payment reminders and the Sunday weekly review.

Payments: from 10:00 (OSBOT_TIMEZONE) the bot asks once a minute for
recurring expenses charging tomorrow that it hasn't reminded about yet, sends
them as one message and acknowledges their keys. Later additions for tomorrow
get their own message; nothing is sent twice.

Weekly review: on Sunday from 19:00 until midnight the bot sends the review of
the week once. The web app remembers it was sent (weekly/ack), so a restart
doesn't repeat it; the bot also remembers it in memory, so it doesn't ask
every minute. 💤 Snooze sends a fresh copy an hour later (kept in memory, like
reminder snoozes); ⏭ Skip just closes it. /week shows it any time.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .fmt import day_label, esc, iso_day, local, plural, truncate
from .keyboards import url_button
from .loops import every_minute
from .tg import send_card

log = logging.getLogger(__name__)

PAYMENT_REMINDER_HOUR = 10
REVIEW_WEEKDAY = 6  # Sunday (Monday = 0)
REVIEW_HOUR = 19
SNOOZE_MINUTES = 60
EVENTS_SHOWN = 5
PAYMENTS_SHOWN = 5

NBSP = " "  # keeps "1 240 CZK" on one line
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


# --- money ----------------------------------------------------------------------


def money(minor: int, currency: str, *, signed: bool = False) -> str:
    """124000, "CZK" → "1 240 CZK"; 1550 → "15.50 CZK"; signed: "+1 240 CZK" / "−1 240 CZK"."""
    sign = "−" if minor < 0 else "+" if signed and minor > 0 else ""
    whole, cents = divmod(abs(int(minor)), 100)
    number = f"{whole:,}".replace(",", NBSP) + (f".{cents:02d}" if cents else "")
    return f"{sign}{number}{NBSP}{currency}"


def fx_parts(spending: dict[str, Any]) -> tuple[str, str | None]:
    """How other currencies went into a spending total (the web converts them at
    each day's ČNB rate): ("≈ ", "<i>EUR converted · rates: ČNB, 25 Nov</i>"),
    or ("", None) when everything was in the base currency already."""
    fx = spending.get("fx") or {}
    converted = [str(c) for c in fx.get("converted") or []]
    unavailable = [str(c) for c in fx.get("unavailable") or []]
    notes = []
    if converted:
        day = iso_day(fx.get("rateOn"))
        when = f", {day.day} {MONTHS[day.month - 1][:3]}" if day else ""
        older = " (some older)" if fx.get("approximate") else ""
        notes.append(f"{esc(', '.join(converted))} converted · rates: ČNB{when}{older}")
    if unavailable:
        notes.append(f"{esc(', '.join(unavailable))} not counted (no rate)")
    return ("≈ " if converted else "", f"<i>{' · '.join(notes)}</i>" if notes else None)


def _totals(items: list[dict[str, Any]]) -> str:
    """Sum per currency, in order of appearance: "1 547 CZK + 9.99 EUR"."""
    sums: dict[str, int] = {}
    for item in items:
        sums[item["currency"]] = sums.get(item["currency"], 0) + int(item["amountMinor"])
    return " + ".join(money(v, c) for c, v in sums.items())


# --- payment reminders -------------------------------------------------------------


def payments_text(data: dict[str, Any]) -> str:
    """💳 Tomorrow: Netflix · 299 CZK, or a list when several charge tomorrow."""
    items = data.get("items") or []
    if len(items) == 1:
        item = items[0]
        line = f"💳 <b>Tomorrow: {esc(truncate(item['title'], 80))}</b> · {money(item['amountMinor'], item['currency'])}"
        kind = "Subscription" if item.get("subscription") else "Recurring payment"
        return f"{line}\n<i>{kind} · charges {esc(day_label(iso_day(item['date']) or date.today()))}</i>"
    lines = [f"💳 <b>{len(items)} payments tomorrow</b> · {_totals(items)}"]
    for item in items:
        lines.append(f"• {esc(truncate(item['title'], 60))} · {money(item['amountMinor'], item['currency'])}")
    return "\n".join(lines)


def payments_keyboard(data: dict[str, Any]) -> InlineKeyboardMarkup | None:
    button = url_button("↗ Subscriptions", data.get("url"))
    return InlineKeyboardMarkup(inline_keyboard=[[button]]) if button else None


async def payments_once(bot: Any, api: Any, chat_id: int, now: datetime | None = None) -> int:
    """From PAYMENT_REMINDER_HOUR on: tomorrow's unreminded charges in one message, then ack. Returns how many."""
    now = now or datetime.now(UTC)
    if local(now).hour < PAYMENT_REMINDER_HOUR:
        return 0
    try:
        data = await api.payments_due()
    except Exception:
        log.warning("could not fetch due payments", exc_info=True)
        return 0
    items = data.get("items") or []
    if not items:
        return 0
    try:
        await send_card(bot, chat_id, payments_text(data), payments_keyboard(data))
    except Exception:
        log.warning("could not send a payment reminder", exc_info=True)
        return 0  # not acked: retried next minute
    try:
        await api.ack_payments([item["key"] for item in items])
    except Exception:
        log.warning("could not ack payment reminders", exc_info=True)
    return len(items)


# --- weekly review -----------------------------------------------------------------


class WeekCb(CallbackData, prefix="wk"):
    """snz (send again in an hour) | skip | ref (refresh /week)."""

    action: str


def _change(this: int, last: int) -> str:
    if last <= 0:
        return ""
    pct = round((this - last) / last * 100)
    if pct == 0:
        return " · same as last week"
    arrow = "▲" if pct > 0 else "▼"
    return f" · {arrow} {abs(pct)} % vs last week"


def _focus_item(task: dict[str, Any], today: date | None) -> str:
    title = esc(truncate(task["title"], 50))
    due = iso_day(task.get("dueDate"))
    if task.get("overdue"):
        return f"{title} <i>(overdue)</i>"
    if due and today and due == today:
        return f"{title} <i>(today)</i>"
    if due:
        return f"{title} <i>({esc(day_label(due))})</i>"
    return title


def weekly_text(data: dict[str, Any], *, footer: str | None = None) -> str:
    """The weekly card: tasks, focus, next week's calendar, spending, payments, what came in."""
    today = iso_day(data.get("today"))
    lines = [f"🗓 <b>Your week</b> · {esc(data['week']['label'])}"]

    tasks = data.get("tasks")
    if tasks:
        parts = [f"{tasks['done']} done", f"{tasks['added']} added"]
        if tasks.get("overdue"):
            parts.append(f"⚠️ {tasks['overdue']} overdue")
        lines += ["", "✅ <b>Tasks</b> · " + " · ".join(parts)]
    focus = data.get("focus") or []
    if focus:
        lines.append("🎯 <b>Focus</b>: " + " · ".join(_focus_item(t, today) for t in focus))

    calendar = data.get("calendar")
    if calendar is not None:
        total = int(calendar.get("total") or 0)
        head = f"📅 <b>Next week</b> · {plural(total, 'event')}" if total else "📅 <b>Next week</b> · <i>nothing in the calendar</i>"
        lines += ["", head]
        events = calendar.get("events") or []
        width = max((len(f"{e['day']} {e['time']}") for e in events), default=0)
        for event in events[:EVENTS_SHOWN]:
            when = f"{event['day']} {event['time']}".ljust(width)
            lines.append(f"<code>{esc(when)}</code>  {esc(truncate(event['title'], 60))}")
        if total > min(len(events), EVENTS_SHOWN):
            lines.append(f"<i>+{total - min(len(events), EVENTS_SHOWN)} more</i>")

    spending = data.get("spending")
    if spending is not None:
        currency = spending["currency"]
        this, last = int(spending["thisWeekMinor"]), int(spending["lastWeekMinor"])
        ish, rates = fx_parts(spending)
        lines += ["", f"💸 <b>Spent</b> {ish}{money(this, currency)}{_change(this, last)}"]
        top = spending.get("top") or []
        if top:
            lines.append(" · ".join(f"{esc(truncate(c['name'], 24))} {money(c['amountMinor'], currency)}" for c in top))
        if rates:
            lines.append(rates)
        plan = spending.get("plan")
        if plan:
            month = MONTHS[int(plan["month"][5:7]) - 1]
            net = int(plan["monthNetMinor"])
            goal = int(plan["monthlyContributionMinor"])
            done = " ✓" if net >= goal else ""
            lines.append(f"Plan: save {money(goal, currency)} a month · {month} so far {money(net, currency, signed=True)}{done}")

    payments = data.get("payments")
    if payments is not None and payments.get("items"):
        items = payments["items"]
        lines += ["", f"💳 <b>Payments next week</b> · {_totals(items)}"]
        for item in items[:PAYMENTS_SHOWN]:
            day = iso_day(item["date"])
            lines.append(f"{esc(day_label(day)) if day else ''} · {esc(truncate(item['title'], 50))} · {money(item['amountMinor'], item['currency'])}")
        if len(items) > PAYMENTS_SHOWN:
            lines.append(f"<i>+{len(items) - PAYMENTS_SHOWN} more</i>")

    captured = data.get("captured") or {}
    counts = [
        plural(n, unit, units)
        for key, unit, units in (("ideas", "idea", None), ("notes", "note", None), ("links", "link", None), ("feedback", "feedback message", None))
        if (n := captured.get(key))
    ]
    if counts:
        lines += ["", "📥 <b>New this week</b> · " + " · ".join(counts)]

    if footer:
        lines += ["", f"<i>{esc(footer)}</i>"]
    return "\n".join(lines)


def _button(text: str, data: CallbackData) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data.pack())


def weekly_keyboard(data: dict[str, Any], *, scheduled: bool) -> InlineKeyboardMarkup:
    """Sunday's card: Open, Snooze, Skip. /week: Open, Refresh."""
    first = [b for b in [url_button("↗ Open in app", data.get("url"))] if b]
    if scheduled:
        rows = [first + [_button("💤 1 h", WeekCb(action="snz")), _button("⏭ Skip", WeekCb(action="skip"))]]
    else:
        rows = [first + [_button("🔄 Refresh", WeekCb(action="ref"))]]
    return InlineKeyboardMarkup(inline_keyboard=rows)


@dataclass
class WeeklyMemory:
    """The week last sent (its Monday) and a pending snooze. In memory: a restart forgets the snooze."""

    sent_week: str | None = None
    snoozed_until: datetime | None = None

    def snooze(self, until: datetime) -> None:
        self.snoozed_until = until

    def snooze_due(self, now: datetime) -> bool:
        if self.snoozed_until is not None and self.snoozed_until <= now:
            self.snoozed_until = None
            return True
        return False


def review_time(now: datetime) -> bool:
    """Sunday from REVIEW_HOUR until midnight, in the bot's time zone."""
    at = local(now)
    return at.weekday() == REVIEW_WEEKDAY and at.hour >= REVIEW_HOUR


def week_key(now: datetime) -> str:
    """This week's Monday in the bot's time zone (what the web app keys the review by)."""
    day = local(now).date()
    return (day - timedelta(days=day.weekday())).isoformat()


async def weekly_once(bot: Any, api: Any, chat_id: int, now: datetime | None = None, memory: WeeklyMemory | None = None) -> bool:
    """Sends a snoozed review whose hour has come, or Sunday's review once. True when something was sent."""
    now = now or datetime.now(UTC)
    memory = memory if memory is not None else WeeklyMemory()
    if memory.snooze_due(now):
        try:
            data = await api.weekly()
            await send_card(bot, chat_id, weekly_text(data, footer="💤 Snoozed"), weekly_keyboard(data, scheduled=False))
            return True
        except Exception:
            log.warning("could not send the snoozed weekly review", exc_info=True)
            memory.snooze(now + timedelta(minutes=1))
            return False
    if not review_time(now) or memory.sent_week == week_key(now):
        return False
    try:
        data = await api.weekly()
    except Exception:
        log.warning("could not fetch the weekly review", exc_info=True)
        return False
    key = data["week"]["key"]
    if data.get("delivered"):
        memory.sent_week = key
        return False
    try:
        await send_card(bot, chat_id, weekly_text(data), weekly_keyboard(data, scheduled=True))
    except Exception:
        log.warning("could not send the weekly review", exc_info=True)
        return False  # not acked: retried next minute
    memory.sent_week = key
    try:
        await api.ack_weekly(key)
    except Exception:
        # Sent but not recorded: the in-memory mark keeps it from repeating until a restart.
        log.warning("could not ack the weekly review", exc_info=True)
    return True


def digest_tasks(bot: Any, api: Any, chat_id: int, memory: WeeklyMemory) -> list[asyncio.Task]:
    return [
        asyncio.create_task(every_minute(lambda: payments_once(bot, api, chat_id), name="payments"), name="payments"),
        asyncio.create_task(every_minute(lambda: weekly_once(bot, api, chat_id, memory=memory), name="weekly"), name="weekly"),
    ]
