"""Configuration, read from environment variables only."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Owner's timezone: "today" / "this month" and the stats views use it.
TIMEZONE = "Europe/Prague"
# The bot has no currency picker; every new expense is stored in this currency.
DEFAULT_CURRENCY = "CZK"

HEARTBEAT_INTERVAL_SECONDS = 60
# Touched after every successful heartbeat write; read by the Docker HEALTHCHECK.
HEARTBEAT_FILE = Path(os.environ.get("HEARTBEAT_FILE", "/tmp/expenses-bot.heartbeat"))

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "db" / "migrations"


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    database_url: str
    bot_token: str = field(repr=False)
    version: str = "dev"


def load_config(*, require_token: bool = True) -> Config:
    missing = [
        name
        for name in ("DATABASE_URL", "BOT_TOKEN")
        if not os.environ.get(name) and (name != "BOT_TOKEN" or require_token)
    ]
    if missing:
        raise ConfigError(f"missing required environment variables: {', '.join(missing)}")
    return Config(
        database_url=os.environ["DATABASE_URL"],
        bot_token=os.environ.get("BOT_TOKEN", ""),
        version=os.environ.get("BOT_VERSION") or "dev",
    )
