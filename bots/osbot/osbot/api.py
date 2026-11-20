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
        async with self._client().request(method, url, data=body.encode("utf-8") if body else None, headers=headers) as resp:
            text = await resp.text()
            try:
                data = json.loads(text) if text else None
            except ValueError:
                data = None
            if resp.status >= 400:
                code = data.get("error", "error") if isinstance(data, dict) else "error"
                message = data.get("message") if isinstance(data, dict) else None
                raise ApiError(resp.status, code, message)
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

    # --- agenda and reminders -----------------------------------------------

    async def today(self) -> dict[str, Any]:
        return await self._request("GET", "/today")

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

    # --- heartbeat ------------------------------------------------------------

    async def heartbeat(self, version: str, started_at: datetime) -> None:
        await self._request("POST", "/heartbeat", payload={"version": version, "startedAt": started_at.isoformat()})
