"""Configuration, read from environment variables only."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Every loop (heartbeat, reminders, feedback alerts) runs once a minute.
POLL_INTERVAL_SECONDS = 60
# Touched after every successful heartbeat; read by the Docker HEALTHCHECK.
HEARTBEAT_FILE = Path(os.environ.get("HEARTBEAT_FILE", "/tmp/osbot.heartbeat"))
# Must match MIN_SECRET_LENGTH in src/modules/osbot/signature.ts.
MIN_SECRET_LENGTH = 32


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    bot_token: str = field(repr=False)
    api_url: str
    api_secret: str = field(repr=False)
    owner_chat_id: int
    version: str = "dev"


def load_config(env: dict[str, str] | None = None) -> Config:
    env = dict(os.environ) if env is None else env
    names = ("BOT_TOKEN", "OSBOT_API_URL", "OSBOT_API_SECRET", "OSBOT_OWNER_CHAT_ID")
    missing = [name for name in names if not env.get(name, "").strip()]
    if missing:
        raise ConfigError(f"missing required environment variables: {', '.join(missing)}")
    secret = env["OSBOT_API_SECRET"].strip()
    if len(secret) < MIN_SECRET_LENGTH:
        raise ConfigError(f"OSBOT_API_SECRET must be at least {MIN_SECRET_LENGTH} characters")
    try:
        owner = int(env["OSBOT_OWNER_CHAT_ID"].strip())
    except ValueError:
        raise ConfigError("OSBOT_OWNER_CHAT_ID must be a number (your Telegram chat id)") from None
    return Config(
        bot_token=env["BOT_TOKEN"].strip(),
        api_url=env["OSBOT_API_URL"].strip().rstrip("/"),
        api_secret=secret,
        owner_chat_id=owner,
        version=env.get("BOT_VERSION", "").strip() or "dev",
    )
