"""An in-memory stand-in for the web app's Budget API (/api/internal/budget-bot/*).

A real aiohttp server on localhost, so the bot's BudgetApi client is exercised over
HTTP exactly as in production: signatures are checked like the web app does (wrong
secret -> 401), JSON in and out, the same error shapes ({"error", "message"}).

The Budget logic is a small model of the real thing (src/modules/budget/bot-api):
expense categories, one default account, quick add ("250 food lunch", "250 coffee",
"90 food yesterday", a note filed before), running totals, pages, ranges, import keys.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from aiohttp import web
from aiohttp.test_utils import TestServer

from expenses_bot import signing
from expenses_bot.periods import TZ, today_local

SECRET = "fake-budget-secret-0123456789abcdef0123"
PREFIX = "/api/internal/budget-bot"

DEFAULT_CATEGORIES = [
    "Food",
    "Eating out",
    "Housing",
    "Utilities",
    "Transport",
    "Health",
    "Shopping",
    "Fun",
    "Subscriptions",
    "Travel",
    "Gifts",
    "Education",
    "Other",
]


@dataclass
class Txn:
    id: str
    amount_minor: int  # signed, like Budget: negative = spent
    category_id: str | None
    note: str
    occurred_on: date
    created_at: datetime
    currency: str = "CZK"
    import_key: str | None = None
    owner: str = "owner"


@dataclass
class FakeBudget:
    categories: dict[str, str] = field(default_factory=dict)  # id -> name
    account_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    currency: str = "CZK"
    txns: list[Txn] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)
    beats: list[dict[str, Any]] = field(default_factory=list)
    # path -> (status, body): answer this instead (e.g. to simulate an outage)
    fail: dict[str, tuple[int, dict[str, Any]]] = field(default_factory=dict)
    unsigned: int = 0

    def __post_init__(self) -> None:
        if not self.categories:
            self.categories = {str(uuid.uuid4()): name for name in DEFAULT_CATEGORIES}

    # --- helpers for tests ---------------------------------------------------------

    def category_id(self, name: str) -> str:
        return next(cid for cid, n in self.categories.items() if n.casefold() == name.casefold())

    def add(
        self,
        amount_minor: int,
        category: str | None = None,
        note: str = "",
        *,
        at: datetime | None = None,
        on: date | None = None,
        currency: str = "CZK",
        owner: str = "owner",
    ) -> Txn:
        """An expense as if typed in Budget (amount_minor positive = spent)."""
        at = at or datetime.now(UTC)
        txn = Txn(
            id=str(uuid.uuid4()),
            amount_minor=-amount_minor,
            category_id=self.category_id(category) if category else None,
            note=note,
            occurred_on=on or at.astimezone(TZ).date(),
            created_at=at,
            currency=currency,
            owner=owner,
        )
        self.txns.append(txn)
        return txn

    def expenses(self) -> list[Txn]:
        return [t for t in self.txns if t.owner == "owner" and t.amount_minor < 0]

    def find(self, txn_id: str) -> Txn | None:
        return next((t for t in self.expenses() if t.id == txn_id), None)

    # --- JSON shapes -------------------------------------------------------------

    def expense_json(self, t: Txn) -> dict[str, Any]:
        return {
            "id": t.id,
            "amountMinor": -t.amount_minor,
            "currency": t.currency,
            "categoryId": t.category_id,
            "categoryName": self.categories.get(t.category_id) if t.category_id else None,
            "note": t.note,
            "occurredOn": t.occurred_on.isoformat(),
            "recordedAt": t.created_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
            "accountId": self.account_id,
            "accountName": "Main account",
        }

    def totals(self) -> dict[str, Any]:
        today = today_local()
        day: dict[str, int] = {}
        month: dict[str, int] = {}
        for t in self.expenses():
            if (t.occurred_on.year, t.occurred_on.month) == (today.year, today.month):
                month[t.currency] = month.get(t.currency, 0) - t.amount_minor
                if t.occurred_on == today:
                    day[t.currency] = day.get(t.currency, 0) - t.amount_minor
        return {"today": today.isoformat(), "month": f"{today:%Y-%m}", "day": day, "monthTotals": month}

    def saved(self, t: Txn) -> dict[str, Any]:
        return {"expense": self.expense_json(t), "totals": self.totals()}

    def ranked_categories(self) -> list[dict[str, Any]]:
        since = today_local() - timedelta(days=90)
        uses: dict[str, int] = {}
        last: dict[str, datetime] = {}
        for t in self.expenses():
            if t.category_id and t.occurred_on >= since:
                uses[t.category_id] = uses.get(t.category_id, 0) + 1
                last[t.category_id] = max(last.get(t.category_id, t.created_at), t.created_at)
        epoch = datetime(1970, 1, 1, tzinfo=UTC)
        order = sorted(
            self.categories.items(),
            key=lambda kv: (-uses.get(kv[0], 0), -(last.get(kv[0], epoch).timestamp()), kv[1]),
        )
        return [{"id": cid, "name": name, "parentId": None, "parentName": None, "color": "slate", "uses": uses.get(cid, 0)} for cid, name in order]

    # --- quick add (a small model of Budget's parser) ------------------------------

    def parse(self, text: str) -> tuple[int, str | None, str, date]:
        words = text.split()
        amount = round(float(words[0].replace(",", ".")) * 100)
        rest = words[1:]
        day = today_local()
        if rest and rest[-1].lower() == "yesterday":
            day -= timedelta(days=1)
            rest = rest[:-1]
        category = None
        if rest:
            first = rest[0].casefold()
            for cid, name in self.categories.items():
                if name.casefold() == first or (len(first) >= 3 and name.casefold().startswith(first)):
                    category, rest = cid, rest[1:]
                    break
        return amount, category, " ".join(rest), day

    def learned(self, note: str) -> str | None:
        if not note:
            return None
        counts: dict[str, int] = {}
        for t in self.expenses():
            if t.category_id and t.note.casefold() == note.casefold():
                counts[t.category_id] = counts.get(t.category_id, 0) + 1
        return max(counts, key=lambda k: counts[k]) if counts else None

    def create(self, amount: int, category_id: str | None, note: str, day: date | None = None) -> Txn:
        now = datetime.now(UTC)
        txn = Txn(str(uuid.uuid4()), -amount, category_id, note, day or today_local(), now, self.currency)
        self.txns.append(txn)
        return txn

    # --- HTTP ----------------------------------------------------------------------

    async def handle(self, request: web.Request) -> web.Response:
        body = await request.text()
        lowered = {k.lower(): v for k, v in request.headers.items()}
        ok = signing.verify(SECRET, lowered, request.method, request.raw_path, body)
        payload = json.loads(body) if body else None
        self.calls.append({"method": request.method, "path": request.path, "query": dict(request.query), "body": payload})
        if not ok:
            self.unsigned += 1
            return web.json_response({"error": "unauthorized"}, status=401)
        path = request.path.removeprefix(PREFIX)
        if path in self.fail:
            status, reply = self.fail[path]
            return web.json_response(reply, status=status)
        try:
            result = self.route(request.method, path, dict(request.query), payload)
            if result is None:  # like Next for a route it doesn't have: 404, no JSON
                return web.Response(status=404, text="This page could not be found.")
            return web.json_response(result)
        except Gone:
            return web.json_response({"error": "gone", "message": "That expense doesn't exist any more."}, status=404)
        except Refused as exc:
            return web.json_response({"error": exc.code, "message": str(exc)}, status=exc.status)

    def route(self, method: str, path: str, query: dict[str, str], body: Any) -> Any:
        if (method, path) == ("GET", "/setup"):
            return {
                "timezone": "Europe/Prague",
                "today": today_local().isoformat(),
                "defaultAccountId": self.account_id,
                "currency": self.currency,
                "accounts": [{"id": self.account_id, "name": "Main account", "kind": "bank", "currency": self.currency, "balanceMinor": 0}],
                "categories": self.ranked_categories(),
            }
        if (method, path) == ("POST", "/expenses/quick"):
            try:
                amount, category, note, day = self.parse(body["text"])
            except (ValueError, IndexError):
                raise Refused(400, "invalid_input", "Start with an amount, e.g. “250 food lunch”.") from None
            category = category or self.learned(note)
            if category is None and body.get("requireCategory", True):
                return {"status": "needs_category", "draft": {"amountMinor": amount, "note": note, "occurredOn": day.isoformat(), "currency": self.currency}}
            txn = self.create(amount, category, note, day)
            return {"status": "created", "matchedBy": "name", **self.saved(txn)}
        if (method, path) == ("POST", "/expenses"):
            if body.get("categoryId") and body["categoryId"] not in self.categories:
                raise Refused(422, "no_category", "That category doesn't exist any more.")
            day = date.fromisoformat(body["occurredOn"]) if body.get("occurredOn") else None
            return self.saved(self.create(body["amountMinor"], body.get("categoryId"), body.get("note", ""), day))
        if (method, path) == ("GET", "/expense"):
            return self.saved(self.require(query["id"]))
        if (method, path) == ("POST", "/expense/update"):
            txn = self.require(body["id"])
            if "amountMinor" in body:
                txn.amount_minor = -body["amountMinor"]
            if "categoryId" in body:
                txn.category_id = body["categoryId"]
            if "note" in body:
                txn.note = body["note"]
            return self.saved(txn)
        if (method, path) == ("POST", "/expense/delete"):
            txn = self.require(body["id"])
            self.txns.remove(txn)
            return self.saved(txn)
        if (method, path) == ("GET", "/expenses/recent"):
            rows = sorted(self.expenses(), key=lambda t: (t.occurred_on, t.created_at), reverse=True)
            limit, offset = int(query.get("limit", 8)), int(query.get("offset", 0))
            return {"items": [self.expense_json(t) for t in rows[offset : offset + limit]], "total": len(rows)}
        if (method, path) == ("GET", "/expenses/range"):
            first, last = date.fromisoformat(query["from"]), date.fromisoformat(query["to"])
            rows = sorted((t for t in self.expenses() if first <= t.occurred_on <= last), key=lambda t: (t.occurred_on, t.created_at))
            return {"items": [self.expense_json(t) for t in rows], "truncated": False}
        if (method, path) == ("POST", "/heartbeat"):
            self.beats.append(body)
            return {"ok": True}
        if (method, path) == ("POST", "/import"):
            keys = {t.import_key for t in self.txns}
            imported = existing = 0
            for row in body["rows"]:
                if row["currency"] != self.currency:
                    raise Refused(422, "currency_mismatch", f"{row['key']} is in {row['currency']}.")
            for row in body["rows"]:
                if row["key"] in keys:
                    existing += 1
                    continue
                keys.add(row["key"])
                imported += 1
                if body.get("dryRun"):
                    continue
                cid = next((c for c, n in self.categories.items() if row["categoryName"] and n.casefold() == row["categoryName"].casefold()), None)
                self.txns.append(
                    Txn(
                        str(uuid.uuid4()),
                        -row["amountMinor"],
                        cid,
                        row["note"],
                        date.fromisoformat(row["occurredOn"]),
                        datetime.fromisoformat(row["recordedAt"]),
                        row["currency"],
                        import_key=row["key"],
                    )
                )
            return {"dryRun": bool(body.get("dryRun")), "accountId": self.account_id, "imported": imported, "existing": existing}
        return None

    def require(self, txn_id: str) -> Txn:
        txn = self.find(txn_id)
        if txn is None:
            raise Gone()
        return txn

    async def start(self) -> TestServer:
        app = web.Application()
        app.router.add_route("*", "/{tail:.*}", self.handle)
        server = TestServer(app)
        await server.start_server()
        return server


class Gone(Exception):
    pass


class Refused(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
