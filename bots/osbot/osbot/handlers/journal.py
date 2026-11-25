"""/journal, the faces on the question card, the line (a reply to the prompt), ⏭ Skip and ↩ Undo."""

from __future__ import annotations

import logging

from aiogram import F, Router, types
from aiogram.filters import Command

from .. import texts
from ..api import OsbotApi
from ..errors import describe
from ..journal import (
    CANT_UNDO,
    TEXT_MAX,
    UNDONE,
    JournalCb,
    JournalMemory,
    face,
    iso_day_ok,
    mood_label,
    mood_saved_keyboard,
    mood_saved_text,
    prompt_day,
    prompt_markup,
    prompt_text,
    question_keyboard,
    question_text,
    saved_keyboard,
    saved_text,
)
from ..keyboards import RetryCb, only_links, retry_keyboard
from ..tg import accessible, edit, edit_markup, typing

log = logging.getLogger(__name__)

NOT_TEXT = "✍️ <b>Send the line as text</b>\nOr tap ⏭ Skip on the card above."


async def cmd_journal(message: types.Message, api: OsbotApi) -> None:
    await typing(message)
    try:
        card = await api.journal()
    except Exception as error:
        problem = describe(error, action="journal")
        retry = retry_keyboard(RetryCb(what="journal")) if problem.retry else None
        await message.answer(problem.html(), reply_markup=retry)
        return
    await message.answer(question_text(card), reply_markup=question_keyboard(card))


async def on_journal_retry(callback: types.CallbackQuery, api: OsbotApi) -> None:
    card_message = accessible(callback)
    if card_message is None:
        await callback.answer(texts.STALE)
        return
    try:
        card = await api.journal()
    except Exception as error:
        await callback.answer(describe(error, action="journal").toast(), show_alert=True)
        return
    await edit(card_message, question_text(card), question_keyboard(card))
    await callback.answer()


async def on_journal(callback: types.CallbackQuery, callback_data: JournalCb, api: OsbotApi, journal: JournalMemory) -> None:
    message = accessible(callback)
    if message is None:
        await callback.answer(texts.TOO_OLD)
        return
    cb = callback_data
    if not iso_day_ok(cb.d):
        await callback.answer(texts.STALE)
        return
    if cb.action == "m" and cb.v in range(1, 6):
        await _mood(callback, message, cb, api, journal)
    elif cb.action == "s":
        await _skip(callback, message, cb, api, journal)
    elif cb.action == "u":
        await _undo(callback, message, cb, api, journal)
    else:
        await callback.answer(texts.STALE)


async def _mood(callback: types.CallbackQuery, message: types.Message, cb: JournalCb, api: OsbotApi, journal: JournalMemory) -> None:
    try:
        card = await api.journal_save(cb.d, mood=cb.v)
    except Exception as error:
        await callback.answer(describe(error, action="journal mood").toast(), show_alert=True)
        return
    journal.remember(message.message_id, cb.d, card.get("previous"))
    # The prompt first, so the card's Skip knows which message to take away.
    prompt = await message.answer(prompt_text(card), reply_markup=prompt_markup())
    prompt_id = getattr(prompt, "message_id", 0) or 0
    await edit(message, mood_saved_text(card), mood_saved_keyboard(cb.d, prompt_id, message.message_id))
    await callback.answer(f"{face(cb.v)} {mood_label(cb.v)}")


async def _skip(callback: types.CallbackQuery, message: types.Message, cb: JournalCb, api: OsbotApi, journal: JournalMemory) -> None:
    if cb.p:
        try:
            await message.bot.delete_message(message.chat.id, cb.p)  # the ForceReply prompt
        except Exception:
            log.debug("could not delete the journal prompt", exc_info=True)
    try:
        card = await api.journal(cb.d)
    except Exception as error:
        await callback.answer(describe(error, action="journal").toast(), show_alert=True)
        return
    await edit(message, saved_text(card), saved_keyboard(card, message.message_id))
    await callback.answer("⏭ No line today")


async def _undo(callback: types.CallbackQuery, message: types.Message, cb: JournalCb, api: OsbotApi, journal: JournalMemory) -> None:
    known, before = journal.snapshot(cb.c) if cb.c else (False, None)
    if not known:
        await callback.answer(CANT_UNDO, show_alert=True)
        await edit_markup(message, only_links(message.reply_markup))
        return
    try:
        if before:
            card = await api.journal_save(cb.d, mood=before.get("mood"), text=before.get("text") or "")
        else:
            card = await api.journal_save(cb.d, mood=None, text="")
    except Exception as error:
        await callback.answer(describe(error, action="journal undo").toast(), show_alert=True)
        return
    journal.forget(cb.c)
    await edit(message, question_text(card, footer=UNDONE), question_keyboard(card))
    await callback.answer(UNDONE)


def prompt_reply(message: types.Message) -> dict[str, str] | bool:
    """Filter: a reply to the journal's line prompt; injects `day`."""
    original = message.reply_to_message
    sender = getattr(original, "from_user", None)
    if original is None or sender is None or not sender.is_bot:
        return False
    day = prompt_day(original.text)
    return {"day": day} if day else False


async def answer_prompt(message: types.Message, day: str, api: OsbotApi, journal: JournalMemory) -> None:
    line = " ".join((message.text or message.caption or "").split())
    if not line:
        await message.answer(NOT_TEXT)
        return
    if len(line) > TEXT_MAX:
        await message.reply(f"✂️ <b>That's {len(line)} characters</b>\nKeep it to one line, under {TEXT_MAX}. Reply to the prompt again.")
        return
    await typing(message)
    try:
        card = await api.journal_save(day, text=line)
    except Exception as error:
        problem = describe(error, action="journal line")
        await message.reply(problem.html())
        return
    card_id = journal.card_for(day)
    if not card_id:
        # Answered without a face first (or after a restart): Undo goes back to before this line.
        journal.remember(message.message_id, day, card.get("previous"))
        card_id = message.message_id
    await message.reply(saved_text(card), reply_markup=saved_keyboard(card, card_id))
    if card_id != message.message_id:
        # The card still offers Skip: it has its answer now.
        try:
            await message.bot.edit_message_reply_markup(chat_id=message.chat.id, message_id=card_id, reply_markup=None)
        except Exception:
            log.debug("could not tidy the journal card", exc_info=True)


def make_router() -> Router:
    router = Router(name="journal")
    router.message.register(cmd_journal, Command("journal"))
    router.message.register(answer_prompt, prompt_reply)
    router.callback_query.register(on_journal, JournalCb.filter())
    router.callback_query.register(on_journal_retry, RetryCb.filter(F.what == "journal"))
    return router
