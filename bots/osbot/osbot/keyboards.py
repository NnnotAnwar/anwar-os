"""Keyboards and the callback data behind their buttons.

Callback data is all the state a button carries (Telegram allows 64 bytes), so
every button keeps working after a restart: what it acts on is either in its
data (a task id, a page) or in the message it is attached to (the message a
capture prompt replies to).
"""

from __future__ import annotations

import ipaddress
import time
from collections.abc import Iterable
from urllib.parse import urlsplit

from aiogram.filters.callback_data import CallbackData
from aiogram.types import (
    ForceReply,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from . import texts
from .texts import PAGE_SIZE, kind_emoji, pages

# --- callback data --------------------------------------------------------------


class CaptureCb(CallbackData, prefix="cap"):
    """Save the message this prompt replies to as `kind` ("cap:note", as before the redesign)."""

    kind: str


class UndoCaptureCb(CallbackData, prefix="cu"):
    """Delete what was just saved; `at` is when (epoch seconds), for the undo window."""

    kind: str
    id: str
    at: int


class DismissCb(CallbackData, prefix="x"):
    """Close the capture prompt without saving."""


class TodayCb(CallbackData, prefix="td"):
    """Show /today at `page` (also the Refresh and Back buttons)."""

    page: int = 0


class TaskCb(CallbackData, prefix="tk"):
    """open | done | undone | tmr | due (Undo of tmr: back to `due`, "-" = no date)."""

    action: str
    id: str
    page: int = 0
    due: str = ""


class ReminderCb(CallbackData, prefix="rm"):
    """ok (dismiss) | snz (snooze for `minutes`)."""

    action: str
    minutes: int = 0


class FeedbackCb(CallbackData, prefix="fb"):
    """Set the feedback item's status (read, spam, new = Undo)."""

    id: str
    status: str


class ContactCb(CallbackData, prefix="ct"):
    """Set the contact message's status (replied, archived, new = Undo)."""

    id: str
    status: str


class ErrorCb(CallbackData, prefix="er"):
    """Set an error group's status from its alert (resolved = ✓ Resolve, open = Undo)."""

    id: str
    status: str


class RetryCb(CallbackData, prefix="rt"):
    """Try a failed request again: today | cap (with `kind`, the message it replies to)."""

    what: str
    kind: str = ""


class MenuCb(CallbackData, prefix="m"):
    to: str


# --- helpers ----------------------------------------------------------------------


def _button(text: str, data: CallbackData) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data.pack())


def linkable(url: str | None) -> bool:
    """Telegram refuses URL buttons to localhost, bare IPs and single-label hosts (dev, the stack's `web`)."""
    if not url:
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = parts.hostname or ""
    if parts.scheme not in ("http", "https") or "." not in host or host.endswith(".localhost"):
        return False
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return True
    return False


def url_button(text: str, url: str | None) -> InlineKeyboardButton | None:
    return InlineKeyboardButton(text=text, url=url) if url and linkable(url) else None


def _rows(*rows: Iterable[InlineKeyboardButton | None]) -> InlineKeyboardMarkup | None:
    kept = [[b for b in row if b is not None] for row in rows]
    kept = [row for row in kept if row]
    return InlineKeyboardMarkup(inline_keyboard=kept) if kept else None


def _pairs(buttons: list[InlineKeyboardButton]) -> list[list[InlineKeyboardButton]]:
    return [buttons[i : i + 2] for i in range(0, len(buttons), 2)]


# --- main menu ------------------------------------------------------------------


def main_menu() -> ReplyKeyboardMarkup:
    """The persistent keyboard under the input field."""
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=texts.MENU_TODAY), KeyboardButton(text=texts.MENU_TASK), KeyboardButton(text=texts.MENU_HELP)]],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder=texts.PLACEHOLDER,
    )


def help_keyboard(app_url: str) -> InlineKeyboardMarkup | None:
    return _rows([_button("📅 Today", MenuCb(to="today")), url_button("↗ Open anwar.os", app_url)])


def force_reply(key: str) -> ForceReply:
    return ForceReply(force_reply=True, input_field_placeholder=texts.PROMPTS[key][2])


# --- capture ----------------------------------------------------------------------


def capture_keyboard(targets: Iterable, *, has_url: bool) -> InlineKeyboardMarkup:
    """One button per destination (a link first when there is a URL), then Cancel."""
    offered = [t for t in targets if has_url or not t.needs_url]
    if has_url:
        # A message with a link most likely is a link: offer that first.
        offered.sort(key=lambda t: not t.needs_url)
    buttons = [_button(f"{kind_emoji(t.kind)} {t.label}", CaptureCb(kind=t.kind)) for t in offered]
    return InlineKeyboardMarkup(inline_keyboard=[*_pairs(buttons), [_button("✕ Cancel", DismissCb())]])


UNDO_WINDOW_SECONDS = 2 * 3600


def saved_keyboard(result: dict, *, now: float | None = None) -> InlineKeyboardMarkup | None:
    """↗ Open and ↩ Undo (never for a link that was already saved: Undo would delete the old one)."""
    undo = None
    if result.get("id") and result.get("kind") and not result.get("duplicate"):
        data = UndoCaptureCb(kind=result["kind"], id=result["id"], at=int(time.time() if now is None else now))
        try:
            undo = _button("↩ Undo", data)
        except ValueError:  # over 64 bytes (a very long kind): no Undo
            undo = None
    return _rows([url_button("↗ Open", result.get("url")), undo])


def only_links(markup: InlineKeyboardMarkup | None) -> InlineKeyboardMarkup | None:
    """The same keyboard with only its URL buttons left (after a one-shot action)."""
    if markup is None:
        return None
    return _rows(*[[b for b in row if b.url] for row in markup.inline_keyboard])


def retry_keyboard(retry: RetryCb) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[_button("🔄 Try again", retry)]])


# --- /today -----------------------------------------------------------------------


def today_keyboard(data: dict, page: int, app_url: str) -> InlineKeyboardMarkup | None:
    tasks = data.get("tasks") or []
    count = pages(len(tasks))
    page = min(max(page, 0), count - 1)
    first = page * PAGE_SIZE
    numbers = [
        _button(str(n), TaskCb(action="open", id=task["id"], page=page))
        for n, task in enumerate(tasks[first : first + PAGE_SIZE], start=first + 1)
        if task.get("id")
    ]
    nav: list[InlineKeyboardButton | None] = []
    if count > 1:
        nav = [
            _button("‹ Prev", TodayCb(page=page - 1)) if page > 0 else None,
            _button(f"{page + 1} / {count}", TodayCb(page=page)),
            _button("Next ›", TodayCb(page=page + 1)) if page < count - 1 else None,
        ]
    new_feedback = int(data.get("newFeedback") or 0)
    return _rows(
        numbers,
        nav,
        [
            _button("🔄 Refresh", TodayCb(page=page)),
            url_button("↗ Calendar", data.get("url")),
            url_button("↗ Tasks", f"{app_url}/app/tasks") if tasks else None,
        ],
        [url_button(f"💬 Feedback ({new_feedback})", f"{app_url}/app/feedback")] if new_feedback else [],
    )


def task_keyboard(task: dict, page: int) -> InlineKeyboardMarkup | None:
    return _rows(
        [_button("✓ Done", TaskCb(action="done", id=task["id"], page=page)), _button("⏭ Tomorrow", TaskCb(action="tmr", id=task["id"], page=page))],
        [url_button("↗ Open in app", task.get("url")), _button("‹ Back", TodayCb(page=page))],
    )


def task_done_keyboard(task: dict, page: int) -> InlineKeyboardMarkup | None:
    return _rows([_button("↩ Undo", TaskCb(action="undone", id=task["id"], page=page)), _button("‹ Back", TodayCb(page=page))])


def task_moved_keyboard(task: dict, page: int) -> InlineKeyboardMarkup | None:
    previous = task.get("previousDueDate") or "-"
    return _rows([_button("↩ Undo", TaskCb(action="due", id=task["id"], page=page, due=previous)), _button("‹ Back", TodayCb(page=page))])


# --- reminders and feedback ---------------------------------------------------------

SNOOZE_CHOICES = ((10, "💤 10 min"), (60, "💤 1 h"))


def reminder_keyboard(reminder: dict, snooze_minutes: Iterable[int]) -> InlineKeyboardMarkup | None:
    allowed = set(snooze_minutes)
    snoozes = [_button(label, ReminderCb(action="snz", minutes=m)) for m, label in SNOOZE_CHOICES if m in allowed]
    return _rows([*snoozes, _button("✓ Got it", ReminderCb(action="ok"))], [url_button("↗ Open in calendar", reminder.get("url"))])


def feedback_keyboard(item_id: str, url: str | None, status: str = "new", previous: str = "new") -> InlineKeyboardMarkup | None:
    """New: Mark read / Spam. After either: Undo (back to `previous`)."""
    if status == "new":
        actions = [_button("✓ Mark read", FeedbackCb(id=item_id, status="read")), _button("🚫 Spam", FeedbackCb(id=item_id, status="spam"))]
    else:
        actions = [_button("↩ Undo", FeedbackCb(id=item_id, status=previous))]
    return _rows([url_button("↗ Open", url), *actions])


def contact_keyboard(item_id: str, url: str | None, status: str = "new", previous: str = "new") -> InlineKeyboardMarkup | None:
    """New: Replied / Archive. After either: Undo (back to `previous`). Telegram buttons can't open mailto:, so Open leads to the app."""
    if status == "new":
        actions = [
            _button("✓ Replied", ContactCb(id=item_id, status="replied")),
            _button("🗄 Archive", ContactCb(id=item_id, status="archived")),
        ]
    else:
        actions = [_button("↩ Undo", ContactCb(id=item_id, status=previous))]
    return _rows([url_button("↗ Open", url), *actions])


def error_keyboard(error_id: str, url: str | None, status: str = "open") -> InlineKeyboardMarkup | None:
    """An error alert. Open: ↗ Open / ✓ Resolve. Resolved: ↗ Open / ↩ Undo."""
    if status == "resolved":
        action = _button("↩ Undo", ErrorCb(id=error_id, status="open"))
    else:
        action = _button("✓ Resolve", ErrorCb(id=error_id, status="resolved"))
    return _rows([url_button("↗ Open", url), action])
