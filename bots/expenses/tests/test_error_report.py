"""The bot's own unhandled exceptions go to the app's error log (error_report.py)."""

from __future__ import annotations

import logging
from types import SimpleNamespace

from expenses_bot import error_report


def _record(level=logging.ERROR, exc: BaseException | None = None) -> logging.LogRecord:
    exc_info = None
    if exc is not None:
        try:
            raise exc
        except BaseException as caught:  # noqa: BLE001 - building a record
            exc_info = (type(caught), caught, caught.__traceback__)
    return logging.LogRecord("expenses_bot.handlers.fallback", level, __file__, 1, "handler failed", (), exc_info)


async def test_reports_handler_failures_once_a_minute_each():
    sent: list[tuple[str, str, dict]] = []

    async def request(method, path, *, params=None, payload=None):
        sent.append((method, path, payload))
        return {"recorded": True}

    clock = [0.0]
    reporter = error_report.ErrorReporter(SimpleNamespace(_request=request), clock=lambda: clock[0])
    reporter.emit(_record(logging.WARNING, ValueError("not an error")))
    reporter.emit(_record(exc=ZeroDivisionError("division by zero")))
    reporter.emit(_record(exc=ZeroDivisionError("division by zero")))
    await reporter.drain()
    assert [(m, p) for m, p, _ in sent] == [("POST", "/errors/report")]
    payload = sent[0][2]
    assert payload["name"] == "ZeroDivisionError"
    assert payload["where"] == "expenses_bot.handlers.fallback"
    assert "Traceback (most recent call last)" in payload["stack"]
