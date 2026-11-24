"""Habits: the /habits card and the scheduled nudges.

/habits shows the day's habits as buttons: one tap ticks a habit off (or
back), and the card redraws in place with the new streaks. Each button carries
the habit id and the day, so an old card still acts on its own day.

Nudges: once a minute the bot asks the web app what is due. A habit with a
reminder time gets a reminder once that time has come, if it isn't done yet;
the evening nudge (off unless switched on in the app) lists what is still open
at its time. Both are acknowledged after sending, so each goes out once a day,
also across restarts. Nothing is sent when everything is done.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .fmt import esc, truncate
from .keyboards import url_button
from .loops import every_minute
from .tg import send_card

log = logging.getLogger(__name__)


class HabitCb(CallbackData, prefix="hb"):
    """t = toggle habit `id` on day `d` | r = refresh the card for day `d`."""

    action: str
    id: str = ""
    d: str = ""


def _title(habit: dict[str, Any], limit: int = 40) -> str:
    name = truncate(habit["name"], limit)
    return f"{habit['emoji']} {name}" if habit.get("emoji") else name


def habit_button(habit: dict[str, Any], day: str) -> InlineKeyboardButton:
    """✅ 🧘 Stretch · 🔥 3 / ⬜ 🧘 Stretch."""
    mark = "✅" if habit.get("done") else "⬜"
    streak = int(habit.get("current") or 0)
    label = f"{mark} {_title(habit)}" + (f" · 🔥 {streak}" if streak else "")
    return InlineKeyboardButton(text=label, callback_data=HabitCb(action="t", id=habit["id"], d=day).pack())


def habits_text(data: dict[str, Any]) -> str:
    """🌱 Habits · Tuesday 24 Nov, how many are done, or what to do when there are none."""
    head = f"🌱 <b>Habits</b> · {esc(data['label'])}"
    total = int(data.get("total") or 0)
    done = int(data.get("done") or 0)
    if total == 0:
        return f"{head}\n<i>Nothing scheduled for this day. Add habits in the app.</i>"
    if done == total:
        return f"{head}\n🎉 All {total} done. Nice."
    return f"{head}\n{done} of {total} done · tap to tick one off"


def habits_keyboard(data: dict[str, Any]) -> InlineKeyboardMarkup:
    day = data["date"]
    rows = [[habit_button(habit, day)] for habit in data.get("habits") or []]
    last = [b for b in [url_button("↗ Open in app", data.get("url"))] if b]
    last.append(InlineKeyboardButton(text="🔄 Refresh", callback_data=HabitCb(action="r", d=day).pack()))
    rows.append(last)
    return InlineKeyboardMarkup(inline_keyboard=rows)


def toggled_toast(data: dict[str, Any]) -> str:
    toggled = data.get("toggled") or {}
    if not toggled.get("done"):
        return "↩ Not done"
    habit = next((h for h in data.get("habits") or [] if h["id"] == toggled.get("id")), None)
    streak = int(habit.get("current") or 0) if habit else 0
    if habit and data.get("total") and data.get("done") == data.get("total"):
        return "🎉 All done for the day"
    return f"✅ Done · 🔥 {streak}" if streak > 1 else "✅ Done"


# --- nudges ------------------------------------------------------------------------


def reminders_text(reminders: list[dict[str, Any]]) -> str:
    if len(reminders) == 1:
        habit = reminders[0]
        return f"⏰ <b>Time for {esc(_title(habit, 60))}</b>\n<i>Your reminder at {esc(habit['time'])}</i>"
    lines = ["⏰ <b>Habit reminders</b>"]
    lines += [f"• {esc(_title(habit, 50))} · {esc(habit['time'])}" for habit in reminders]
    return "\n".join(lines)


def evening_text(evening: dict[str, Any]) -> str:
    habits = evening.get("habits") or []
    names = ", ".join(esc(_title(habit, 30)) for habit in habits)
    return f"🌙 <b>Still open today</b> · {len(habits)}\n{names}\n<i>Done already? Tick it off below.</i>"


def nudge_keyboard(habits: list[dict[str, Any]], day: str, url: str | None) -> InlineKeyboardMarkup:
    rows = [[habit_button({**habit, "done": False}, day)] for habit in habits]
    link = url_button("↗ Habits", url)
    if link:
        rows.append([link])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def habits_once(bot: Any, api: Any, chat_id: int, sent: set[str] | None = None) -> int:
    """Sends due reminders and the evening nudge, then acks what was sent. Returns how many messages.

    `sent` remembers what went out in this process ("<day>:<habit id>", "<day>:evening"), so a
    failing ack doesn't repeat a message every minute until the bot restarts.
    """
    sent = sent if sent is not None else set()
    try:
        data = await api.habit_nudges()
    except Exception:
        log.warning("could not fetch habit nudges", exc_info=True)
        return 0
    day = data["date"]
    url = data.get("url")
    reminders = [habit for habit in data.get("reminders") or [] if f"{day}:{habit['id']}" not in sent]
    evening = data.get("evening") if f"{day}:evening" not in sent else None
    sent_reminders: list[str] = []
    sent_evening = False
    if reminders:
        try:
            await send_card(bot, chat_id, reminders_text(reminders), nudge_keyboard(reminders, day, url))
            sent_reminders = [habit["id"] for habit in reminders]
        except Exception:
            log.warning("could not send habit reminders", exc_info=True)  # not acked: retried next minute
    if evening and evening.get("habits"):
        try:
            await send_card(bot, chat_id, evening_text(evening), nudge_keyboard(evening["habits"], day, url))
            sent_evening = True
        except Exception:
            log.warning("could not send the evening habit nudge", exc_info=True)
    if not sent_reminders and not sent_evening:
        return 0
    sent.update(f"{day}:{habit_id}" for habit_id in sent_reminders)
    if sent_evening:
        sent.add(f"{day}:evening")
    try:
        await api.ack_habit_nudges(day, sent_reminders, sent_evening)
    except Exception:
        log.warning("could not ack habit nudges", exc_info=True)
    return (1 if sent_reminders else 0) + (1 if sent_evening else 0)


def habits_task(bot: Any, api: Any, chat_id: int) -> asyncio.Task:
    sent: set[str] = set()
    return asyncio.create_task(every_minute(lambda: habits_once(bot, api, chat_id, sent), name="habits"), name="habits")
