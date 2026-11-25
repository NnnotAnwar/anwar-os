"""The bot's own unhandled exceptions → the app's error log (Ops → Errors).

A logging handler on the root logger: every record at ERROR or above that
carries an exception (a handler that failed, a loop step that crashed) is
sent to the web app (POST /errors/report), which scrubs it, groups it by
fingerprint and alerts like any other error. Warnings (the app didn't answer,
Telegram refused a message) stay in the log only.

Reporting never gets in the way: it runs in the background, at most
MAX_PER_MINUTE reports a minute, the same error at most once a minute, and a
failed report is only logged as a warning (never with an exception, so it
can't report itself).
"""

from __future__ import annotations

import asyncio
import logging
import time
import traceback
from typing import Any

from .api import OsbotApi

log = logging.getLogger(__name__)

MAX_PER_MINUTE = 10
SAME_ERROR_SECONDS = 60
MAX_STACK = 16_000


def report_payload(record: logging.LogRecord) -> dict[str, str] | None:
    """{"name", "message", "stack", "where"} for a record with an exception, else None."""
    if record.levelno < logging.ERROR or not record.exc_info or record.exc_info[1] is None:
        return None
    exc_type, exc, tb = record.exc_info
    name = exc_type.__name__ if exc_type else type(exc).__name__
    stack = "".join(traceback.format_exception(exc_type, exc, tb))[-MAX_STACK:]
    # Which loop or handler: the loop's name (loops.py passes it), else the logger.
    where = str(getattr(record, "loop", "") or record.name)[:100]
    return {"name": name[:200], "message": str(exc)[:4000], "stack": stack, "where": where}


class ErrorReporter(logging.Handler):
    def __init__(self, api: OsbotApi, *, clock=time.monotonic) -> None:
        super().__init__(level=logging.ERROR)
        self._api = api
        self._clock = clock
        self._sent: list[float] = []
        self._recent: dict[tuple[str, str, str], float] = {}
        self._tasks: set[asyncio.Task[Any]] = set()

    def _allowed(self, payload: dict[str, str]) -> bool:
        now = self._clock()
        self._sent = [t for t in self._sent if now - t < 60]
        key = (payload["name"], payload["message"][:200], payload["where"])
        if now - self._recent.get(key, -1e9) < SAME_ERROR_SECONDS or len(self._sent) >= MAX_PER_MINUTE:
            return False
        self._recent = {k: t for k, t in self._recent.items() if now - t < SAME_ERROR_SECONDS}
        self._recent[key] = now
        self._sent.append(now)
        return True

    def emit(self, record: logging.LogRecord) -> None:
        if record.name == __name__:
            return
        try:
            payload = report_payload(record)
            if payload is None or not self._allowed(payload):
                return
            loop = asyncio.get_running_loop()
        except Exception:  # no running loop (shutdown) or a broken record: drop it
            return
        task = loop.create_task(self._send(payload), name="error-report")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _send(self, payload: dict[str, str]) -> None:
        try:
            await self._api._request("POST", "/errors/report", payload=payload)
        except Exception as error:  # never with exc_info: that would report the report
            log.warning("could not report an error to the app", extra={"error": str(error)[:200]})

    async def drain(self) -> None:
        """Waits for reports in flight (tests, shutdown)."""
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)


def install(api: OsbotApi) -> ErrorReporter:
    reporter = ErrorReporter(api)
    logging.getLogger().addHandler(reporter)
    return reporter


def uninstall(reporter: ErrorReporter) -> None:
    logging.getLogger().removeHandler(reporter)
