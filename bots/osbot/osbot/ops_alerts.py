"""Server alerts (Ops → Server in the app): disk, memory, backups, certificates,
containers, a pending reboot, the agent itself, and the weekly files storage
check (files_check.py runs it; its findings arrive here as kind "files").

Every 5 minutes the bot asks the web app to evaluate the server
(POST ops-alerts/check, src/modules/ops/alerts.ts). The app keeps the state in
Postgres and answers with what the owner hasn't been told yet: new problems
("firing") and problems that went away ("resolved"). Each is sent, then
acknowledged (POST ops-alerts/ack), like reminders: a crash between the two can
repeat a message, never lose one, and bot restarts or deploys repeat nothing.

The one thing the app can't report is itself. When the check gets no answer
(or a 5xx) twice in a row, the bot says so on its own and says again when the
app answers. That state lives in memory only: after a restart it takes two
failed checks again before anything is sent.

Switching kinds off and muting live in the app (Ops → Server → Telegram
alerts); a muted alert is simply not returned until the mute ends.

The same check returns the error log's news (kind "errors"): an error seen
for the first time, or a resolved one that came back. Each is one message
("🐞 New error: … · GET /app/x · ×3") with ↗ Open and ✓ Resolve; the app
keeps them to a few an hour and folds the rest into one summary. Each message
is acked after sending (POST ops-alerts/errors/ack), like the rest.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from aiogram.types import InlineKeyboardMarkup

from .api import ApiError, ApiUnreachable, OsbotApi
from .fmt import esc, parse_instant, stamp, truncate
from .keyboards import error_keyboard, url_button
from .loops import every_minute, seconds_to_next_minute
from .tg import send_card

log = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 300
# Consecutive failed checks before "anwar.os isn't answering" (10 minutes):
# a deploy restarts web for well under a minute.
WEB_DOWN_AFTER = 2

KIND_ICONS = {
    "disk": "💾",
    "memory": "🧠",
    "backup": "🗄",
    "cert": "🔒",
    "container": "📦",
    "reboot": "🔁",
    "agent": "🔌",
    "files": "🗂",
    "errors": "🐞",
    "drill": "🧪",
}


# --- API (own calls, so the shared client in api.py stays untouched) ---------


async def check(api: OsbotApi) -> dict[str, Any]:
    """{"checkedAt", "firing": [...], "mutedUntil", "notifications": [{key, kind, event, title, detail, since}]}"""
    return await api._request("POST", "/ops-alerts/check")


async def ack(api: OsbotApi, key: str, event: str) -> int:
    data = await api._request("POST", "/ops-alerts/ack", payload={"items": [{"key": key, "event": event}]})
    return int(data["acked"])


# --- texts --------------------------------------------------------------------


def alert_text(n: dict[str, Any], now: datetime) -> str:
    """🔴 💾 Disk 91 % full / ✅ Resolved: Disk 91 % full."""
    icon = KIND_ICONS.get(n.get("kind", ""), "⚠️")
    title = esc(truncate(n.get("title", "Server alert"), 200))
    try:
        since = stamp(parse_instant(n["since"]), now)
    except (KeyError, ValueError):
        since = None
    if n.get("event") == "resolved":
        line = f"✅ <b>Resolved</b> · {icon} {title}"
        return f"{line}\n<i>Back to normal since {since}.</i>" if since else line
    detail = esc(truncate(n.get("detail", ""), 600))
    text = f"🔴 {icon} <b>{title}</b>"
    if detail:
        text += f"\n{detail}"
    if since:
        text += f"\n<i>Since {since}</i>"
    return text


WEB_DOWN = (
    "🔴 🌐 <b>anwar.os isn't answering</b>\n"
    "The last two server checks got no answer from the app (10 min). "
    "Server alerts are paused until it is back."
)
WEB_BACK = "✅ <b>Resolved</b> · 🌐 anwar.os answers again"


def ops_keyboard(app_url: str) -> InlineKeyboardMarkup | None:
    button = url_button("↗ Open Ops", f"{app_url.rstrip('/')}/app/ops#server")
    return InlineKeyboardMarkup(inline_keyboard=[[button]]) if button else None


# --- errors (kind "errors": the app's error log) -------------------------------------

ERROR_FOOTER = "✓ Resolved"
_ERROR_FOOTER_RE = re.compile(r"\n\n<i>" + re.escape(ERROR_FOOTER) + r"</i>$")


def error_url(app_url: str, error_id: str | None = None) -> str:
    """The row in Ops → Errors (opened and scrolled to), or the section."""
    base = f"{app_url.rstrip('/')}/app/ops"
    return f"{base}#error-{error_id}" if error_id else f"{base}#errors"


def error_text(e: dict[str, Any]) -> str:
    """🐞 New error: TypeError: Cannot read … · GET /app/notes/[id] · ×3"""
    head = "Error again" if e.get("event") == "reopened" else "New error"
    message = f"{e.get('name') or 'Error'}: {e.get('message')}" if e.get("message") else (e.get("name") or "Error")
    parts = [esc(truncate(message, 300))]
    if e.get("where"):
        parts.append(esc(truncate(str(e["where"]), 120)))
    parts.append(f"×{int(e.get('count') or 1)}")
    return f"🐞 <b>{head}</b>: " + " · ".join(parts)


def errors_summary_text(summary: dict[str, Any]) -> str:
    """🐞 5 more errors, then up to five titles."""
    count = int(summary.get("count") or len(summary.get("ids") or []))
    lines = [f"🐞 <b>{count} more {'error' if count == 1 else 'errors'}</b> (new or back)"]
    lines += [f"• {esc(truncate(str(t), 120))}" for t in (summary.get("titles") or [])[:5]]
    if count > 5:
        lines.append(f"<i>…and {count - 5} more in Ops → Errors</i>")
    return "\n".join(lines)


def with_error_footer(html_text: str, status: str) -> str:
    """The card with "✓ Resolved" at the bottom when resolved, without it when open again."""
    base = _ERROR_FOOTER_RE.sub("", html_text)
    return f"{base}\n\n<i>{ERROR_FOOTER}</i>" if status == "resolved" else base


async def ack_errors(api: OsbotApi, ids: list[str]) -> int:
    data = await api._request("POST", "/ops-alerts/errors/ack", payload={"ids": ids})
    return int(data["acked"])


async def send_errors(bot: Any, api: OsbotApi, chat_id: int, app_url: str, errors: dict[str, Any] | None) -> int:
    """One message per error (Open / Resolve), then the summary; each acked after sending."""
    sent = 0
    for e in (errors or {}).get("items") or []:
        try:
            await send_card(bot, chat_id, error_text(e), error_keyboard(e["id"], error_url(app_url, e["id"])))
        except Exception:
            log.warning("could not send an error alert", exc_info=True, extra={"error_id": e.get("id")})
            continue  # not acked: offered again next check
        try:
            await ack_errors(api, [e["id"]])
            sent += 1
        except Exception:
            log.warning("could not ack an error alert", exc_info=True, extra={"error_id": e.get("id")})
    summary = (errors or {}).get("summary")
    if summary and summary.get("ids"):
        button = url_button("↗ Open errors", error_url(app_url))
        try:
            await send_card(bot, chat_id, errors_summary_text(summary), InlineKeyboardMarkup(inline_keyboard=[[button]]) if button else None)
        except Exception:
            log.warning("could not send the errors summary", exc_info=True)
            return sent
        try:
            await ack_errors(api, list(summary["ids"])[:100])
            sent += 1
        except Exception:
            log.warning("could not ack the errors summary", exc_info=True)
    return sent


# --- the loop -------------------------------------------------------------------


@dataclass
class WebHealth:
    """Consecutive failed checks, and whether the owner was told the app is down."""

    failures: int = 0
    told_down: bool = False


async def ops_alerts_once(
    bot: Any, api: OsbotApi, chat_id: int, health: WebHealth, app_url: str, now: datetime | None = None
) -> int:
    """One check: sends what changed, acks each after sending; returns how many were sent."""
    now = now or datetime.now(UTC)
    try:
        result = await check(api)
    except (ApiUnreachable, ApiError) as error:
        if isinstance(error, ApiError) and error.status < 500:
            # A refused signature, or an app from before ops alerts (404): a
            # setup problem the heartbeat loop shows too, not an outage.
            log.warning("ops alert check refused", extra={"status": error.status, "code": error.code})
            return 0
        health.failures += 1
        log.warning("ops alert check failed", extra={"failures": health.failures, "error": str(error)})
        if health.failures >= WEB_DOWN_AFTER and not health.told_down:
            try:
                await send_card(bot, chat_id, WEB_DOWN)
                health.told_down = True
            except Exception:
                log.warning("could not send the app-down alert", exc_info=True)
        return 0

    sent = 0
    health.failures = 0
    if health.told_down:
        try:
            await send_card(bot, chat_id, WEB_BACK)
            health.told_down = False
            sent += 1
        except Exception:
            log.warning("could not send the app-back message", exc_info=True)

    keyboard = ops_keyboard(app_url)
    for n in result.get("notifications", []):
        try:
            await send_card(bot, chat_id, alert_text(n, now), keyboard)
        except Exception:
            log.warning("could not send an ops alert", exc_info=True, extra={"key": n.get("key")})
            continue  # not acked: offered again next check
        try:
            await ack(api, n["key"], n["event"])
            sent += 1
        except Exception:
            log.warning("could not ack an ops alert", exc_info=True, extra={"key": n.get("key")})
    sent += await send_errors(bot, api, chat_id, app_url, result.get("errors"))
    return sent


def ops_alerts_task(bot: Any, api: OsbotApi, chat_id: int, app_url: str, *, sleep=asyncio.sleep) -> asyncio.Task:
    """The loop: now, then just after every 5-minute mark."""
    health = WebHealth()
    return asyncio.create_task(
        every_minute(
            lambda: ops_alerts_once(bot, api, chat_id, health, app_url),
            name="ops-alerts",
            sleep=sleep,
            wait=lambda: seconds_to_next_minute(interval=CHECK_INTERVAL_SECONDS),
        ),
        name="ops-alerts",
    )
