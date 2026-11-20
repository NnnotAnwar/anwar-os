"""Quick capture: any message or forwarded post gets "Save as …" buttons.

Stateless: the buttons are sent as a reply to the owner's message, and a button
press reads that original message back from `reply_to_message`. Nothing is kept
in memory, so buttons keep working across restarts.
"""

from __future__ import annotations

from aiogram import F, Router, types

from ..api import OsbotApi
from ..targets import CALLBACK_PREFIX, CaptureTargets, capture_keyboard
from ..texts import saved_text
from .common import NO_PREVIEW, error_text, message_content

router = Router()

NOTHING_TO_SAVE = "I can save text and links. This message has neither."
GONE = "The original message is gone. Send it again."


@router.message(F.text.startswith("/"))
async def unknown_command(message: types.Message) -> None:
    await message.answer("Unknown command. /help lists what I can do.")


@router.message()
async def offer_capture(message: types.Message, targets: CaptureTargets) -> None:
    text, url = message_content(message)
    if not text.strip() and not url:
        await message.answer(NOTHING_TO_SAVE)
        return
    keyboard = capture_keyboard(await targets.get(), has_url=url is not None)
    await message.reply("Save this?", reply_markup=keyboard)


@router.callback_query(F.data.startswith(CALLBACK_PREFIX))
async def save_choice(callback: types.CallbackQuery, api: OsbotApi, targets: CaptureTargets) -> None:
    kind = callback.data.removeprefix(CALLBACK_PREFIX)
    prompt = callback.message
    original = getattr(prompt, "reply_to_message", None)
    if original is None:
        await callback.answer(GONE, show_alert=True)
        return
    text, url = message_content(original)
    target = targets.find(kind)
    try:
        result = await api.capture(kind, text, url if target is None or target.needs_url else None)
    except Exception as error:
        # Keep the buttons: another choice (or a retry) may still work.
        await callback.answer(error_text(error), show_alert=True)
        return
    await prompt.edit_text(saved_text(result), link_preview_options=NO_PREVIEW)
    await callback.answer()
