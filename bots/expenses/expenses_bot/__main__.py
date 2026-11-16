"""Entry point.

python -m expenses_bot            run the bot (applies pending migrations first)
python -m expenses_bot migrate    apply pending migrations and exit (no BOT_TOKEN needed)
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
    if command not in ("run", "migrate"):
        print(__doc__, file=sys.stderr)
        return 2
    try:
        config = load_config(require_token=command == "run")
    except ConfigError as exc:
        log.error(str(exc))
        return 2

    from .app import run_bot, run_migrations  # imported late: aiogram is heavy

    try:
        if command == "migrate":
            applied = asyncio.run(run_migrations(config))
            log.info("migrations up to date", extra={"applied": applied})
        else:
            asyncio.run(run_bot(config))
    except KeyboardInterrupt:
        pass
    except Exception:
        log.exception("fatal error")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
