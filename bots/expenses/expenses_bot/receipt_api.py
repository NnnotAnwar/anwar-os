"""Receipt photos through the web app: POST receipt (read) and POST expenses (save).

The bot never holds an AI key: it sends the photo to anwar.os, which asks Claude
(src/modules/budget/receipts) and answers with a draft. Nothing is saved until the
owner taps Save; the photo is not stored anywhere (it lives in memory for one call).

Kept apart from api.py so the receipt flow stays one self-contained piece; it uses
the same signed transport and session as BudgetApi.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, replace
from datetime import date
from typing import Any

import aiohttp
from yarl import URL

from .api import PREFIX, ApiError, ApiUnreachable, BudgetApi, Saved, Totals, parse_expense
from .signing import signed_headers

# Reading a photo is one model call: give it longer than the API's usual 20 s.
RECEIPT_TIMEOUT = aiohttp.ClientTimeout(total=75, connect=5)


@dataclass(frozen=True)
class ReceiptDraft:
    """What the web app read from the photo. amount_minor is positive (spent)."""

    amount_minor: int
    currency: str
    merchant: str | None
    summary: str | None
    note: str
    occurred_on: date
    date_assumed: bool
    category_id: str | None
    category_name: str | None
    account_id: str | None
    account_currency: str | None
    currency_mismatch: bool

    @classmethod
    def parse(cls, data: dict[str, Any]) -> ReceiptDraft:
        return cls(
            amount_minor=int(data["amountMinor"]),
            currency=data["currency"],
            merchant=data.get("merchant") or None,
            summary=data.get("summary") or None,
            note=data.get("note") or "",
            occurred_on=date.fromisoformat(data["occurredOn"]),
            date_assumed=bool(data.get("dateAssumed")),
            category_id=data.get("categoryId"),
            category_name=data.get("categoryName"),
            account_id=data.get("accountId"),
            account_currency=data.get("accountCurrency"),
            currency_mismatch=bool(data.get("currencyMismatch")),
        )

    def to_state(self) -> dict[str, Any]:
        """For the FSM (memory): plain JSON values."""
        return {
            "a": self.amount_minor,
            "cur": self.currency,
            "m": self.merchant,
            "s": self.summary,
            "n": self.note,
            "d": self.occurred_on.isoformat(),
            "da": self.date_assumed,
            "c": self.category_id,
            "cn": self.category_name,
            "acc": self.account_id,
            "accur": self.account_currency,
            "mm": self.currency_mismatch,
        }

    @classmethod
    def from_state(cls, s: dict[str, Any]) -> ReceiptDraft:
        return cls(
            amount_minor=s["a"],
            currency=s["cur"],
            merchant=s.get("m"),
            summary=s.get("s"),
            note=s.get("n") or "",
            occurred_on=date.fromisoformat(s["d"]),
            date_assumed=bool(s.get("da")),
            category_id=s.get("c"),
            category_name=s.get("cn"),
            account_id=s.get("acc"),
            account_currency=s.get("accur"),
            currency_mismatch=bool(s.get("mm")),
        )

    def with_category(self, category_id: str, name: str) -> ReceiptDraft:
        return replace(self, category_id=category_id, category_name=name)

    def with_amount(self, amount_minor: int) -> ReceiptDraft:
        return replace(self, amount_minor=amount_minor)


@dataclass(frozen=True)
class NotRead:
    """The photo isn't a receipt, or its total couldn't be found."""

    reason: str  # "not_receipt" | "no_total"
    message: str


async def _post(api: BudgetApi, path: str, payload: Any) -> Any:
    path_and_query = PREFIX + path
    body = json.dumps(payload, separators=(",", ":"))
    headers = signed_headers(api._secret, "POST", path_and_query, body)  # noqa: SLF001 (same package)
    headers["content-type"] = "application/json"
    url = URL(api.base_url + path_and_query, encoded=True)
    try:
        async with api._client().post(url, data=body.encode("utf-8"), headers=headers, timeout=RECEIPT_TIMEOUT) as resp:  # noqa: SLF001
            status, text = resp.status, await resp.text()
    except (aiohttp.ClientError, TimeoutError, OSError) as exc:
        raise ApiUnreachable(f"POST {path}: {type(exc).__name__}: {exc}") from exc
    try:
        data = json.loads(text) if text else None
    except ValueError:
        data = None
    if status >= 400:
        code = data.get("error", "error") if isinstance(data, dict) else "error"
        message = data.get("message") if isinstance(data, dict) else None
        raise ApiError(status, code, message)
    return data


async def read_receipt(api: BudgetApi, photo: bytes) -> ReceiptDraft | NotRead:
    """Sends the photo to anwar.os to be read. Raises ApiError (e.g. 503 ai_disabled) / ApiUnreachable."""
    data = await _post(api, "/receipt", {"image": base64.b64encode(photo).decode("ascii")})
    if data.get("status") == "ok":
        return ReceiptDraft.parse(data["draft"])
    return NotRead(data.get("status") or "not_receipt", data.get("message") or "That doesn't look like a receipt.")


async def save_receipt(api: BudgetApi, draft: ReceiptDraft) -> Saved:
    """Saves the (possibly edited) draft as an expense in its account."""
    payload: dict[str, Any] = {
        "amountMinor": draft.amount_minor,
        "categoryId": draft.category_id,
        "note": draft.note,
        "occurredOn": draft.occurred_on.isoformat(),
    }
    if draft.account_id:
        payload["accountId"] = draft.account_id
    data = await api._request("POST", "/expenses", payload=payload)  # noqa: SLF001
    api.forget_setup()
    return Saved(parse_expense(data["expense"]), Totals.parse(data.get("totals")))
