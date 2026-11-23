"""First contact and navigation: /start (with the main menu keyboard) and /help."""

from __future__ import annotations

from aiogram import F, Router, types
from aiogram.filters import Command, CommandStart

from .. import texts
from ..keyboards import help_keyboard, main_menu


async def cmd_start(message: types.Message) -> None:
    await message.answer(texts.WELCOME, reply_markup=main_menu())


async def cmd_help(message: types.Message, app_url: str) -> None:
    await message.answer(texts.HELP, reply_markup=help_keyboard(app_url))


def make_router() -> Router:
    router = Router(name="menu")
    router.message.register(cmd_start, CommandStart())
    router.message.register(cmd_help, Command("help"))
    router.message.register(cmd_help, F.text == texts.MENU_HELP)
    return router
