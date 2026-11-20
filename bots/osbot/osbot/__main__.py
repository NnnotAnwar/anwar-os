"""Entry point: python -m osbot"""

from __future__ import annotations

import asyncio
import logging
import sys

from .config import ConfigError, load_config
from .log import setup_logging

log = logging.getLogger("osbot")


def main() -> int:
    setup_logging()
    try:
        config = load_config()
    except ConfigError as exc:
        log.error(str(exc))
        return 2

    from .app import run_bot  # imported late: aiogram is heavy

    try:
        asyncio.run(run_bot(config))
    except KeyboardInterrupt:
        pass
    except Exception:
        log.exception("fatal error")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
