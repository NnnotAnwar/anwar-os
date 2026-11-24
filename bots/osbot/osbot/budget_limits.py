"""Budget limit alerts: a category at 90 % of its monthly limit, and once it's used up.

Once a minute the bot asks the web app (GET budget-limits/due,
src/modules/osbot/limit-alerts.ts) which categories crossed a threshold this
month without having been announced, sends one message per category and
acknowledges its keys (POST budget-limits/ack). The app remembers what went
out (osbot_deliveries), so restarts and the next poll repeat nothing; a send
that fails isn't acked and is tried again a minute later. A category that
jumps straight past 100 % gets only the "used up" message.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from aiogram.types import InlineKeyboardMarkup

from .api import OsbotApi
from .digest import money
from .fmt import esc, truncate
from .keyboards import url_button
from .loops import every_minute
from .tg import send_card

log = logging.getLogger(__name__)


# --- API (own calls, so the shared client in api.py stays untouched) ---------


async def due(api: OsbotApi) -> dict[str, Any]:
    """{"month", "items": [{key, keys, name, threshold, limitMinor, spentMinor, leftMinor, percent, paceMinor, currency}], "url"}"""
    return await api._request("GET", "/budget-limits/due")


async def ack(api: OsbotApi, keys: list[str]) -> int:
    data = await api._request("POST", "/budget-limits/ack", payload={"keys": keys})
    return int(data["acked"])


# --- texts -----------------------------------------------------------------------


def alert_text(item: dict[str, Any]) -> str:
    """⚠️ Food: 90 % of the monthly limit / 🔴 Food: monthly limit used up, with spent, left and pace."""
    name = esc(truncate(item["name"], 60))
    currency = item["currency"]
    spent, cap, left = int(item["spentMinor"]), int(item["limitMinor"]), int(item["leftMinor"])
    if int(item["threshold"]) >= 100:
        head = f"🔴 <b>{name}: monthly limit used up</b>"
        tail = f"over by {money(-left, currency)}" if left < 0 else "nothing left this month"
    else:
        head = f"⚠️ <b>{name}: {int(item['percent'])} % of the monthly limit</b>"
        tail = f"{money(left, currency)} left"
    lines = [head, f"{money(spent, currency)} of {money(cap, currency)} · {tail}"]
    pace = item.get("paceMinor")
    if int(item["threshold"]) < 100 and pace is not None and int(pace) > cap:
        lines.append(f"<i>At this pace: {money(int(pace), currency)} by the end of the month</i>")
    return "\n".join(lines)


def alert_keyboard(url: str | None) -> InlineKeyboardMarkup | None:
    button = url_button("↗ Limits", url)
    return InlineKeyboardMarkup(inline_keyboard=[[button]]) if button else None


# --- loop --------------------------------------------------------------------------


async def limits_once(bot: Any, api: OsbotApi, chat_id: int) -> int:
    """Sends each new crossing as its own message, then acks its keys. Returns how many were sent."""
    try:
        data = await due(api)
    except Exception:
        log.warning("could not fetch budget limit alerts", exc_info=True)
        return 0
    sent = 0
    for item in data.get("items") or []:
        try:
            await send_card(bot, chat_id, alert_text(item), alert_keyboard(data.get("url")))
        except Exception:
            log.warning("could not send a budget limit alert", exc_info=True)
            continue  # not acked: retried next minute
        sent += 1
        try:
            await ack(api, item.get("keys") or [item["key"]])
        except Exception:
            log.warning("could not ack a budget limit alert", exc_info=True)
    return sent


def limits_task(bot: Any, api: OsbotApi, chat_id: int) -> asyncio.Task:
    return asyncio.create_task(every_minute(lambda: limits_once(bot, api, chat_id), name="budget-limits"), name="budget-limits")
