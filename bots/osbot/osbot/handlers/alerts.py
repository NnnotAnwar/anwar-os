"""Buttons on the cards the loops send: reminders (Snooze / Got it), feedback (Mark read / Spam / Undo)
and contact messages (Replied / Archive / Undo)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from aiogram import Router, types

from .. import texts
from ..api import OsbotApi
from ..errors import describe
from ..fmt import clock
from ..keyboards import ContactCb, FeedbackCb, ReminderCb, contact_keyboard, feedback_keyboard, only_links
from ..snooze import ReminderMemory
from ..tg import accessible, edit, edit_markup

log = logging.getLogger(__name__)

STATUS_TOASTS = {"read": "✓ Marked read", "spam": "🚫 Marked as spam", "new": "↩ Back to new", "done": "✓ Marked done"}


def _first_url(markup: types.InlineKeyboardMarkup | None) -> str | None:
    for row in markup.inline_keyboard if markup else []:
        for button in row:
            if button.url:
                return button.url
    return None


async def on_reminder(
    callback: types.CallbackQuery, callback_data: ReminderCb, reminders: ReminderMemory, now: datetime | None = None
) -> None:
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.TOO_OLD)
        return
    if callback_data.action == "ok":
        await edit_markup(card, only_links(card.reply_markup))
        await callback.answer("👍 Got it")
        return
    if callback_data.action != "snz" or callback_data.minutes <= 0:
        await callback.answer(texts.STALE)
        return
    reminder = reminders.get(card.message_id)
    if reminder is None:
        await edit_markup(card, only_links(card.reply_markup))
        await callback.answer(texts.CANT_SNOOZE, show_alert=True)
        return
    now = now or datetime.now(UTC)
    until = now + timedelta(minutes=callback_data.minutes)
    reminders.snooze(reminder, until)
    await edit(card, texts.reminder_text(reminder, now, footer=f"💤 Snoozed until {clock(until)}"), only_links(card.reply_markup))
    await callback.answer(f"💤 I'll remind you again at {clock(until)}")


async def on_feedback(callback: types.CallbackQuery, callback_data: FeedbackCb, api: OsbotApi) -> None:
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.TOO_OLD)
        return
    try:
        result = await api.feedback_status(callback_data.id, callback_data.status)
    except Exception as error:
        problem = describe(error, action="feedback status")
        if problem.kind == "gone":
            await edit_markup(card, only_links(card.reply_markup))
        await callback.answer(problem.toast(), show_alert=True)
        return
    status, previous = result.get("status", callback_data.status), result.get("previous", "new")
    url = _first_url(card.reply_markup)
    await edit(card, texts.with_feedback_footer(card.html_text, status), feedback_keyboard(callback_data.id, url, status, previous))
    await callback.answer(STATUS_TOASTS.get(status, "Updated"))


CONTACT_TOASTS = {"replied": "✓ Marked replied", "archived": "🗄 Archived", "new": "↩ Back to waiting"}


async def on_contact(callback: types.CallbackQuery, callback_data: ContactCb, api: OsbotApi) -> None:
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.TOO_OLD)
        return
    try:
        result = await api.contact_status(callback_data.id, callback_data.status)
    except Exception as error:
        problem = describe(error, action="contact status")
        if problem.kind == "gone":
            await edit_markup(card, only_links(card.reply_markup))
        await callback.answer(problem.toast(), show_alert=True)
        return
    status, previous = result.get("status", callback_data.status), result.get("previous", "new")
    url = _first_url(card.reply_markup)
    await edit(card, texts.with_contact_footer(card.html_text, status), contact_keyboard(callback_data.id, url, status, previous))
    await callback.answer(CONTACT_TOASTS.get(status, "Updated"))


def make_router() -> Router:
    router = Router(name="alerts")
    router.callback_query.register(on_reminder, ReminderCb.filter())
    router.callback_query.register(on_feedback, FeedbackCb.filter())
    router.callback_query.register(on_contact, ContactCb.filter())
    return router
