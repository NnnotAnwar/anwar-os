# Expense bot (`bots/expenses`)

Telegram bot that tracks personal expenses. It was `py-telegram` (aiogram 3 + SQLite);
here it runs on the shared anwar.os Postgres in its own schema and as its own container
(roadmap phase 5, ARCHITECTURE §8).

## Using the bot

Send an amount, optionally with a note: `250 coffee`, `89`, `15,50`, `coffee 250`,
`250 kč tram`.

- `250 food` / `250 food lunch` names a category directly and saves at once.
- A note used before (`250 coffee`) is filed under the category it got most often.
- Otherwise an inline category picker appears (most used in the last 90 days first).
- The saved card shows amount, category, note, Prague time and the running day/month
  totals, with **Undo · Amount · Category · Note** buttons. Amount and note are edited by
  replying with text; the card is then replaced by an updated one.

Persistent menu (reply keyboard): **📅 Today · 🗓 Week · 📊 Month · 🧾 History · ❓ Help**.

| Command | Does |
|---|---|
| `/start` | welcome, example, shows the menu |
| `/help` | how to use the bot |
| `/add` | asks for an amount (old flow, still works) |
| `/today`, `/week`, `/month` | overview card: total, count, comparison with the previous period (up to the same point in time for the current period), daily average, top categories with bars; the day card lists its entries. ◀ ▶ move between periods, tabs switch day/week/month, the month card has **Export CSV** |
| `/stats` | same as `/month` (old command) |
| `/history` | recent entries, 8 per page; tap a number to edit or delete (delete asks to confirm) |
| `/export [YYYY-MM]` | a month as CSV (UTF-8 with BOM; date, time, amount, currency, category, note) |
| `/cancel` | leaves an edit in progress |

At startup the bot syncs its command list (menu button), description and short description
via the Bot API, writing only what differs (`expenses_bot/profile.py`); a failure there is
logged and does not stop the bot.

Messages are Telegram HTML (escaped user text), edited in place where possible, every button
tap is answered, and buttons from old messages or a previous bot version get a short
"expired" answer instead of spinning.

All amounts are stored and shown in **CZK** (see "Currency" below).

## How it works

- **aiogram 3, long polling.** No public endpoint needed. Conversation state is in memory, as
  before: pending category pickers (amount + note) and an amount/note edit in progress.
  Buttons carry expense ids and period dates, so they keep working after a restart; only a
  picker for an entry with a note expires (it says so), one without a note still saves.
- **Postgres via asyncpg**, pool of 1–4 connections, as role `bot_expenses`, which owns
  only schema `bot_expenses`.
- **Migrations**: at startup the bot applies `db/migrations/*.sql` that are not yet in
  `bot_expenses.schema_migrations` (each file in one transaction, under an advisory lock),
  then re-grants the stats views to `os_app`.
- **Heartbeat**: every 60 s it upserts the single row in `bot_expenses.heartbeat`
  (bot name, version, started_at, last_beat_at) and touches `/tmp/expenses-bot.heartbeat`.
  The Docker `HEALTHCHECK` (`python -m expenses_bot.healthcheck`) is healthy while that
  file is younger than 180 s. A fresh file means the process and its event loop are
  alive and Postgres accepted the write. Checking a file means the healthcheck does not
  open a new DB connection every 30 s.
- **Logs**: JSON lines on stdout (`ts`, `level`, `logger`, `msg`, extra fields). Message
  texts and amounts are not logged.
- **Shutdown**: on SIGTERM/SIGINT it stops polling, lets running handlers finish (up to
  7 s), stops the heartbeat and closes the pool. Python runs as PID 1 with its own signal
  handler, so no init process is needed.

### Data model (`bot_expenses` schema)

| Object | Contents |
|---|---|
| `users` | `telegram_id` (PK), `username` (nullable), `first_seen`, `last_seen` |
| `expenses` | `id`, `telegram_user_id` → users, `amount_minor` bigint (> 0), `currency` (ISO, default `CZK`), `category`, `note` (nullable, 1–200 chars, migration 0002), `created_at` timestamptz, `external_ref` (unique, set by imports) |
| `activity_daily` | `(day, telegram_user_id)` → `updates` (messages + button taps per Prague day) |
| `heartbeat` | exactly one row (`id = 1`) |
| `schema_migrations` | applied migration versions |
| view `stats_daily` | `day`, `messages`, `active_users`, `expenses`, `amounts_minor` jsonb (`{"CZK": 15050}`) |
| view `stats_overview` | `total_users`, `active_users_7d`, `active_users_30d`, `total_expenses`, `total_amounts_minor` jsonb, `last_heartbeat_at`, `bot_version` |

`os_app` (the web app) gets `USAGE` on the schema and `SELECT` on the two views only. The
views run with the owner's rights, so the web app sees aggregates but cannot read
the tables.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `BOT_TOKEN` | yes (not for `migrate`) | token from @BotFather |
| `DATABASE_URL` | yes | `postgresql://bot_expenses:<password>@<host>:5432/<db>`. URL-encode the password, or generate a hex one (`openssl rand -hex 24`) |
| `BOT_VERSION` | no | shown in the heartbeat/stats. The image bakes the build arg `BOT_VERSION` (CI passes the commit SHA) |
| `HEARTBEAT_FILE` | no | heartbeat file path, default `/tmp/expenses-bot.heartbeat` |

Configuration is read from the environment only. There is no `.env` loading in the code;
Compose or the shell provides it.

## One-time database setup

As the Postgres superuser (or `os_migrator` with CREATEROLE), once per database:

```sh
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -v bot_password="$BOT_EXPENSES_DB_PASSWORD" -f bots/expenses/db/bootstrap.sql
```

This creates the login role `bot_expenses` (no superuser/createdb/createrole/bypassrls),
schema `bot_expenses` owned by it, revokes `PUBLIC`, and grants `os_app` usage on the
schema. You can run it again; a re-run also rotates the password. If `os_app` does not
exist yet, the script skips its grants, and the bot grants the views at its next start
once `os_app` exists.

In the prod compose this can run from the `postgres` container:
`docker compose exec -T postgres psql -U postgres -d <db> -v bot_password=... -f - < bots/expenses/db/bootstrap.sql`.

## Run locally

With [uv](https://docs.astral.sh/uv/) (Python 3.13 is pinned in `.python-version`):

```sh
cd bots/expenses
uv sync
export DATABASE_URL=postgresql://bot_expenses:<pw>@localhost:5432/<db>
uv run python -m expenses_bot migrate      # apply migrations only, no token needed
BOT_TOKEN=<test bot token> uv run python -m expenses_bot
```

With Docker (use a **separate test bot** from @BotFather, not the production token: two
pollers on one token fight over updates):

```sh
docker build -t anwar-os-bot-expenses:dev bots/expenses
docker run --rm --name bot-expenses \
  -e BOT_TOKEN=<test bot token> \
  -e DATABASE_URL=postgresql://bot_expenses:<pw>@host.docker.internal:5432/<db> \
  anwar-os-bot-expenses:dev
docker inspect --format '{{.State.Health.Status}}' bot-expenses
```

## Tests

DB tests need a throwaway Postgres. They create and drop the roles `bot_expenses` and
`os_app`, so never point them at a real database:

```sh
docker run --rm -d --name expenses-pg-test -p 55499:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine
cd bots/expenses
TEST_DATABASE_URL=postgresql://postgres:test@localhost:55499/postgres \
TEST_PSQL="docker exec -i expenses-pg-test psql -U postgres" \
uv run pytest
docker stop expenses-pg-test
```

`TEST_PSQL` runs the real `db/bootstrap.sql` through psql. Without `TEST_DATABASE_URL`
the DB tests are skipped and only the unit tests run (money parsing, handlers with
mocks, the shutdown path, the importer's conversion helpers).

## Import the old SQLite data

`scripts/import_sqlite.py` copies the old `expenses.db` into Postgres in one transaction.

- `amount` REAL becomes `amount_minor` integer. Conversion goes through the float's
  shortest decimal form (`15.5` → 1550, `0.1` → 10) and rounds half-up to 2 decimals.
- Every old row gets currency `CZK` (change with `--currency EUR`). The old bot had no
  currency and printed `$`.
- Old dates are naive local times; they are read as `Europe/Prague` (`--timezone`).
- Each row gets `external_ref = 'sqlite:<old id>'`, so running the import twice inserts
  nothing new.
- `users` rows are created from the data (first/last expense time, no username).
- Rows without a user, with an amount ≤ 0 or with an unreadable date are skipped and
  listed in the report.
- The SQLite file is opened read-only.

```sh
# 1. schema must exist: start the bot once, or
docker compose run --rm bot-expenses python -m expenses_bot migrate
# 2. check first
docker compose run --rm -v /path/to/expenses.db:/data/expenses.db:ro \
  bot-expenses python scripts/import_sqlite.py /data/expenses.db --dry-run
# 3. import
docker compose run --rm -v /path/to/expenses.db:/data/expenses.db:ro \
  bot-expenses python scripts/import_sqlite.py /data/expenses.db
```

(or locally: `DATABASE_URL=... uv run python scripts/import_sqlite.py ~/WebDev/2026/py-telegram/expenses.db --dry-run`)

Stop the old bot before importing, so no expense is added to SQLite afterwards.

## Deploy

CI builds `ghcr.io/nnnotanwar/anwar-os-bot-expenses:<sha>` for `linux/amd64,linux/arm64`
with `--build-arg BOT_VERSION=<sha>`. The image carries the labels `os.managed=true`,
`os.kind=bot`, `os.name=expenses`, so the ops-agent can list, restart and redeploy it.

Service for `infra/compose.prod.yml` (adjust the network and variable names to that file):

```yaml
  bot-expenses:
    image: ghcr.io/nnnotanwar/anwar-os-bot-expenses:${BOT_EXPENSES_TAG:-latest}
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      BOT_TOKEN: ${BOT_EXPENSES_TOKEN:?}
      DATABASE_URL: postgresql://bot_expenses:${BOT_EXPENSES_DB_PASSWORD:?}@postgres:5432/${POSTGRES_DB:?}
    labels:
      os.managed: "true"
      os.kind: bot
      os.name: expenses
    networks: [internal]          # same network as postgres; no ports published
    read_only: true
    tmpfs: [/tmp]                 # heartbeat file
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    mem_limit: 128m
    stop_grace_period: 15s
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
```

`.env` on the server needs `BOT_EXPENSES_TOKEN`, `BOT_EXPENSES_DB_PASSWORD` (the same
value passed to `bootstrap.sql`) and `BOT_EXPENSES_TAG`.

Order on first deploy: Postgres up → web migrations (creates `os_app`) → `bootstrap.sql`
→ `docker compose up -d bot-expenses` → optional SQLite import. Stop the old bot first.
Only one process may poll a token at a time.
