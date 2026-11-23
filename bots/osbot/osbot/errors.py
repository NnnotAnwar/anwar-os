"""What to tell the owner when a call to the web app failed.

Each failure is sorted into a few kinds the owner can act on, with the details
going to the log only:

    unreachable  no answer: the app is down or restarting        → retry later
    auth         the signature was refused (401)                 → config problem
    disabled     the bot API is off (404 not_found: no secret)   → config problem
    outdated     the endpoint doesn't exist (404 from Next)      → deploy the web app
    gone         the item was deleted or isn't the owner's (404) → stale button
    input        the app explained what's wrong (400/413/422)    → fix the input
    server       anything else (5xx)                             → retry later
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .api import ApiError, ApiUnreachable
from .fmt import esc

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Problem:
    kind: str
    title: str
    detail: str
    # Worth a "Try again" button: the same request may well work in a minute.
    retry: bool = False

    def html(self) -> str:
        """A short message: bold title, the detail on the next line."""
        return f"<b>{esc(self.title)}</b>\n{esc(self.detail)}" if self.detail else f"<b>{esc(self.title)}</b>"

    def toast(self) -> str:
        """For callback answers: plain text, at most 200 characters."""
        text = f"{self.title}. {self.detail}" if self.detail else self.title
        return text if len(text) <= 200 else text[:199] + "…"


def describe(error: BaseException, *, action: str = "api call") -> Problem:
    """Sorts `error` into a Problem and logs it (warnings for ours, errors for theirs)."""
    if isinstance(error, ApiUnreachable):
        log.warning(f"{action}: anwar.os unreachable", extra={"error": str(error)})
        return Problem("unreachable", "⚠️ anwar.os isn't answering", "It may be restarting. Try again in a minute.", retry=True)
    if not isinstance(error, ApiError):
        log.error(f"{action} failed", exc_info=error)
        return Problem("bug", "💥 Something went wrong on my side", "It's in the bot's log. Try again?", retry=True)

    extra = {"status": error.status, "code": error.code, "api_message": error.message}
    if error.status == 401:
        log.error(f"{action}: signature refused", extra=extra)
        return Problem(
            "auth",
            "🔒 anwar.os refused my signature",
            "OSBOT_API_SECRET differs between the bot and the web app, or a clock is off. Check the server config.",
        )
    if error.status == 404 and error.code == "not_found":
        log.error(f"{action}: bot API switched off", extra=extra)
        return Problem("disabled", "🔌 The bot API is switched off", "OSBOT_API_SECRET isn't set on the web app.")
    if error.status == 404 and not error.message:
        log.error(f"{action}: endpoint missing", extra=extra)
        return Problem("outdated", "🧩 anwar.os doesn't know this yet", "Deploy the latest web app, then try again.")
    if error.status == 404:
        log.info(f"{action}: item gone", extra=extra)
        return Problem("gone", "🗑 Not there any more", error.message or "It was deleted or changed in the app.")
    if error.status == 413:
        log.info(f"{action}: too large", extra=extra)
        return Problem("input", "✋ That's too long", "Send a shorter message.")
    if 400 <= error.status < 500:
        log.info(f"{action}: refused input", extra=extra)
        return Problem("input", f"✋ {error.message or 'anwar.os didn’t accept that.'}", "")
    if error.status == 503 and error.code == "no_owner":
        log.error(f"{action}: no owner account", extra=extra)
        return Problem("auth", "👤 anwar.os has no owner yet", "Sign up on the site first.")
    log.error(f"{action}: server error", extra=extra)
    return Problem("server", "💥 Something broke on anwar.os", "Details are in the server log. Try again in a bit.", retry=True)
