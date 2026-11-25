"""The journal: "🌙 How was today?" with five faces, then one line.

Every evening at the owner's chosen time (Journal in the app, default 21:30,
on by default) the web app says the question is due (GET journal/due): inside
3 hours of its time, not sent yet that day, and the day has no mood yet. The bot
sends it, then acks it (journal/ack), so it goes out once a day across restarts.
/journal asks the same on demand.

A face saves the mood at once and the card turns into "🙂 Good · Wednesday 25 Nov"
with ⏭ Skip and ↩ Undo, while a ForceReply prompt asks for the line. The
prompt's first line names its day ("✍️ One line about Wed 25 Nov 2026"), so a
reply still lands on the right day after a restart. The saved line comes back
with ↩ Undo and ↗ Open.

Undo puts the day back as it was before the first face was tapped on that card.
That snapshot is kept in memory (like reminder snoozes): after a restart the
button says it can't undo here any more.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from aiogram.filters.callback_data import CallbackData
from aiogram.types import ForceReply, InlineKeyboardButton, InlineKeyboardMarkup

from .fmt import esc, truncate
from .keyboards import url_button
from .loops import every_minute
from .tg import send_card

log = logging.getLogger(__name__)

MOODS = {1: ("😞", "Bad"), 2: ("🙁", "Low"), 3: ("😐", "Okay"), 4: ("🙂", "Good"), 5: ("😄", "Great")}
TEXT_MAX = 500
PROMPT_PREFIX = "✍️ One line about "
PROMPT_DAY_FORMAT = "%a %d %b %Y"
# How long a card's Undo snapshot is kept, and how many.
UNDO_SECONDS = 6 * 3600
UNDO_KEEP = 50

CANT_UNDO = "I was restarted since, so I can't undo this here. Open the journal in the app instead."
UNDONE = "↩ Put back"


class JournalCb(CallbackData, prefix="jn"):
    """m = mood `v` for day `d` (on card `c`, 0 = this one) | s = skip the line (prompt `p`) | u = undo card `c` | r = ask again."""

    action: str
    d: str
    v: int = 0
    p: int = 0
    c: int = 0


def face(mood: int | None) -> str:
    return MOODS[mood][0] if mood in MOODS else ""


def mood_label(mood: int | None) -> str:
    return MOODS[mood][1] if mood in MOODS else ""


# --- texts ----------------------------------------------------------------------------


def question_text(card: dict[str, Any], *, footer: str | None = None) -> str:
    """🌙 How was today? (or "How was Tuesday 24 Nov?"), with what is already written."""
    today = card.get("date") == card.get("today")
    head = "🌙 <b>How was today?</b>" if today else f"🌙 <b>How was {esc(card['label'])}?</b>"
    lines = [head, f"<i>{esc(card['label'])} · tap a face</i>" if today else "<i>Tap a face</i>"]
    entry = card.get("entry")
    if entry:
        now = " ".join(p for p in (face(entry.get("mood")), esc(truncate(entry.get("text") or "", 200))) if p)
        lines.append(f"Now: {now}")
    if footer:
        lines.append(f"<i>{esc(footer)}</i>")
    return "\n".join(lines)


def question_keyboard(card: dict[str, Any]) -> InlineKeyboardMarkup:
    day = card["date"]
    faces = [InlineKeyboardButton(text=MOODS[v][0], callback_data=JournalCb(action="m", d=day, v=v).pack()) for v in MOODS]
    rows = [faces]
    link = url_button("↗ Open", card.get("url"))
    if link:
        rows.append([link])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def mood_saved_text(card: dict[str, Any]) -> str:
    """The card after a face: 🙂 Good · Wednesday 25 Nov, and what comes next."""
    mood = (card.get("entry") or {}).get("mood")
    head = f"{face(mood)} <b>{mood_label(mood)}</b> · {esc(card['label'])}" if mood else f"📓 <b>{esc(card['label'])}</b>"
    return f"{head}\n<i>Reply below with one line about the day, or skip.</i>"


def mood_saved_keyboard(day: str, prompt_id: int, card_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="⏭ Skip", callback_data=JournalCb(action="s", d=day, p=prompt_id).pack()),
                InlineKeyboardButton(text="↩ Undo", callback_data=JournalCb(action="u", d=day, c=card_id).pack()),
            ]
        ]
    )


def prompt_text(card: dict[str, Any]) -> str:
    return f"<b>{PROMPT_PREFIX}{esc(card['short'])}</b>\n<i>What stood out? One line, up to {TEXT_MAX} characters.</i>"


def prompt_markup() -> ForceReply:
    return ForceReply(force_reply=True, input_field_placeholder="One line about the day…")


def prompt_day(text: str | None) -> str | None:
    """The day a reply belongs to, read from the prompt it answers ("✍️ One line about Wed 25 Nov 2026")."""
    first = (text or "").split("\n", 1)[0].strip()
    if not first.startswith(PROMPT_PREFIX):
        return None
    try:
        return datetime.strptime(first[len(PROMPT_PREFIX) :].strip(), PROMPT_DAY_FORMAT).date().isoformat()
    except ValueError:
        return None


def saved_text(card: dict[str, Any]) -> str:
    """📓 Saved · Wednesday 25 Nov, then the face and the line."""
    entry = card.get("entry") or {}
    body = " ".join(p for p in (face(entry.get("mood")), esc(truncate(entry.get("text") or "", 500))) if p)
    return f"📓 <b>Saved</b> · {esc(card['label'])}" + (f"\n{body}" if body else "")


def saved_keyboard(card: dict[str, Any], card_id: int) -> InlineKeyboardMarkup:
    row = [InlineKeyboardButton(text="↩ Undo", callback_data=JournalCb(action="u", d=card["date"], c=card_id).pack())]
    link = url_button("↗ Open", card.get("url"))
    if link:
        row.append(link)
    return InlineKeyboardMarkup(inline_keyboard=[row])


def iso_day_ok(value: str) -> bool:
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


# --- memory (Undo) --------------------------------------------------------------------


@dataclass
class JournalMemory:
    """What a day was before a card's first face (for Undo), and the card asking about each day.

    `before[card id]` = (snapshot or None, when). In memory: a restart forgets it.
    """

    before: dict[int, tuple[dict[str, Any] | None, float]] = field(default_factory=dict)
    cards: dict[str, int] = field(default_factory=dict)
    sent_date: str | None = None

    def remember(self, card_id: int, day: str, previous: dict[str, Any] | None, now: float | None = None) -> None:
        """Keeps the first snapshot per card (a second face on the same card doesn't replace it)."""
        now = time.time() if now is None else now
        self._prune(now)
        self.before.setdefault(card_id, (previous, now))
        self.cards[day] = card_id

    def snapshot(self, card_id: int, now: float | None = None) -> tuple[bool, dict[str, Any] | None]:
        """(known, snapshot): known is False once forgotten (a restart, or too long ago)."""
        self._prune(time.time() if now is None else now)
        if card_id not in self.before:
            return False, None
        return True, self.before[card_id][0]

    def card_for(self, day: str) -> int:
        card = self.cards.get(day, 0)
        return card if card in self.before else 0

    def forget(self, card_id: int) -> None:
        self.before.pop(card_id, None)
        self.cards = {d: c for d, c in self.cards.items() if c != card_id}

    def _prune(self, now: float) -> None:
        stale = [c for c, (_, at) in self.before.items() if now - at > UNDO_SECONDS]
        if len(self.before) - len(stale) > UNDO_KEEP:
            stale += sorted((c for c in self.before if c not in stale), key=lambda c: self.before[c][1])[: len(self.before) - UNDO_KEEP]
        for card_id in stale:
            self.forget(card_id)


# --- schedule ---------------------------------------------------------------------------


async def journal_once(bot: Any, api: Any, chat_id: int, memory: JournalMemory | None = None) -> bool:
    """Sends the evening question when the web app says it is due, then acks it. True when sent."""
    memory = memory if memory is not None else JournalMemory()
    try:
        due = await api.journal_due()
    except Exception:
        log.warning("could not ask whether the journal question is due", exc_info=True)
        return False
    day = due.get("date")
    card = due.get("card")
    if not due.get("due") or not card or not day or memory.sent_date == day:
        return False
    try:
        await send_card(bot, chat_id, question_text(card), question_keyboard(card))
    except Exception:
        log.warning("could not send the journal question", exc_info=True)
        return False  # not acked: retried next minute, until its window closes
    memory.sent_date = day
    try:
        await api.ack_journal(day)
    except Exception:
        log.warning("could not ack the journal question", exc_info=True)
    return True


def journal_task(bot: Any, api: Any, chat_id: int, memory: JournalMemory) -> asyncio.Task:
    return asyncio.create_task(every_minute(lambda: journal_once(bot, api, chat_id, memory), name="journal"), name="journal")
