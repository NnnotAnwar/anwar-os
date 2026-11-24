"""Client for the web app's internal API (/api/internal/osbot/*).

The bot never touches the database: everything goes through these signed HTTP
calls, and the web app acts as the site owner with row-level security on.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import aiohttp
from yarl import URL

from .signing import signed_headers

log = logging.getLogger(__name__)

PREFIX = "/api/internal/osbot"
TIMEOUT = aiohttp.ClientTimeout(total=20, connect=5)


class ApiError(Exception):
    """A non-2xx answer. `message` is safe to show to the owner when `status` is 4xx."""

    def __init__(self, status: int, code: str, message: str | None = None):
        super().__init__(f"{status} {code}: {message or ''}".strip())
        self.status = status
        self.code = code
        self.message = message


class ApiUnreachable(Exception):
    """No answer at all: connection refused, DNS, timeout. The app is down or restarting."""


class OsbotApi:
    def __init__(self, base_url: str, secret: str, session: aiohttp.ClientSession | None = None):
        self.base_url = base_url.rstrip("/")
        self._secret = secret
        self._session = session
        self._owns_session = session is None

    async def __aenter__(self) -> OsbotApi:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def close(self) -> None:
        if self._owns_session and self._session is not None:
            await self._session.close()
            self._session = None

    def _client(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = aiohttp.ClientSession(timeout=TIMEOUT)
        return self._session

    async def _request(self, method: str, path: str, *, params: dict[str, Any] | None = None, payload: Any = None) -> Any:
        path_and_query = PREFIX + path
        if params:
            path_and_query += "?" + urlencode({k: v for k, v in params.items() if v is not None})
        body = "" if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        headers = signed_headers(self._secret, method, path_and_query, body)
        if body:
            headers["content-type"] = "application/json"
        # encoded=True: send the path exactly as signed (no re-quoting).
        url = URL(self.base_url + path_and_query, encoded=True)
        try:
            async with self._client().request(method, url, data=body.encode("utf-8") if body else None, headers=headers) as resp:
                status = resp.status
                text = await resp.text()
        except (aiohttp.ClientError, TimeoutError, OSError) as exc:
            raise ApiUnreachable(f"{method} {path}: {type(exc).__name__}: {exc}") from exc
        try:
            data = json.loads(text) if text else None
        except ValueError:
            data = None
        if status >= 400:
            code = data.get("error", "error") if isinstance(data, dict) else "error"
            message = data.get("message") if isinstance(data, dict) else None
            raise ApiError(status, code, message)
        return data

    # --- capture -----------------------------------------------------------

    async def capture_targets(self) -> dict[str, Any]:
        """{"default": "note", "targets": [{"kind", "label", "button", "needsUrl"}]}"""
        return await self._request("GET", "/capture/targets")

    async def capture(self, kind: str | None, text: str, url: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"text": text}
        if kind:
            payload["kind"] = kind
        if url:
            payload["url"] = url
        return await self._request("POST", "/capture", payload=payload)

    async def undo_capture(self, kind: str, item_id: str) -> None:
        """Deletes what `capture` just created (the Undo button)."""
        await self._request("POST", "/capture/undo", payload={"kind": kind, "id": item_id})

    # --- agenda, tasks and reminders --------------------------------------------

    async def today(self) -> dict[str, Any]:
        return await self._request("GET", "/today")

    async def task_action(self, task_id: str, action: str, due_date: str | None = None) -> dict[str, Any]:
        """action: complete | reopen | postpone | schedule (with due_date, None = no date)."""
        payload: dict[str, Any] = {"id": task_id, "action": action}
        if action == "schedule":
            payload["dueDate"] = due_date
        return await self._request("POST", "/tasks/action", payload=payload)

    async def reminders_due(self, until: datetime) -> list[dict[str, Any]]:
        data = await self._request("GET", "/reminders/due", params={"until": int(until.timestamp() * 1000)})
        return data["reminders"]

    async def ack_reminders(self, keys: list[str]) -> int:
        data = await self._request("POST", "/reminders/ack", payload={"keys": keys})
        return int(data["acked"])

    # --- feedback -------------------------------------------------------------

    async def new_feedback(self) -> list[dict[str, Any]]:
        data = await self._request("GET", "/feedback/new")
        return data["items"]

    async def ack_feedback(self, ids: list[str]) -> int:
        data = await self._request("POST", "/feedback/ack", payload={"ids": ids})
        return int(data["acked"])

    async def feedback_status(self, feedback_id: str, status: str) -> dict[str, Any]:
        """{"id", "status", "previous"}"""
        return await self._request("POST", "/feedback/status", payload={"id": feedback_id, "status": status})

    # --- heartbeat ------------------------------------------------------------

    async def heartbeat(self, version: str, started_at: datetime) -> None:
        await self._request("POST", "/heartbeat", payload={"version": version, "startedAt": started_at.isoformat()})

    # --- digests: payment reminders and the weekly review (digest.py) -------------

    async def payments_due(self) -> dict[str, Any]:
        """{"today", "date": tomorrow, "items": [{"key", "title", "amountMinor", "currency", …}], "url"}"""
        return await self._request("GET", "/payments/due")

    async def ack_payments(self, keys: list[str]) -> int:
        data = await self._request("POST", "/payments/ack", payload={"keys": keys})
        return int(data["acked"])

    async def weekly(self, date: str | None = None) -> dict[str, Any]:
        """The review of the week containing `date` (YYYY-MM-DD, default today), with "delivered"."""
        return await self._request("GET", "/weekly", params={"date": date} if date else None)

    async def ack_weekly(self, week: str) -> int:
        """`week` is the reviewed week's Monday (the review's week.key)."""
        data = await self._request("POST", "/weekly/ack", payload={"week": week})
        return int(data["acked"])

    # --- the monthly report (monthly.py) ------------------------------------------------

    async def monthly(self, month: str | None = None) -> dict[str, Any]:
        """The report of `month` (YYYY-MM, default this month so far), with "delivered"."""
        return await self._request("GET", "/monthly", params={"month": month} if month else None)

    async def monthly_pdf(self, month: str) -> dict[str, Any]:
        """Files the month's PDF under Files → Reports: {"saved", "fileId", "name", "url"}."""
        return await self._request("POST", "/monthly/pdf", payload={"month": month})

    async def ack_monthly(self, month: str) -> int:
        data = await self._request("POST", "/monthly/ack", payload={"month": month})
        return int(data["acked"])

    # --- habits (habits.py) -------------------------------------------------------

    async def habits(self, date: str | None = None) -> dict[str, Any]:
        """The /habits card for `date` (YYYY-MM-DD, default today):
        {"date", "today", "label", "habits": [{"id", "name", "emoji", "done", "current"}], "done", "total", "url"}"""
        return await self._request("GET", "/habits", params={"date": date} if date else None)

    async def toggle_habit(self, habit_id: str, date: str | None = None) -> dict[str, Any]:
        """Flips one habit for `date` (default today); returns {"toggled": {"id", "done", "name"}, …that day's card}."""
        payload: dict[str, Any] = {"id": habit_id}
        if date:
            payload["date"] = date
        return await self._request("POST", "/habits/toggle", payload=payload)

    async def habit_nudges(self) -> dict[str, Any]:
        """{"date", "reminders": [{"id", "name", "emoji", "time"}], "evening": {"time", "habits"} | None, "url"}"""
        return await self._request("GET", "/habits/nudges")

    async def ack_habit_nudges(self, date: str, reminders: list[str], evening: bool) -> int:
        data = await self._request("POST", "/habits/nudges/ack", payload={"date": date, "reminders": reminders, "evening": evening})
        return int(data["acked"])
