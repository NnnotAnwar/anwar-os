"""Bot lifecycle: polling, background loops and graceful shutdown."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
from datetime import UTC, datetime

from aiogram import Bot, Dispatcher
from aiogram.types import BotCommand

from . import BOT_NAME
from .api import OsbotApi
from .config import Config
from .handlers import routers
from .loops import background_tasks
from .middleware import OwnerOnlyMiddleware
from .targets import CaptureTargets

log = logging.getLogger(__name__)

# Time given to in-flight handlers after SIGTERM (Docker's default stop timeout is 10 s).
SHUTDOWN_TIMEOUT_SECONDS = 7

COMMANDS = [
    BotCommand(command="today", description="Today's agenda"),
    BotCommand(command="note", description="Save a note"),
    BotCommand(command="link", description="Save a link"),
    BotCommand(command="idea", description="Save an idea"),
    BotCommand(command="save", description="Save to the default place"),
    BotCommand(command="help", description="What I can do"),
]


def build_dispatcher(api: OsbotApi, owner_chat_id: int) -> Dispatcher:
    dp = Dispatcher()
    dp["api"] = api  # injected into handlers as the `api` argument
    dp["targets"] = CaptureTargets(api)
    dp.update.outer_middleware(OwnerOnlyMiddleware(owner_chat_id))
    for router in routers:
        dp.include_router(router)
    return dp


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

    async with OsbotApi(config.api_url, config.api_secret) as api:
        bot = Bot(token=config.bot_token)
        try:
            await _poll_until_stopped(bot, build_dispatcher(api, config.owner_chat_id), api, config, started_at, stop)
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
) -> None:
    await bot.delete_webhook(drop_pending_updates=False)
    try:
        await bot.set_my_commands(COMMANDS)
    except Exception:
        log.warning("could not set the command menu", exc_info=True)

    polling = asyncio.create_task(
        dp.start_polling(bot, handle_signals=False, tasks_shutdown_timeout=SHUTDOWN_TIMEOUT_SECONDS),
        name="polling",
    )
    loops = background_tasks(bot, api, config.owner_chat_id, config.version, started_at)
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
    if not polling.cancelled() and polling.exception() is not None:
        raise polling.exception()
