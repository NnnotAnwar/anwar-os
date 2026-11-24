"""Message texts, all HTML (the Bot sends with parse_mode=HTML).

Conventions: a bold title line with one leading emoji, details in italics,
anything people wrote escaped with `esc`. Callback answers (toasts) are plain
text and live here too, as constants.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

from .fmt import day_label, esc, human_day, iso_day, parse_instant, plural, stamp, today_local, truncate

# --- the bot itself -----------------------------------------------------------

NOT_OWNER = "Sorry, this is a private bot."

SHORT_DESCRIPTION = "Private assistant for anwar.os: quick capture, today's agenda and reminders."
DESCRIPTION = (
    "osbot is the private assistant of anwar.os.\n\n"
    "Send or forward anything to save it to the Inbox, tasks, notes, links or ideas. "
    "/today shows the calendar and due tasks. Calendar reminders and new feedback arrive here.\n\n"
    "Only the owner of anwar.os can use it."
)

# Reply keyboard (the persistent main menu) labels; handlers match them exactly.
MENU_TODAY = "📅 Today"
MENU_TASK = "➕ Task"
MENU_HELP = "❓ Help"
PLACEHOLDER = "Type or forward anything to save it…"

WELCOME = (
    "👋 <b>Hi, I'm osbot, your anwar.os assistant.</b>\n\n"
    "📥 Send or forward me anything and pick where it goes: Inbox, task, note, link or idea.\n"
    "📅 <b>Today</b> shows your calendar and due tasks.\n"
    "⏰ Calendar reminders and new feedback arrive here on their own.\n\n"
    "The menu below has the shortcuts; /help lists every command."
)

HELP = (
    "<b>osbot</b> · what I can do\n\n"
    "<b>Capture</b>\n"
    "Send or forward anything (text, a link, a captioned photo) and tap where it goes.\n"
    "/task <i>text</i> · add a task; dates work: <code>/task Call the bank tomorrow 10:00 !high</code>\n"
    "/note, /idea, /link <i>text</i> · save straight there\n"
    "/save <i>text</i> · save to the Inbox\n"
    "<i>Any of these without text asks for it.</i>\n\n"
    "<b>Plan</b>\n"
    "/today · calendar, due tasks and new feedback, with Done and Tomorrow buttons\n"
    "/week · the week in review: tasks, next week's calendar, spending, payments\n"
    "/month · this month's report; <code>/month last</code> or <code>/month 2026-10</code> for another\n"
    "/habits · today's habits; tap one to tick it off\n\n"
    "<b>Notifications</b>\n"
    "⏰ Calendar reminders, with snooze\n"
    "💬 New feedback from the site, with Mark read\n"
    "✉️ Job offers and projects from the contact form, with Replied and Archive\n"
    "💳 Recurring payments, the day before they charge\n"
    "🗓 The week in review, Sundays at 19:00\n"
    "📊 Last month's report with its PDF, on the 1st at 10:00\n"
    "🌱 Habit reminders and the evening nudge, when set in the app"
)

UNKNOWN_COMMAND = "<b>I don't know that command.</b>\n/help lists what I can do."
NOTHING_TO_SAVE = (
    "🤷 <b>Nothing to save here</b>\n"
    "I can save text, links and captions. Add a caption to a photo or file, or send the text."
)
ASK_TARGET = "<b>Save this to…</b>"

# Toasts (plain text, ≤ 200 characters).
GONE = "The original message is gone. Send it again."
STALE = "This button has expired. Send /today for a fresh one."
TOO_OLD = "This message is too old to change."
UNDO_TOO_LATE = "Too late to undo here. Open it in the app instead."
CANT_SNOOZE = "I can't snooze this one any more (I was restarted). Open the calendar instead."
CANCELLED = "Not saved."
SOMETHING_WRONG = "Something went wrong on my side. Try again?"

KIND_EMOJI = {"inbox": "📥", "task": "✅", "note": "📝", "link": "🔗", "idea": "💡"}


def kind_emoji(kind: str) -> str:
    return KIND_EMOJI.get(kind, "📌")


# --- prompts for commands sent without text -----------------------------------
# A prompt goes out with ForceReply; the owner's reply comes back with the
# prompt as reply_to_message, and its first line says what to save it as. No
# state is kept, so a prompt still works after a restart.

PROMPTS: dict[str, tuple[str, str, str]] = {
    # key: (title line, question, input placeholder)
    "task": ("✅ New task", "What needs doing? Dates work: “Call the bank tomorrow 10:00 !high”.", "Task"),
    "note": ("📝 New note", "What should it say? The first line becomes the title.", "Note"),
    "link": ("🔗 New link", "Send the address, with a note if you like.", "https://…"),
    "idea": ("💡 New idea", "What's the idea?", "Idea"),
    "save": ("📥 Save to Inbox", "What should I save?", "Anything"),
}


def prompt_text(key: str) -> str:
    title, question, _ = PROMPTS[key]
    return f"<b>{esc(title)}</b>\n{esc(question)}"


def prompt_key(text: str | None) -> str | None:
    """Which prompt a message is (by its first line), if any."""
    first = (text or "").split("\n", 1)[0].strip()
    return next((key for key, (title, _, _) in PROMPTS.items() if title == first), None)


# --- capture --------------------------------------------------------------------


def saved_text(result: dict[str, Any], label: str | None = None) -> str:
    """✅ Task added / 📝 Note saved / 📥 Saved to Inbox, then the title."""
    kind = str(result.get("kind") or "item")
    title = esc(truncate(str(result.get("title") or ""), 200))
    if result.get("duplicate"):
        head = "Already saved"
    else:
        head = {"inbox": "Saved to Inbox", "task": "Task added"}.get(kind) or f"{label or kind.capitalize()} saved"
    return f"{kind_emoji(kind)} <b>{head}</b>\n{title}" if title else f"{kind_emoji(kind)} <b>{head}</b>"


def removed_text(title: str | None = None, *, offer_again: bool = False) -> str:
    if offer_again:
        return "↩ <b>Removed.</b> Save it somewhere else?"
    return f"↩ <b>Removed</b>\n<s>{esc(title)}</s>" if title else "↩ <b>Removed</b>"


def saved_title(message_text: str | None) -> str | None:
    """The title line of a saved_text message (its second line), for removed_text."""
    lines = (message_text or "").split("\n")
    return lines[1].strip() if len(lines) > 1 and lines[1].strip() else None


# --- reminders ------------------------------------------------------------------


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
    return f"in {plural(round(minutes / 1440), 'day')}"


def reminder_text(reminder: dict[str, Any], now: datetime, *, footer: str | None = None) -> str:
    """⏰ <b>Dentist</b> in 30 min · 14:00, then 📍 the place and an optional italic footer.

    The first line reads well as a lock-screen notification on its own.
    """
    when = relative(parse_instant(reminder["start"]), now, all_day=bool(reminder.get("allDay")))
    lines = [f"⏰ <b>{esc(reminder['title'])}</b> {when} · {esc(reminder['when'])}"]
    if reminder.get("location"):
        lines.append(f"📍 {esc(reminder['location'])}")
    if footer:
        lines.append(f"<i>{esc(footer)}</i>")
    return "\n".join(lines)


# --- /today ---------------------------------------------------------------------

PAGE_SIZE = 5
# Keeps /today well under Telegram's 4096 characters on a packed day.
MAX_EVENTS = 12


def pages(count: int) -> int:
    return max(1, -(-count // PAGE_SIZE))


def _task_meta(task: dict[str, Any], today: date) -> str:
    due = iso_day(task.get("dueDate"))
    time = task.get("time") or task.get("dueTime")
    if task.get("overdue"):
        return f"overdue · {human_day(due, today)}" if due else "overdue"
    if due and due != today:
        return human_day(due, today) + (f" {time}" if time else "")
    return time or ""


def today_text(data: dict[str, Any], now: datetime | None = None, page: int = 0) -> str:
    now = now or datetime.now(UTC)
    today = today_local(now)
    lines = [f"📅 <b>{esc(data['date'])}</b>", "", "<b>Calendar</b>"]

    events = data.get("events") or []
    if not events:
        lines.append("<i>Nothing in the calendar.</i>")
    shown = events[:MAX_EVENTS]
    width = max((len(e["time"]) for e in shown), default=0)
    for event in shown:
        row = f"<code>{esc(event['time'].ljust(width))}</code>  {esc(truncate(event['title'], 80))}"
        if event.get("location"):
            row += f" · <i>{esc(truncate(event['location'], 40))}</i>"
        lines.append(row)
    if len(events) > MAX_EVENTS:
        lines.append(f"<i>+{len(events) - MAX_EVENTS} more in the calendar</i>")

    tasks = data.get("tasks") or []
    total = max(int(data.get("tasksTotal") or 0), len(tasks))
    lines += ["", f"<b>Tasks</b> · {total} due" if total else "<b>Tasks</b>"]
    if not tasks:
        lines.append("<i>Nothing due. Add one with /task.</i>")
    page = min(max(page, 0), pages(len(tasks)) - 1)
    first = page * PAGE_SIZE
    for n, task in enumerate(tasks[first : first + PAGE_SIZE], start=first + 1):
        meta = _task_meta(task, today)
        lines.append(f"<b>{n}.</b> {esc(truncate(task['title'], 70))}" + (f" · <i>{esc(meta)}</i>" if meta else ""))
    if tasks and total > len(tasks):
        lines.append(f"<i>+{total - len(tasks)} more in the app</i>")
    if tasks:
        lines.append("<i>Tap a number to open a task.</i>")

    new_feedback = int(data.get("newFeedback") or 0)
    if new_feedback:
        lines += ["", f"💬 {plural(new_feedback, 'new feedback message')}"]
    return "\n".join(lines)


def task_card(task: dict[str, Any], now: datetime | None = None) -> str:
    """One task from /today, opened: title and when it's due."""
    today = today_local(now or datetime.now(UTC))
    due = iso_day(task.get("dueDate"))
    time = task.get("time") or task.get("dueTime")
    if task.get("overdue") and due:
        when = f"Overdue · was due {human_day(due, today)}"
    elif due:
        when = f"Due {human_day(due, today)}" + (f" at {time}" if time else "")
    else:
        when = "No due date"
    return f"☐ <b>{esc(truncate(task['title'], 200))}</b>\n<i>{esc(when)}</i>"


def task_done_card(task: dict[str, Any]) -> str:
    next_due = iso_day(task.get("nextDue"))
    note = f"Done · next one {day_label(next_due)}" if next_due else "Done"
    return f"✅ <s>{esc(truncate(task['title'], 200))}</s>\n<i>{esc(note)}</i>"


def task_moved_card(task: dict[str, Any], now: datetime | None = None) -> str:
    today = today_local(now or datetime.now(UTC))
    due = iso_day(task.get("dueDate")) or today + timedelta(days=1)
    return f"⏭ <b>{esc(truncate(task['title'], 200))}</b>\n<i>Moved to {esc(human_day(due, today))} · {day_label(due)}</i>"


# --- feedback -------------------------------------------------------------------

FEEDBACK_FOOTERS = {
    "read": "✓ Marked read",
    "in_progress": "… In progress",
    "done": "✓ Marked done",
    "spam": "🚫 Marked as spam",
}
_FOOTER_RE = re.compile(r"\n\n<i>(?:" + "|".join(re.escape(f) for f in FEEDBACK_FOOTERS.values()) + r")</i>$")


def feedback_text(item: dict[str, Any], now: datetime | None = None) -> str:
    """💬 New feedback · Question, the message quoted, then who and when."""
    message = str(item["message"])
    quote = "<blockquote expandable>" if len(message) > 400 or message.count("\n") > 6 else "<blockquote>"
    sender = " · ".join(esc(part) for part in (item.get("name") or "Anonymous", item.get("contact")) if part)
    when = ""
    if item.get("createdAt"):
        when = f" · <i>{esc(stamp(parse_instant(item['createdAt']), now or datetime.now(UTC)))}</i>"
    return (
        f"💬 <b>New feedback</b> · {esc(item['kindLabel'])}\n"
        f"{quote}{esc(message)}</blockquote>\n"
        f"— {sender}{when}"
    )


def with_feedback_footer(html_text: str, status: str) -> str:
    """The card with its status footer replaced (none for "new")."""
    base = _FOOTER_RE.sub("", html_text)
    footer = FEEDBACK_FOOTERS.get(status)
    return f"{base}\n\n<i>{esc(footer)}</i>" if footer else base


# --- contact (job offers and projects from the public /contact form) ---------------

CONTACT_FOOTERS = {
    "replied": "✓ Marked replied",
    "archived": "🗄 Archived",
}
_CONTACT_FOOTER_RE = re.compile(r"\n\n<i>(?:" + "|".join(re.escape(f) for f in CONTACT_FOOTERS.values()) + r")</i>$")


def contact_text(item: dict[str, Any], now: datetime | None = None) -> str:
    """✉️ New contact · Job offer, who (and company) with their email, the message quoted, when."""
    message = str(item["message"])
    quote = "<blockquote expandable>" if len(message) > 400 or message.count("\n") > 6 else "<blockquote>"
    sender = " · ".join(esc(part) for part in (item.get("name"), item.get("company")) if part)
    when = ""
    if item.get("createdAt"):
        when = f" · <i>{esc(stamp(parse_instant(item['createdAt']), now or datetime.now(UTC)))}</i>"
    return (
        f"✉️ <b>New contact</b> · {esc(item['topicLabel'])}\n"
        f"<b>{sender}</b>\n"
        f"{esc(item.get('email') or '')}\n"
        f"{quote}{esc(message)}</blockquote>\n"
        f"<i>Reply by email</i>{when}"
    )


def with_contact_footer(html_text: str, status: str) -> str:
    """The card with its status footer replaced (none for "new")."""
    base = _CONTACT_FOOTER_RE.sub("", html_text)
    footer = CONTACT_FOOTERS.get(status)
    return f"{base}\n\n<i>{esc(footer)}</i>" if footer else base
