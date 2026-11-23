"""Configuration, read from environment variables only."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Owner's timezone: "today" / "this week" / "this month" and every time shown. The
# web app counts "today" in the owner's own timezone (Europe/Prague as well).
TIMEZONE = "Europe/Prague"
# Shown until Budget has told the bot the default account's currency.
DEFAULT_CURRENCY = "CZK"

HEARTBEAT_INTERVAL_SECONDS = 60
# Touched after every heartbeat the web app accepted; read by the Docker HEALTHCHECK.
HEARTBEAT_FILE = Path(os.environ.get("HEARTBEAT_FILE", "/tmp/expenses-bot.heartbeat"))
# Must match MIN_SECRET_LENGTH in src/lib/signed-request.ts.
MIN_SECRET_LENGTH = 32


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    api_url: str
    api_secret: str = field(repr=False)
    # Telegram user id of the site owner: the only person the bot serves, since
    # everything it saves lands in the owner's Budget.
    owner_id: int
    bot_token: str = field(default="", repr=False)
    version: str = "dev"


def load_config(env: dict[str, str] | None = None, *, require_token: bool = True) -> Config:
    env = dict(os.environ) if env is None else env
    names = ["BOT_EXPENSES_API_URL", "BOT_EXPENSES_API_SECRET", "BOT_EXPENSES_OWNER_ID"]
    if require_token:
        names.insert(0, "BOT_TOKEN")
    missing = [name for name in names if not env.get(name, "").strip()]
    if missing:
        raise ConfigError(f"missing required environment variables: {', '.join(missing)}")
    secret = env["BOT_EXPENSES_API_SECRET"].strip()
    if len(secret) < MIN_SECRET_LENGTH:
        raise ConfigError(f"BOT_EXPENSES_API_SECRET must be at least {MIN_SECRET_LENGTH} characters")
    try:
        owner = int(env["BOT_EXPENSES_OWNER_ID"].strip())
    except ValueError:
        raise ConfigError("BOT_EXPENSES_OWNER_ID must be a number (your Telegram user id)") from None
    return Config(
        api_url=env["BOT_EXPENSES_API_URL"].strip().rstrip("/"),
        api_secret=secret,
        owner_id=owner,
        bot_token=env.get("BOT_TOKEN", "").strip(),
        version=env.get("BOT_VERSION", "").strip() or "dev",
    )
