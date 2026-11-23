"""Where captures can go, as the web app reports it (GET capture/targets).

Cached for a while so every forwarded message doesn't cost an extra request; if
the web app can't be reached, the last known list (or the built-in one) is used.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)

REFRESH_SECONDS = 600


@dataclass(frozen=True)
class Target:
    kind: str
    label: str
    button: str
    needs_url: bool = False


# Used until GET capture/targets answers once; keep it in step with
# src/modules/osbot/capture.ts.
FALLBACK = (
    Target("inbox", "Inbox", "Save to Inbox"),
    Target("task", "Task", "Save as task"),
    Target("note", "Note", "Save as note"),
    Target("link", "Link", "Save as link", needs_url=True),
    Target("idea", "Idea", "Save as idea"),
)


class CaptureTargets:
    def __init__(self, api: Any, *, clock=time.monotonic):
        self._api = api
        self._clock = clock
        self._targets: tuple[Target, ...] = FALLBACK
        self._default = FALLBACK[0].kind
        self._fetched_at: float | None = None

    @property
    def default(self) -> str:
        return self._default

    async def get(self) -> tuple[Target, ...]:
        now = self._clock()
        if self._fetched_at is None or now - self._fetched_at > REFRESH_SECONDS:
            try:
                data = await self._api.capture_targets()
                targets = tuple(
                    Target(t["kind"], t["label"], t.get("button") or f"Save as {t['label'].lower()}", bool(t.get("needsUrl")))
                    for t in data["targets"]
                )
                if targets:
                    self._targets, self._default = targets, data.get("default") or targets[0].kind
                self._fetched_at = now
            except Exception:
                log.warning("could not load capture targets; using the last known list", exc_info=True)
        return self._targets

    def find(self, kind: str) -> Target | None:
        return next((t for t in self._targets if t.kind == kind), None)
