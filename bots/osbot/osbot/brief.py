"""The morning brief: one card a day at the owner's chosen time (Settings → Telegram,
default 08:00 their time, on by default).

The web app decides when it is due (GET brief/due, in the owner's time zone):
from the chosen time until 3 hours later, once a day. If the bot was down
longer than that, the day's brief is skipped rather than arriving at lunch.
Like the other digests it is sent first and acknowledged after (brief/ack), and
the bot remembers the day it sent in memory, so a failing ack doesn't repeat it
every minute.

The card: the date, today's calendar, tasks due today (numbered like /today, so
a number opens the same task card with Done / Tomorrow) and the overdue count,
today's habits as tick buttons (the /habits buttons: a tap redraws the brief),
money this month against the limits or the plan, payments charging today, or
"a clear day" when there is nothing. ↗ Today opens the app; 🔄 Refresh redraws
it. /brief shows it any time.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .digest import money
from .fmt import esc, plural, truncate
from .habits import habit_button
from .keyboards import TaskCb, url_button
from .loops import every_minute
from .tg import send_card

log = logging.getLogger(__name__)

# The first characters of every brief card: how a habit tap knows to redraw the brief.
MARKER = "☀️"
TASKS_SHOWN = 8
EVENTS_SHOWN = 8
NUMBERS_PER_ROW = 5
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


class BriefCb(CallbackData, prefix="br"):
    """ref: redraw the brief."""

    action: str


def is_brief(text: str | None) -> bool:
    return (text or "").startswith(MARKER)


def _events(data: dict[str, Any]) -> list[str]:
    events = data.get("events") or []
    if not events:
        return []
    shown = events[:EVENTS_SHOWN]
    width = max(len(e["time"]) for e in shown)
    lines = ["", f"📅 <b>Calendar</b> · {plural(len(events), 'event')}"]
    for event in shown:
        row = f"<code>{esc(event['time'].ljust(width))}</code>  {esc(truncate(event['title'], 70))}"
        if event.get("location"):
            row += f" · <i>{esc(truncate(event['location'], 40))}</i>"
        lines.append(row)
    if len(events) > EVENTS_SHOWN:
        lines.append(f"<i>+{len(events) - EVENTS_SHOWN} more in the calendar</i>")
    return lines


def _tasks(data: dict[str, Any]) -> list[str]:
    tasks = (data.get("tasks") or [])[:TASKS_SHOWN]
    total = max(int(data.get("tasksToday") or 0), len(tasks))
    overdue = int(data.get("overdue") or 0)
    if not tasks and not overdue:
        return []
    lines = [""]
    if tasks:
        lines.append(f"✅ <b>Tasks</b> · {total} due today")
        for n, task in enumerate(tasks, start=1):
            time = task.get("time")
            lines.append(f"<b>{n}.</b> {esc(truncate(task['title'], 70))}" + (f" · <i>{esc(time)}</i>" if time else ""))
        if total > len(tasks):
            lines.append(f"<i>+{total - len(tasks)} more in the app</i>")
    if overdue:
        lines.append(f"⚠️ {plural(overdue, 'task')} overdue · /today")
    return lines


def _habits(data: dict[str, Any]) -> list[str]:
    habits = data.get("habits")
    if not habits or not habits.get("total"):
        return []
    done, total = int(habits["done"]), int(habits["total"])
    status = "all done 🎉" if done == total else f"{done} of {total} done · tap to tick off"
    return ["", f"🌱 <b>Habits</b> · {status}"]


def _money(data: dict[str, Any]) -> list[str]:
    m = data.get("money")
    if not m:
        return []
    currency = m["currency"]
    month = MONTHS[int(m["month"][5:7]) - 1]
    line = f"💸 <b>Spent</b> {money(int(m['spentMinor']), currency)} in {month}"
    limits = m.get("limits")
    if limits:
        left = int(limits["leftMinor"])
        line += f" · {money(left, currency)} left of the limits" if left >= 0 else f" · {money(-left, currency)} over the limits"
    lines = ["", line]
    for cat in m.get("near") or []:
        left = int(cat["leftMinor"])
        tail = f"{money(left, currency)} left" if left > 0 else "used up" if left == 0 else f"over by {money(-left, currency)}"
        icon = "🔴" if int(cat["percent"]) >= 100 else "⚠️"
        lines.append(f"{icon} {esc(truncate(cat['name'], 30))} {int(cat['percent'])} % · {tail}")
    plan = m.get("plan")
    if plan:
        net, goal = int(plan["monthNetMinor"]), int(plan["monthlyContributionMinor"])
        done = " ✓" if net >= goal else ""
        lines.append(f"Plan: save {money(goal, currency)} a month · so far {money(net, currency, signed=True)}{done}")
    return lines


def _payments(data: dict[str, Any]) -> list[str]:
    payments = data.get("payments") or {}
    items = payments.get("items") or []
    if not items:
        return []
    listed = " · ".join(f"{esc(truncate(p['title'], 30))} {money(int(p['amountMinor']), p['currency'])}" for p in items[:4])
    more = f" · +{len(items) - 4} more" if len(items) > 4 else ""
    return ["", f"💳 <b>Charging today</b>: {listed}{more}"]


def brief_text(data: dict[str, Any], *, footer: str | None = None) -> str:
    """☀️ Wednesday 25 Nov, then each part only when there is something to say."""
    lines = [f"{MARKER} <b>{esc(data['label'])}</b>"]
    if data.get("clear"):
        lines += ["", "🌤 Nothing planned — a clear day."]
    else:
        lines += _events(data) + _tasks(data) + _habits(data) + _payments(data)
    lines += _money(data)
    hints = []
    if data.get("tasks"):
        hints.append("a number opens a task")
    if (data.get("habits") or {}).get("total"):
        hints.append("a habit ticks it off")
    if hints:
        lines += ["", f"<i>Tap {' · '.join(hints)}.</i>"]
    if footer:
        lines.append(f"<i>{esc(footer)}</i>")
    return "\n".join(lines)


def brief_keyboard(data: dict[str, Any]) -> InlineKeyboardMarkup:
    """Task numbers, habit buttons, then ↗ Today and 🔄 Refresh."""
    rows: list[list[InlineKeyboardButton]] = []
    numbers = [
        InlineKeyboardButton(text=str(n), callback_data=TaskCb(action="open", id=task["id"], page=0).pack())
        for n, task in enumerate((data.get("tasks") or [])[:TASKS_SHOWN], start=1)
        if task.get("id")
    ]
    rows += [numbers[i : i + NUMBERS_PER_ROW] for i in range(0, len(numbers), NUMBERS_PER_ROW)]
    habits = data.get("habits") or {}
    buttons = [habit_button(habit, habits["date"]) for habit in habits.get("habits") or []]
    rows += [buttons[i : i + 2] for i in range(0, len(buttons), 2)]
    last = [b for b in [url_button("↗ Today", data.get("url"))] if b]
    last.append(InlineKeyboardButton(text="🔄 Refresh", callback_data=BriefCb(action="ref").pack()))
    rows.append(last)
    return InlineKeyboardMarkup(inline_keyboard=rows)


# --- schedule ------------------------------------------------------------------------


@dataclass
class BriefMemory:
    """The day whose brief went out last. In memory; the web app's ack survives restarts."""

    sent_date: str | None = None


async def brief_once(bot: Any, api: Any, chat_id: int, memory: BriefMemory | None = None) -> bool:
    """Sends the morning brief when the web app says it is due, then acks it. True when sent."""
    memory = memory if memory is not None else BriefMemory()
    try:
        due = await api.brief_due()
    except Exception:
        log.warning("could not ask whether the morning brief is due", exc_info=True)
        return False
    date = due.get("date")
    brief = due.get("brief")
    if not due.get("due") or not brief or not date or memory.sent_date == date:
        return False
    try:
        await send_card(bot, chat_id, brief_text(brief), brief_keyboard(brief))
    except Exception:
        log.warning("could not send the morning brief", exc_info=True)
        return False  # not acked: retried next minute, until its window closes
    memory.sent_date = date
    try:
        await api.ack_brief(date)
    except Exception:
        # Sent but not recorded: the in-memory mark keeps it from repeating until a restart.
        log.warning("could not ack the morning brief", exc_info=True)
    return True


def brief_task(bot: Any, api: Any, chat_id: int, memory: BriefMemory) -> asyncio.Task:
    return asyncio.create_task(every_minute(lambda: brief_once(bot, api, chat_id, memory), name="brief"), name="brief")
