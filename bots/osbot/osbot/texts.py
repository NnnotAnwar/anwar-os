"""Message texts. Plain text only (no parse_mode): titles and feedback come from
people, so nothing in them can break or inject formatting."""

from __future__ import annotations

from datetime import datetime
from typing import Any

HELP = (
    "osbot — your anwar.os pocket.\n\n"
    "/today — today's agenda\n"
    "/note <text> — save a note\n"
    "/link <url> — save a link\n"
    "/idea <text> — save an idea\n"
    "/task <text> — add a task (\"tomorrow 10:00 !high\" works)\n"
    "/save <text> — save to your Inbox\n\n"
    "Forward me any message or send a link, and I'll offer where to save it. "
    "Calendar reminders and new feedback arrive here too."
)

NOT_OWNER = "Sorry, this is a private bot."


def parse_instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _plural(n: int, unit: str) -> str:
    return f"{n} {unit}" if n == 1 else f"{n} {unit}s"


def relative(start: datetime, now: datetime, *, all_day: bool = False) -> str:
    """"in 30 min", "in 2 h 15 min", "tomorrow", "now", "started 5 min ago"."""
    minutes = round((start - now).total_seconds() / 60)
    if all_day:
        days = max(0, round(minutes / 1440))
        return "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
    if minutes < -1:
        return f"started {-minutes} min ago" if minutes > -60 else "started"
    if minutes <= 1:
        return "now"
    if minutes < 60:
        return f"in {minutes} min"
    if minutes < 24 * 60:
        hours, rest = divmod(minutes, 60)
        return f"in {hours} h {rest} min" if rest else f"in {hours} h"
    return f"in {_plural(round(minutes / 1440), 'day')}"


def reminder_text(reminder: dict[str, Any], now: datetime) -> str:
    """"⏰ Dentist in 30 min · 14:00", plus the location on its own line."""
    when = relative(parse_instant(reminder["start"]), now, all_day=bool(reminder.get("allDay")))
    line = f"⏰ {reminder['title']} {when} · {reminder['when']}"
    if reminder.get("location"):
        line += f"\n📍 {reminder['location']}"
    return line


def today_text(data: dict[str, Any]) -> str:
    lines = [f"📅 {data['date']}"]
    events = data.get("events") or []
    if not events:
        lines.append("Nothing in the calendar today.")
    for event in events:
        row = f"• {event['time']}  {event['title']}"
        if event.get("location"):
            row += f" · {event['location']}"
        lines.append(row)
    tasks = data.get("tasks") or []
    if tasks:
        lines.append("")
        lines.append("✅ Tasks")
        for task in tasks:
            when = "overdue" if task.get("overdue") else (task.get("time") or "today")
            lines.append(f"• {task['title']} · {when}")
        more = int(data.get("tasksTotal") or 0) - len(tasks)
        if more > 0:
            lines.append(f"… and {more} more")
    new_feedback = int(data.get("newFeedback") or 0)
    if new_feedback:
        lines.append("")
        lines.append(f"💬 {_plural(new_feedback, 'new feedback message')}")
    return "\n".join(lines)


def feedback_text(item: dict[str, Any]) -> str:
    sender = " · ".join(part for part in (item.get("name") or "Anonymous", item.get("contact")) if part)
    lines = [f"💬 New feedback · {item['kindLabel']}", "", item["message"], "", f"— {sender}"]
    if item.get("url"):
        lines.append(item["url"])
    return "\n".join(lines)


def saved_text(result: dict[str, Any]) -> str:
    kind = str(result.get("kind", "item")).capitalize()
    if result.get("duplicate"):
        head = f"Already saved: {result['title']}"
    else:
        head = f"✅ {kind} saved: {result['title']}"
    return f"{head}\n{result['url']}" if result.get("url") else head
