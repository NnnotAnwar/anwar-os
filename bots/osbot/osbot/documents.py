"""Documents: expiry reminders for the passport, residence permit, insurance…

Once a minute the bot asks the web app which reminder cards are due. The web
app owns the schedule (src/modules/documents/lib/reminders.ts): at 10:00 in the
owner's time zone on each reminder day (by default 90, 30 and 7 days before and
on the day itself), plus one final card the day after a document expires. A
card the bot missed while it was down comes late, once; an older stage that a
newer one replaced is dropped. Each card is sent, then acknowledged, so it goes
out once also across restarts (osbot_deliveries, kind "document").

A card: "🪪 Residence permit expires in 30 days · 24 Dec 2026" with ↗ Open,
✓ Renewed (opens the app with the new expiry date ready) and 💤 Remind tomorrow
(the web app keeps the snooze, so a restart doesn't lose it).
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


class DocumentCb(CallbackData, prefix="dc"):
    """snz = remind tomorrow about document `id`."""

    action: str
    id: str


def when(item: dict[str, Any]) -> str:
    """"expires in 30 days" / "expires tomorrow" / "expires today" / "expired today" / "expired 3 days ago"."""
    days = int(item.get("daysLeft") or 0)
    if days > 1:
        return f"expires in {days} days"
    if days == 1:
        return "expires tomorrow"
    if days == 0:
        return "expires today"
    # The day after the expiry date is its first invalid day: "expired today".
    ago = -days - 1
    if ago == 0:
        return "expired today"
    if ago == 1:
        return "expired yesterday"
    return f"expired {ago} days ago"


def document_text(item: dict[str, Any]) -> str:
    """🪪 <b>Residence permit expires in 30 days</b> · 24 Dec 2026, then a line of context."""
    emoji = item.get("emoji") or "📄"
    head = f"{emoji} <b>{esc(truncate(item['name'], 60))} {when(item)}</b> · {esc(item['dateLabel'])}"
    notes: list[str] = []
    if int(item.get("daysLeft") or 0) < 0:
        notes.append("Renew it, then tap ✓ Renewed.")
    if item.get("snoozed"):
        notes.append("💤 Reminding you again, as asked.")
    elif item.get("late"):
        notes.append(f"Due on {esc(item.get('dueLabel') or item.get('dueOn') or '')}; I was offline then.")
    context = esc(item.get("kindLabel") or "")
    line = " · ".join([p for p in [context, *notes] if p])
    return f"{head}\n<i>{line}</i>" if line else head


def document_keyboard(item: dict[str, Any]) -> InlineKeyboardMarkup:
    links = [b for b in [url_button("↗ Open", item.get("url")), url_button("✓ Renewed", item.get("renewUrl"))] if b]
    snooze = InlineKeyboardButton(text="💤 Remind tomorrow", callback_data=DocumentCb(action="snz", id=item["id"]).pack())
    rows = [links] if links else []
    rows.append([snooze])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def snoozed_note(data: dict[str, Any]) -> str:
    """The line added to a card after 💤: "💤 I'll remind you again on 26 Nov at 10:00"."""
    return f"<i>💤 I'll remind you again on {esc(data.get('label') or 'tomorrow')} at {esc(data.get('time') or '10:00')}</i>"


async def documents_once(bot: Any, api: Any, chat_id: int, sent: set[str] | None = None) -> int:
    """Sends the due reminder cards, one per document, each acked after it's sent. Returns how many.

    `sent` remembers the keys sent by this process, so a failing ack doesn't repeat a card every
    minute until the bot restarts.
    """
    sent = sent if sent is not None else set()
    try:
        data = await api.documents_due()
    except Exception:
        log.warning("could not fetch due document reminders", exc_info=True)
        return 0
    count = 0
    for item in data.get("items") or []:
        keys = [k for k in item.get("keys") or [] if k not in sent]
        if not keys:
            continue
        try:
            await send_card(bot, chat_id, document_text(item), document_keyboard(item))
        except Exception:
            log.warning("could not send a document reminder", exc_info=True, extra={"document_id": item.get("id")})
            continue  # not acked: retried next minute
        sent.update(keys)
        count += 1
        try:
            await api.ack_documents(keys)
        except Exception:
            log.warning("could not ack a document reminder", exc_info=True, extra={"document_id": item.get("id")})
    return count


def documents_task(bot: Any, api: Any, chat_id: int) -> asyncio.Task:
    sent: set[str] = set()
    return asyncio.create_task(every_minute(lambda: documents_once(bot, api, chat_id, sent), name="documents"), name="documents")
