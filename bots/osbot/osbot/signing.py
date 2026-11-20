"""HMAC request signing for the internal web API.

Mirror of src/modules/osbot/signature.ts; both test the same vector.

    canonical = f"{timestamp}\\n{nonce}\\n{METHOD}\\n{path_and_query}\\n{body}"
    signature = hex(HMAC-SHA256(secret, canonical))
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

HEADER_TIMESTAMP = "x-osbot-timestamp"
HEADER_NONCE = "x-osbot-nonce"
HEADER_SIGNATURE = "x-osbot-signature"


def canonical_string(timestamp: str, nonce: str, method: str, path: str, body: str) -> str:
    return f"{timestamp}\n{nonce}\n{method.upper()}\n{path}\n{body}"


def sign(secret: str, timestamp: str, nonce: str, method: str, path: str, body: str) -> str:
    message = canonical_string(timestamp, nonce, method, path, body).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def signed_headers(
    secret: str,
    method: str,
    path: str,
    body: str,
    *,
    timestamp: int | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    ts = str(int(time.time()) if timestamp is None else timestamp)
    nonce = nonce or secrets.token_urlsafe(18)
    return {
        HEADER_TIMESTAMP: ts,
        HEADER_NONCE: nonce,
        HEADER_SIGNATURE: sign(secret, ts, nonce, method, path, body),
    }


def verify(secret: str, headers: dict[str, str], method: str, path: str, body: str, *, now: float | None = None) -> bool:
    """Used by the tests' fake API; the real check lives in the web app."""
    ts = headers.get(HEADER_TIMESTAMP, "")
    nonce = headers.get(HEADER_NONCE, "")
    signature = headers.get(HEADER_SIGNATURE, "")
    if not ts.isdigit() or abs((time.time() if now is None else now) - int(ts)) > 60:
        return False
    return hmac.compare_digest(signature, sign(secret, ts, nonce, method, path, body))
