"""Bot lifecycle: polling, background loops and graceful shutdown."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
from datetime import UTC, datetime

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from . import BOT_NAME, texts
from .api import OsbotApi
from .config import DEFAULT_APP_URL, Config
from .digest import WeeklyMemory, digest_tasks
from .fmt import set_timezone
from .handlers import make_routers, on_error
from .loops import background_tasks
from .middleware import OwnerOnlyMiddleware
from .snooze import ReminderMemory
from .targets import CaptureTargets

log = logging.getLogger(__name__)

# Time given to in-flight handlers after SIGTERM (Docker's default stop timeout is 10 s).
SHUTDOWN_TIMEOUT_SECONDS = 7

# The command menu (the "/" button next to the input field), most used first.
COMMANDS = [
    BotCommand(command="today", description="Today's calendar and due tasks"),
    BotCommand(command="week", description="This week in review"),
    BotCommand(command="task", description="Add a task"),
    BotCommand(command="note", description="Save a note"),
    BotCommand(command="link", description="Save a link"),
    BotCommand(command="idea", description="Save an idea"),
    BotCommand(command="save", description="Save to the Inbox"),
    BotCommand(command="help", description="What I can do"),
]


def build_dispatcher(
    api: OsbotApi,
    owner_chat_id: int,
    *,
    app_url: str = DEFAULT_APP_URL,
    reminders: ReminderMemory | None = None,
    weekly: WeeklyMemory | None = None,
) -> Dispatcher:
    dp = Dispatcher()
    # Injected into handlers by argument name.
    dp["api"] = api
    dp["targets"] = CaptureTargets(api)
    dp["app_url"] = app_url
    dp["reminders"] = reminders if reminders is not None else ReminderMemory()
    # The weekly review's snooze, shared with its loop (digest.py).
    dp["weekly"] = weekly if weekly is not None else WeeklyMemory()
    dp.update.outer_middleware(OwnerOnlyMiddleware(owner_chat_id))
    for router in make_routers():
        dp.include_router(router)
    dp.errors.register(on_error)
    return dp


async def set_up_profile(bot: Bot) -> None:
    """Command menu and descriptions, set only when they differ (these calls are rate-limited)."""
    steps = [
        (
            "commands",
            lambda: bot.get_my_commands(),
            lambda current: [(c.command, c.description) for c in current] == [(c.command, c.description) for c in COMMANDS],
            lambda: bot.set_my_commands(COMMANDS),
        ),
        (
            "short description",
            lambda: bot.get_my_short_description(),
            lambda current: current.short_description == texts.SHORT_DESCRIPTION,
            lambda: bot.set_my_short_description(short_description=texts.SHORT_DESCRIPTION),
        ),
        (
            "description",
            lambda: bot.get_my_description(),
            lambda current: current.description == texts.DESCRIPTION,
            lambda: bot.set_my_description(description=texts.DESCRIPTION),
        ),
    ]
    for name, get, same, put in steps:
        try:
            if not same(await get()):
                await put()
                log.info(f"updated the bot's {name}")
        except Exception:
            log.warning(f"could not set the bot's {name}", exc_info=True)


def _install_signal_handlers(stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):  # not available on Windows
            loop.add_signal_handler(sig, stop.set)


async def run_bot(config: Config) -> None:
    # Installed first, so SIGTERM during startup is not ignored (we run as PID 1).
    stop = asyncio.Event()
    _install_signal_handlers(stop)
    started_at = datetime.now(UTC)
    log.info("starting", extra={"bot": BOT_NAME, "version": config.version, "api": config.api_url})

    set_timezone(config.timezone)
    reminders = ReminderMemory()
    async with OsbotApi(config.api_url, config.api_secret) as api:
        # Every text is HTML (texts.py); links in messages don't unfurl.
        bot = Bot(token=config.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML, link_preview_is_disabled=True))
        dp = build_dispatcher(api, config.owner_chat_id, app_url=config.app_url, reminders=reminders)
        try:
            await _poll_until_stopped(bot, dp, api, config, started_at, stop, reminders)
        finally:
            await bot.session.close()
    log.info("stopped")


async def _poll_until_stopped(
    bot: Bot,
    dp: Dispatcher,
    api: OsbotApi,
    config: Config,
    started_at: datetime,
    stop: asyncio.Event,
    reminders: ReminderMemory | None = None,
) -> None:
    await bot.delete_webhook(drop_pending_updates=False)
    await set_up_profile(bot)

    polling = asyncio.create_task(
        dp.start_polling(bot, handle_signals=False, tasks_shutdown_timeout=SHUTDOWN_TIMEOUT_SECONDS),
        name="polling",
    )
    loops = background_tasks(bot, api, config.owner_chat_id, config.version, started_at, reminders)
    loops += digest_tasks(bot, api, config.owner_chat_id, dp.get("weekly") or WeeklyMemory())
    stopper = asyncio.create_task(stop.wait(), name="stop-signal")
    tasks = [polling, *loops, stopper]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        if stop.is_set():
            log.info("shutdown requested")
        if not polling.done():
            try:
                await asyncio.wait_for(dp.stop_polling(), SHUTDOWN_TIMEOUT_SECONDS + 1)
            except (RuntimeError, TimeoutError):  # not started yet / handlers too slow
                pass
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    failure = None if polling.cancelled() else polling.exception()
    if failure is not None:
        raise failure
