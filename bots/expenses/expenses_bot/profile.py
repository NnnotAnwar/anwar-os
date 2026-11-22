"""Bot profile set at startup: command list (menu button) and descriptions.

Idempotent: each value is read first and only written when it differs, so restarts do not
spend Bot API calls (setMyDescription etc. are rate limited) and never fail the startup.
"""

from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.types import BotCommand

log = logging.getLogger(__name__)

COMMANDS = [
    BotCommand(command="add", description="Log an expense"),
    BotCommand(command="today", description="Today's spending"),
    BotCommand(command="week", description="This week by category"),
    BotCommand(command="month", description="This month by category"),
    BotCommand(command="history", description="Recent entries: edit or delete"),
    BotCommand(command="export", description="This month as a CSV file"),
    BotCommand(command="help", description="How to use the bot"),
]

# Shown in the empty chat before /start (max 512 chars).
DESCRIPTION = (
    "Track your spending in seconds.\n\n"
    "Send an amount like “250 coffee” and pick a category. "
    "See today, this week and this month at a glance, fix or delete entries, "
    "and export a month to CSV."
)
# Shown on the bot's profile and in shared links (max 120 chars).
SHORT_DESCRIPTION = "Personal expense tracker: send “250 coffee”, see where your money goes."


async def setup_bot_profile(bot: Bot) -> list[str]:
    """Bring commands and descriptions up to date; return the names of what changed."""
    changed: list[str] = []
    steps = (
        ("commands", _sync_commands),
        ("description", _sync_description),
        ("short_description", _sync_short_description),
    )
    for name, step in steps:
        try:
            if await step(bot):
                changed.append(name)
        except Exception:
            log.warning("could not update bot profile", extra={"part": name}, exc_info=True)
    log.info("bot profile checked", extra={"changed": changed})
    return changed


async def _sync_commands(bot: Bot) -> bool:
    current = await bot.get_my_commands()
    if [(c.command, c.description) for c in current] == [(c.command, c.description) for c in COMMANDS]:
        return False
    await bot.set_my_commands(COMMANDS)
    return True


async def _sync_description(bot: Bot) -> bool:
    current = await bot.get_my_description()
    if current.description == DESCRIPTION:
        return False
    await bot.set_my_description(description=DESCRIPTION)
    return True


async def _sync_short_description(bot: Bot) -> bool:
    current = await bot.get_my_short_description()
    if current.short_description == SHORT_DESCRIPTION:
        return False
    await bot.set_my_short_description(short_description=SHORT_DESCRIPTION)
    return True
