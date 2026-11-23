"""Client for the web app's internal Budget API (/api/internal/budget-bot/*).

The bot keeps no expense data of its own: every expense is a Budget transaction
in anwar.os, read and written through these signed HTTP calls. The web app acts
as the site owner with row-level security on.

Expenses come back as plain dicts (what render.py and the handlers read):

    id           Budget transaction id (uuid string)
    amount_minor spent, positive minor units
    currency     the account's currency
    category_id  uuid or None (uncategorised)
    category     category name, "Uncategorised" when there is none
    note         None when empty
    occurred_on  date it counts for
    created_at   aware datetime it was recorded
    timed        True when created_at falls on occurred_on (then its time is shown)
    when         created_at when timed, else midnight of occurred_on (Prague)
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from urllib.parse import urlencode

import aiohttp
from yarl import URL

from .config import DEFAULT_CURRENCY
from .periods import local_midnight, to_local
from .signing import signed_headers

log = logging.getLogger(__name__)

PREFIX = "/api/internal/budget-bot"
TIMEOUT = aiohttp.ClientTimeout(total=20, connect=5)
UNCATEGORISED = "Uncategorised"
# Categories and accounts change rarely; one setup call per this many seconds.
SETUP_TTL_SECONDS = 30.0

Expense = dict[str, Any]


class ApiError(Exception):
    """A non-2xx answer. `message` is safe to show to the owner when `status` is 4xx."""

    def __init__(self, status: int, code: str, message: str | None = None):
        super().__init__(f"{status} {code}: {message or ''}".strip())
        self.status = status
        self.code = code
        self.message = message

    @property
    def gone(self) -> bool:
        """The expense was deleted (in the app or another chat) or never was one."""
        return self.status == 404 and self.code == "gone"


class ApiUnreachable(Exception):
    """No answer at all: connection refused, DNS, timeout. The app is down or restarting."""


def parse_expense(data: dict[str, Any]) -> Expense:
    occurred_on = date.fromisoformat(data["occurredOn"])
    created_at = datetime.fromisoformat(data["recordedAt"].replace("Z", "+00:00"))
    timed = to_local(created_at).date() == occurred_on
    return {
        "id": data["id"],
        "amount_minor": int(data["amountMinor"]),
        "currency": data["currency"],
        "category_id": data.get("categoryId"),
        "category": data.get("categoryName") or UNCATEGORISED,
        "note": data.get("note") or None,
        "occurred_on": occurred_on,
        "created_at": created_at,
        "timed": timed,
        "when": created_at if timed else local_midnight(occurred_on),
        "account": data.get("accountName"),
    }


@dataclass(frozen=True)
class Totals:
    """Spent today and this month (per currency), as the web app counted right after a change."""

    day: dict[str, int] = field(default_factory=dict)
    month: dict[str, int] = field(default_factory=dict)

    @classmethod
    def parse(cls, data: dict[str, Any] | None) -> Totals:
        data = data or {}
        return cls(
            day={k: int(v) for k, v in (data.get("day") or {}).items()},
            month={k: int(v) for k, v in (data.get("monthTotals") or {}).items()},
        )


@dataclass(frozen=True)
class Category:
    id: str
    name: str
    uses: int = 0
    parent: str | None = None


@dataclass(frozen=True)
class Setup:
    currency: str
    default_account_id: str | None
    categories: list[Category]
    accounts: list[dict[str, Any]]
    timezone: str = "Europe/Prague"

    @classmethod
    def parse(cls, data: dict[str, Any]) -> Setup:
        return cls(
            currency=data.get("currency") or DEFAULT_CURRENCY,
            default_account_id=data.get("defaultAccountId"),
            categories=[
                Category(id=c["id"], name=c["name"], uses=int(c.get("uses") or 0), parent=c.get("parentName"))
                for c in data.get("categories", [])
            ],
            accounts=list(data.get("accounts", [])),
            timezone=data.get("timezone") or "Europe/Prague",
        )


@dataclass(frozen=True)
class Saved:
    """Result of a write: the expense as stored and the running totals."""

    expense: Expense
    totals: Totals


@dataclass(frozen=True)
class Draft:
    """A parsed entry without a clear category: the bot asks for one."""

    amount_minor: int
    note: str | None
    occurred_on: date
    currency: str


class BudgetApi:
    def __init__(self, base_url: str, secret: str, session: aiohttp.ClientSession | None = None):
        self.base_url = base_url.rstrip("/")
        self._secret = secret
        self._session = session
        self._owns_session = session is None
        self._setup: Setup | None = None
        self._setup_at = 0.0

    async def __aenter__(self) -> BudgetApi:
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

    # --- setup ----------------------------------------------------------------

    async def setup(self, *, fresh: bool = False) -> Setup:
        """Categories (frequent first), accounts and currency; cached for a few seconds."""
        if fresh or self._setup is None or time.monotonic() - self._setup_at > SETUP_TTL_SECONDS:
            self._setup = Setup.parse(await self._request("GET", "/setup"))
            self._setup_at = time.monotonic()
        return self._setup

    def forget_setup(self) -> None:
        """After a write the usage order changes; the next setup() asks again."""
        self._setup = None

    async def currency(self) -> str:
        try:
            return (await self.setup()).currency
        except (ApiError, ApiUnreachable):
            return DEFAULT_CURRENCY

    # --- writes ---------------------------------------------------------------

    async def quick(self, text: str) -> Saved | Draft:
        """Parse one line in Budget and save it, or get a draft back when no category is clear."""
        data = await self._request("POST", "/expenses/quick", payload={"text": text, "requireCategory": True})
        if data.get("status") == "created":
            self.forget_setup()
            return Saved(parse_expense(data["expense"]), Totals.parse(data.get("totals")))
        draft = data["draft"]
        return Draft(
            amount_minor=int(draft["amountMinor"]),
            note=draft.get("note") or None,
            occurred_on=date.fromisoformat(draft["occurredOn"]),
            currency=draft.get("currency") or DEFAULT_CURRENCY,
        )

    async def create(self, amount_minor: int, category_id: str | None, note: str | None, occurred_on: date | None = None) -> Saved:
        payload: dict[str, Any] = {"amountMinor": amount_minor, "categoryId": category_id, "note": note or ""}
        if occurred_on is not None:
            payload["occurredOn"] = occurred_on.isoformat()
        data = await self._request("POST", "/expenses", payload=payload)
        self.forget_setup()
        return Saved(parse_expense(data["expense"]), Totals.parse(data.get("totals")))

    async def get(self, expense_id: str) -> Saved:
        data = await self._request("GET", "/expense", params={"id": expense_id})
        return Saved(parse_expense(data["expense"]), Totals.parse(data.get("totals")))

    async def update(
        self,
        expense_id: str,
        *,
        amount_minor: int | None = None,
        category_id: str | None = None,
        note: str | None = None,
    ) -> Saved:
        """Change the given fields; note="" removes the note."""
        payload: dict[str, Any] = {"id": expense_id}
        if amount_minor is not None:
            payload["amountMinor"] = amount_minor
        if category_id is not None:
            payload["categoryId"] = category_id
        if note is not None:
            payload["note"] = note
        data = await self._request("POST", "/expense/update", payload=payload)
        if category_id is not None:
            self.forget_setup()
        return Saved(parse_expense(data["expense"]), Totals.parse(data.get("totals")))

    async def delete(self, expense_id: str) -> Saved:
        """Deletes it; returns it as it was."""
        data = await self._request("POST", "/expense/delete", payload={"id": expense_id})
        self.forget_setup()
        return Saved(parse_expense(data["expense"]), Totals.parse(data.get("totals")))

    # --- reads ----------------------------------------------------------------

    async def recent(self, limit: int, offset: int = 0) -> tuple[list[Expense], int]:
        """A page of expenses, newest first, and how many there are."""
        data = await self._request("GET", "/expenses/recent", params={"limit": limit, "offset": offset})
        return [parse_expense(x) for x in data["items"]], int(data["total"])

    async def between(self, first: date, last: date) -> list[Expense]:
        """Expenses on the days first..last (inclusive), oldest first."""
        data = await self._request("GET", "/expenses/range", params={"from": first.isoformat(), "to": last.isoformat()})
        if data.get("truncated"):
            log.warning("range truncated by the web app", extra={"from": first.isoformat(), "to": last.isoformat()})
        return [parse_expense(x) for x in data["items"]]

    # --- heartbeat and import ---------------------------------------------------

    async def heartbeat(self, version: str, started_at: datetime) -> None:
        await self._request("POST", "/heartbeat", payload={"version": version, "startedAt": started_at.isoformat()})

    async def import_rows(self, rows: list[dict[str, Any]], *, dry_run: bool = False) -> dict[str, Any]:
        """{"imported": n, "existing": n, "accountId": ...}; each row's key is imported once, ever."""
        return await self._request("POST", "/import", payload={"rows": rows, "dryRun": dry_run})
