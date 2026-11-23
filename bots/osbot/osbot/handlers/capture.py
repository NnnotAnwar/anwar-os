"""Quick capture.

Three ways in, one result card (✅ Task added · ↗ Open · ↩ Undo):

  - any message or forward: "Save this to…" with one button per destination,
    sent as a reply; a press reads the original back from reply_to_message;
  - /task, /note, /idea, /link, /save <text>: saved straight away;
  - the same commands without text (or ➕ Task in the menu): a ForceReply
    prompt; the owner's answer comes back replying to it, and the prompt's
    first line says what to save it as.

Stateless: nothing is kept in memory, so every button and prompt keeps working
across restarts. Undo is offered for a while after saving (UNDO_WINDOW_SECONDS).
"""

from __future__ import annotations

import logging
import time
from typing import Any

from aiogram import F, Router, types
from aiogram.filters import Command, CommandObject

from .. import texts
from ..api import OsbotApi
from ..errors import describe
from ..keyboards import (
    UNDO_WINDOW_SECONDS,
    CaptureCb,
    DismissCb,
    RetryCb,
    UndoCaptureCb,
    capture_keyboard,
    force_reply,
    only_links,
    retry_keyboard,
    saved_keyboard,
)
from ..targets import CaptureTargets
from ..tg import accessible, edit, edit_markup, typing
from .common import URL_RE, message_content, without_command

log = logging.getLogger(__name__)

NOT_A_LINK = "<b>✋ That's not a link</b>\nSend a full web address, e.g. <code>https://react.dev/learn</code>"


async def _kind_for(key: str, targets: CaptureTargets) -> str:
    """Command or prompt key → destination ("save" = the default one)."""
    if key == "save":
        await targets.get()  # refreshes the default if it's stale
        return targets.default
    return key


def _label(targets: CaptureTargets, kind: str | None) -> str | None:
    target = targets.find(kind) if kind else None
    return target.label if target else None


async def save_reply(message: types.Message, api: OsbotApi, targets: CaptureTargets, key: str, text: str, url: str | None) -> None:
    """Saves and answers with the result card, as a reply to `message` (so Try again can find it)."""
    if key == "link" and not url:
        await message.reply(NOT_A_LINK)
        return
    kind = await _kind_for(key, targets)
    await typing(message)
    try:
        result = await api.capture(kind, text, url)
    except Exception as error:
        problem = describe(error, action="capture")
        retry = retry_keyboard(RetryCb(what="cap", kind=kind)) if problem.retry else None
        await message.reply(problem.html(), reply_markup=retry)
        return
    await message.reply(texts.saved_text(result, _label(targets, result.get("kind"))), reply_markup=saved_keyboard(result))


# --- commands and prompts ---------------------------------------------------------


async def cmd_capture(message: types.Message, command: CommandObject, api: OsbotApi, targets: CaptureTargets) -> None:
    key = command.command
    text = (command.args or "").strip()
    if not text:
        await message.answer(texts.prompt_text(key), reply_markup=force_reply(key))
        return
    match = URL_RE.search(text)
    await save_reply(message, api, targets, key, text, match.group(0) if key == "link" and match else None)


async def menu_task(message: types.Message) -> None:
    await message.answer(texts.prompt_text("task"), reply_markup=force_reply("task"))


def prompt_reply(message: types.Message) -> dict[str, str] | bool:
    """Filter: a reply to one of our prompts; injects `prompt` (its key)."""
    original = message.reply_to_message
    sender = getattr(original, "from_user", None)
    if original is None or sender is None or not sender.is_bot:
        return False
    key = texts.prompt_key(original.text)
    return {"prompt": key} if key else False


async def answer_prompt(message: types.Message, prompt: str, api: OsbotApi, targets: CaptureTargets) -> None:
    text, url = message_content(message)
    if not text.strip() and not url:
        await message.answer(texts.NOTHING_TO_SAVE)
        return
    target = targets.find(prompt)
    await save_reply(message, api, targets, prompt, text, url if prompt == "link" or (target and target.needs_url) else None)


async def unknown_command(message: types.Message) -> None:
    await message.answer(texts.UNKNOWN_COMMAND)


# --- anything else: offer the destinations ------------------------------------------


async def offer_capture(message: types.Message, targets: CaptureTargets) -> None:
    text, url = message_content(message)
    if not text.strip() and not url:
        await message.answer(texts.NOTHING_TO_SAVE)
        return
    keyboard = capture_keyboard(await targets.get(), has_url=url is not None)
    await message.reply(texts.ASK_TARGET, reply_markup=keyboard)


def _original(prompt: Any) -> tuple[str, str | None] | None:
    """What the prompt (or result card) replies to: (text without a command, url)."""
    original = getattr(prompt, "reply_to_message", None)
    if original is None:
        return None
    text, url = message_content(original)
    return without_command(text), url


async def save_choice(callback: types.CallbackQuery, callback_data: CaptureCb, api: OsbotApi, targets: CaptureTargets) -> None:
    prompt = accessible(callback)
    content = _original(prompt) if prompt is not None else None
    if prompt is None or content is None:
        await callback.answer(texts.GONE, show_alert=True)
        return
    text, url = content
    kind = callback_data.kind
    target = targets.find(kind)
    try:
        result = await api.capture(kind, text, url if target is None or target.needs_url else None)
    except Exception as error:
        # Keep the buttons: another choice (or a retry) may still work.
        await callback.answer(describe(error, action="capture").toast(), show_alert=True)
        return
    await edit(prompt, texts.saved_text(result, _label(targets, result.get("kind"))), saved_keyboard(result))
    await callback.answer()


async def retry_capture(callback: types.CallbackQuery, callback_data: RetryCb, api: OsbotApi, targets: CaptureTargets) -> None:
    card = accessible(callback)
    content = _original(card) if card is not None else None
    if card is None or content is None:
        await callback.answer(texts.GONE, show_alert=True)
        return
    text, url = content
    kind = callback_data.kind or await _kind_for("save", targets)
    target = targets.find(kind)
    try:
        result = await api.capture(kind, text, url if target is None or target.needs_url else None)
    except Exception as error:
        await callback.answer(describe(error, action="capture").toast(), show_alert=True)
        return
    await edit(card, texts.saved_text(result, _label(targets, result.get("kind"))), saved_keyboard(result))
    await callback.answer("Saved")


async def undo_capture(
    callback: types.CallbackQuery, callback_data: UndoCaptureCb, api: OsbotApi, targets: CaptureTargets, now: float | None = None
) -> None:
    card = accessible(callback)
    if card is None:
        await callback.answer(texts.TOO_OLD)
        return
    if (now or time.time()) - callback_data.at > UNDO_WINDOW_SECONDS:
        await callback.answer(texts.UNDO_TOO_LATE, show_alert=True)
        await edit_markup(card, only_links(card.reply_markup))
        return
    try:
        await api.undo_capture(callback_data.kind, callback_data.id)
    except Exception as error:
        await callback.answer(describe(error, action="undo capture").toast(), show_alert=True)
        return
    content = _original(card)
    original = card.reply_to_message
    if content is not None and not (getattr(original, "text", None) or "").startswith("/"):
        # Saved from a message or a prompt answer: offer the other destinations.
        await edit(card, texts.removed_text(offer_again=True), capture_keyboard(await targets.get(), has_url=content[1] is not None))
    else:
        await edit(card, texts.removed_text(texts.saved_title(card.text)), None)
    await callback.answer("↩ Removed")


async def dismiss(callback: types.CallbackQuery) -> None:
    prompt = accessible(callback)
    if prompt is not None:
        try:
            await prompt.delete()
        except Exception:  # too old to delete: at least drop the buttons
            await edit(prompt, f"<i>{texts.CANCELLED}</i>", None)
    await callback.answer(texts.CANCELLED)


def make_router() -> Router:
    router = Router(name="capture")
    # Messages, in order: commands, the menu's ➕ Task, answers to prompts,
    # unknown commands, then everything else gets the destination buttons.
    router.message.register(cmd_capture, Command("note", "idea", "task", "link", "save"))
    router.message.register(menu_task, F.text == texts.MENU_TASK)
    router.message.register(answer_prompt, prompt_reply)
    router.message.register(unknown_command, F.text.startswith("/"))
    router.message.register(offer_capture)
    router.callback_query.register(save_choice, CaptureCb.filter())
    router.callback_query.register(retry_capture, RetryCb.filter(F.what == "cap"))
    router.callback_query.register(undo_capture, UndoCaptureCb.filter())
    router.callback_query.register(dismiss, DismissCb.filter())
    return router
