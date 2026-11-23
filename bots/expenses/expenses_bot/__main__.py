"""Entry point.

python -m expenses_bot                     run the bot
python -m expenses_bot import-to-budget    copy the rows of the bot's old database
    [--dry-run] [--telegram-user ID]       (schema bot_expenses) into Budget, once;
    [--all-users]                          safe to re-run (see import_to_budget.py)
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
    if command == "import-to-budget":
        from .import_to_budget import main as import_main

        return import_main(argv[2:])
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
