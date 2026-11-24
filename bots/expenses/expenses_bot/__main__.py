"""Entry point.

python -m expenses_bot                     run the bot
"""

from __future__ import annotations

import asyncio
import logging
import sys

from .config import ConfigError, load_config
from .log import setup_logging

log = logging.getLogger("expenses_bot")


def main(argv: list[str]) -> int:
    setup_logging()
    command = argv[1] if len(argv) > 1 else "run"
    if command != "run":
        print(__doc__, file=sys.stderr)
        return 2
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
    sys.exit(main(sys.argv))
