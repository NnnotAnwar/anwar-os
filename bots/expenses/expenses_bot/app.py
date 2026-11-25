"""Bot lifecycle: Budget API client, polling, heartbeat and graceful shutdown.

The bot has no database of its own any more: expenses are Budget transactions in
anwar.os, reached through api.BudgetApi (signed calls to /api/internal/budget-bot/*).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
from datetime import UTC, datetime

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from . import BOT_NAME, error_report
from .api import BudgetApi
from .config import Config
from .handlers import on_error, routers
from .heartbeat import heartbeat_loop
from .middleware import OwnerOnlyMiddleware
from .profile import setup_bot_profile

log = logging.getLogger(__name__)

# Time given to in-flight handlers after SIGTERM (Docker's default stop timeout is 10 s).
SHUTDOWN_TIMEOUT_SECONDS = 7
PROFILE_TIMEOUT_SECONDS = 20


def build_dispatcher(api: BudgetApi, owner_id: int) -> Dispatcher:
    # FSM state lives in memory (as before): an /add flow in progress is lost on restart.
    dp = Dispatcher()
    dp["api"] = api  # injected into handlers as the `api` argument
    dp.update.outer_middleware(OwnerOnlyMiddleware(owner_id))
    for router in routers:
        dp.include_router(router)
    dp.errors.register(on_error)
    return dp


def create_bot(token: str) -> Bot:
    # Every message is Telegram HTML; user-provided text is escaped in render.py.
    return Bot(
        token=token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML, link_preview_is_disabled=True),
    )


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

    api = BudgetApi(config.api_url, config.api_secret)
    # Unhandled exceptions from here on also go to the app's error log (Ops → Errors).
    reporter = error_report.install(api)
    try:
        bot = create_bot(config.bot_token)
        try:
            # Never raises (failures are logged); bounded so a slow API can't delay polling long.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(setup_bot_profile(bot), PROFILE_TIMEOUT_SECONDS)
            await _poll_until_stopped(bot, build_dispatcher(api, config.owner_id), api, config, started_at, stop)
        finally:
            # Idempotent; needed when polling never started or was cancelled.
            await bot.session.close()
    finally:
        error_report.uninstall(reporter)
        await reporter.drain()
        await api.close()
        log.info("stopped")


async def _poll_until_stopped(
    bot: Bot,
    dp: Dispatcher,
    api: BudgetApi,
    config: Config,
    started_at: datetime,
    stop: asyncio.Event,
) -> None:
    # Polling needs no webhook. Pending updates are kept (the old bot dropped them),
    # so messages sent during a redeploy are still answered.
    await bot.delete_webhook(drop_pending_updates=False)

    polling = asyncio.create_task(
        dp.start_polling(bot, handle_signals=False, tasks_shutdown_timeout=SHUTDOWN_TIMEOUT_SECONDS),
        name="polling",
    )
    heartbeat = asyncio.create_task(
        heartbeat_loop(api, config.version, started_at), name="heartbeat"
    )
    stopper = asyncio.create_task(stop.wait(), name="stop-signal")
    try:
        await asyncio.wait({polling, heartbeat, stopper}, return_when=asyncio.FIRST_COMPLETED)
        if stop.is_set():
            log.info("shutdown requested")
        if not polling.done():
            try:
                # Stops fetching updates and lets in-flight handlers finish (bounded).
                await asyncio.wait_for(dp.stop_polling(), SHUTDOWN_TIMEOUT_SECONDS + 1)
            except (RuntimeError, TimeoutError):  # not started yet / handlers too slow
                pass
    finally:
        for task in (polling, heartbeat, stopper):
            if not task.done():
                task.cancel()
        await asyncio.gather(polling, heartbeat, stopper, return_exceptions=True)
    error = None if polling.cancelled() else polling.exception()
    if error is not None:
        raise error
