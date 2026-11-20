"""Slash commands: /start, /help, /today, /note, /link, /idea, /save."""

from __future__ import annotations

from aiogram import Router, types
from aiogram.filters import Command, CommandObject, CommandStart

from ..api import OsbotApi
from ..targets import CaptureTargets
from ..texts import HELP, saved_text, today_text
from .common import NO_PREVIEW, URL_RE, error_text

router = Router()

USAGE = {
    "note": "Send /note followed by the text, e.g. /note Call the bank tomorrow",
    "link": "Send /link followed by the address, e.g. /link https://react.dev/learn",
    "idea": "Send /idea followed by the idea, e.g. /idea A bot that waters the plants",
    "save": "Send /save followed by the text.",
}


@router.message(CommandStart())
@router.message(Command("help"))
async def cmd_start(message: types.Message) -> None:
    await message.answer(HELP)


@router.message(Command("today"))
async def cmd_today(message: types.Message, api: OsbotApi) -> None:
    try:
        data = await api.today()
    except Exception as error:
        await message.answer(error_text(error))
        return
    await message.answer(today_text(data), link_preview_options=NO_PREVIEW)


async def _save(message: types.Message, api: OsbotApi, kind: str | None, text: str, url: str | None = None) -> None:
    try:
        result = await api.capture(kind, text, url)
    except Exception as error:
        await message.answer(error_text(error))
        return
    await message.answer(saved_text(result), link_preview_options=NO_PREVIEW)


@router.message(Command("note", "idea"))
async def cmd_note_or_idea(message: types.Message, command: CommandObject, api: OsbotApi) -> None:
    text = (command.args or "").strip()
    if not text:
        await message.answer(USAGE[command.command])
        return
    await _save(message, api, command.command, text)


@router.message(Command("link"))
async def cmd_link(message: types.Message, command: CommandObject, api: OsbotApi) -> None:
    text = (command.args or "").strip()
    match = URL_RE.search(text)
    if not match:
        await message.answer(USAGE["link"])
        return
    await _save(message, api, "link", text, match.group(0))


@router.message(Command("save"))
async def cmd_save(message: types.Message, command: CommandObject, api: OsbotApi, targets: CaptureTargets) -> None:
    text = (command.args or "").strip()
    if not text:
        await message.answer(USAGE["save"])
        return
    await targets.get()  # refreshes the default if it's stale
    await _save(message, api, targets.default, text)
