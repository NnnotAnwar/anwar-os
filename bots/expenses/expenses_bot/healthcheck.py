"""Docker HEALTHCHECK: healthy while the heartbeat file is fresh.

The bot touches the file right after each successful write of the heartbeat row,
so a fresh file means the process is alive, its event loop is running and Postgres
accepts its writes. Checking the file instead of querying Postgres avoids opening a
new database connection every healthcheck interval.

Usage: python -m expenses_bot.healthcheck [max_age_seconds]   (default 180)
"""

from __future__ import annotations

import sys
import time

from .config import HEARTBEAT_FILE


def main(argv: list[str]) -> int:
    max_age = float(argv[1]) if len(argv) > 1 else 180.0
    try:
        age = time.time() - HEARTBEAT_FILE.stat().st_mtime
    except FileNotFoundError:
        print("unhealthy: no heartbeat yet")
        return 1
    if age > max_age:
        print(f"unhealthy: last heartbeat {age:.0f}s ago")
        return 1
    print(f"ok: last heartbeat {age:.0f}s ago")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
