# Expense bot (`bots/expenses`)

Telegram front-end for **Budget** in anwar.os (@anwarexpensesbot). Every expense you send
is an ordinary Budget transaction: it shows up in `/app/budget` at once, and what you
change there shows up here. The bot keeps no expense data of its own.

## Using the bot

Send an amount, optionally with a note: `250 coffee`, `89`, `15,50`, `coffee 250`,
`250 kč tram`, `90 food yesterday`.

- `250 food` / `250 food lunch` names a Budget category directly and saves at once (Budget's
  quick-add parser: exact name, then a name or word that starts with what you typed).
- A note used before (`250 coffee`) is filed under the category Budget has it under most often.
- Otherwise an inline category picker appears: Budget's expense categories, most used in
  the last 90 days first, "Other" always reachable.
- The saved card shows amount, category, note, Prague time and the running day/month
  totals, with **Undo · Amount · Category · Note** buttons. Amount and note are edited by
  replying with text; the card is then replaced by an updated one.
- When the category (or its parent) has a monthly limit in Budget → Limits, the saved and
  updated cards add what's left of it: `🎯 Food · 800 CZK left of 6 000 CZK`, `⚠️` from
  90 %, `🔴 … over by …` once used up. osbot sends the 90 % and "used up" alerts.

**Receipt photos.** Send a photo of a receipt (or an image file): the bot sends it to
anwar.os, which has Claude read the total, shop, date and a fitting category, and answers
with a card: `💸 312 CZK · Albert · today · 🍔 Food?` with **✅ Save · 🏷 Category ·
✏️ Amount · ✖ Cancel**. Nothing is saved until Save (with no category it asks for one
first). Save goes into the Budget account in the receipt's currency when there is one
(otherwise the default account, with a warning to fix the amount). The bot never holds an
AI key and never stores the photo: it is downloaded into memory, sent once and dropped.
Without `ANTHROPIC_API_KEY` on web the bot says "Receipt reading is off".

Persistent menu (reply keyboard): **📅 Today · 🗓 Week · 📊 Month · 🧾 History · ❓ Help**.

| Command | Does |
|---|---|
| `/start` | welcome, example, shows the menu |
| `/help` | how to use the bot |
| `/add` | asks for an amount |
| `/today`, `/week`, `/month` | overview card: total, count, comparison with the previous period (up to the same point in time for the current period), daily average, top categories with bars; the day card lists its entries. ◀ ▶ move between periods, tabs switch day/week/month, the month card has **Export CSV** |
| `/stats` | same as `/month` |
| `/history` | recent expenses, 8 per page; tap a number to edit or delete (delete asks to confirm) |
| `/export [YYYY-MM]` | a month as CSV (UTF-8 with BOM; date, time, amount, currency, category, note) |
| `/subscriptions` | what subscriptions cost a month and a year, each with its cadence and next charge; other recurring payments in one line; 🔄 Refresh, ↗ Open in Budget |
| `/limits` | this month's category limits (Budget → Limits), fullest first: spent of limit, a bar, what's left or how far over, the pace when it heads past the limit; 🔄 Refresh, ↗ Open in Budget |
| `/cancel` | leaves an edit in progress |

Summaries, history and CSV cover **all** spending in Budget (transfers between own
accounts excluded), including what you typed on the web. Days are Budget's
`occurred_on`; the time of day is shown when the expense was recorded on that day
(`--:--` / no time for one entered later for an earlier day).

Only the owner is served (`BOT_EXPENSES_OWNER_ID`); anyone else gets "This is a private
bot." and nothing reaches the web app. New expenses go to Budget's default account (the
first CZK account, i.e. the only one today) in that account's currency.

At startup the bot syncs its command list (menu button), description and short description
via the Bot API, writing only what differs (`expenses_bot/profile.py`); a failure there is
logged and does not stop the bot.

Messages are Telegram HTML (escaped user text), edited in place where possible, every button
tap is answered, and buttons from old messages (including the numeric-id buttons from the
bot's own-database days) get a short "expired" answer instead of spinning.

## How it works

- **aiogram 3, long polling.** No public endpoint. Conversation state is in memory: pending
  category pickers (amount, note, day) and an amount/note edit in progress. Buttons carry
  the Budget transaction id (32 hex digits) and period dates, so they keep working after a
  restart; only a picker for an entry with a note expires (it says so).
- **Budget API, no database.** Every read and write is an HMAC-signed HTTP call to
  `http://web:3000/api/internal/budget-bot/*` (`expenses_bot/api.py`, signing in
  `expenses_bot/signing.py`, headers `x-budget-bot-*`). web checks the signature with
  `BOT_EXPENSES_API_SECRET`, acts as the site owner and goes through the Budget module's
  own actions with row-level security on. The API is off (404) until that secret is set,
  and Caddy answers `/api/internal/*` with 404 from the internet.

  | Endpoint | Used for |
  |---|---|
  | `GET setup` | timezone, default account + currency, expense categories (frequent first) |
  | `POST expenses/quick` | `250 food lunch` → saved, or a draft when no category is clear |
  | `POST expenses` | save after a picker tap |
  | `GET expense?id=` · `POST expense/update` · `POST expense/delete` | cards, edits, undo, delete |
  | `GET expenses/recent?limit&offset` | history pages |
  | `GET expenses/range?from&to` | day/week/month overviews, comparisons, CSV |
  | `POST heartbeat` | Bots panel + Docker health |
  | `GET subscriptions` | `/subscriptions`: Budget's recurring expenses with next charge and monthly/yearly cost |
  | `GET limits` | `/limits`: this month's category limits with spent, left and status |
  | `POST receipt` | a receipt photo (base64) → a draft (`src/modules/budget/receipts`; Claude runs on web, 75 s timeout, `expenses_bot/receipt_api.py`) |

- **Errors** are specific (`expenses_bot/errors.py`): anwar.os not answering, signature
  refused (secret mismatch), API switched off, endpoint missing (deploy web), expense
  gone, input refused (Budget's own message), server error.
- **Heartbeat**: every 60 s `POST heartbeat` (shown in the Bots panel, stats source
  `budget-bot`), then it touches `/tmp/expenses-bot.heartbeat`. The Docker `HEALTHCHECK`
  is healthy while that file is younger than 180 s, i.e. while web accepts the signed
  heartbeat (token, secret, network and owner account all work).
- **Logs**: JSON lines on stdout. Message texts and amounts are not logged.
- **Shutdown**: on SIGTERM/SIGINT it stops polling, lets running handlers finish (up to
  7 s), stops the heartbeat and closes the HTTP session.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `BOT_TOKEN` | yes | token from @BotFather |
| `BOT_EXPENSES_API_URL` | yes | web's internal address, `http://web:3000` in the prod compose |
| `BOT_EXPENSES_API_SECRET` | yes | shared with web, ≥ 32 chars (`openssl rand -hex 32`) |
| `BOT_EXPENSES_OWNER_ID` | yes | your Telegram user id (the compose falls back to `OSBOT_OWNER_CHAT_ID`, the same number for a private chat) |
| `BOT_VERSION` | no | shown in the heartbeat; the image bakes the build arg (CI passes the commit SHA) |
| `HEARTBEAT_FILE` | no | default `/tmp/expenses-bot.heartbeat` |

Configuration is read from the environment only.

## Run locally

```sh
cd bots/expenses
uv sync
BOT_TOKEN=<test bot token> BOT_EXPENSES_API_URL=http://localhost:3000 \
BOT_EXPENSES_API_SECRET=<same as web's> BOT_EXPENSES_OWNER_ID=<your id> \
uv run python -m expenses_bot
```

Use a **separate test bot** from @BotFather, never the production token: two pollers on
one token fight over updates. web needs `BOT_EXPENSES_API_SECRET` in `.env.local`.

## Tests

```sh
cd bots/expenses
uv run pytest
```

The handlers and the API client run against an in-memory fake of the Budget API served
over HTTP on localhost (`tests/fake_budget.py`, signatures checked the way web checks
them).

The web side is covered by `src/modules/budget/bot-api/lib.test.ts` (shared signature
vector), `db/tests/budget-bot-api.test.ts` (every endpoint, RLS) and
`db/tests/budget-receipt.test.ts` (the receipt endpoint with a scripted Claude).
`tests/test_receipt.py` drives the photo flow against the fake API plus a canned draft.

## The old database

Before it became a Budget front-end the bot wrote to its own schema `bot_expenses`. Its
rows were copied into Budget once (`budget_transactions.import_key` = `bot-expenses:<id>`),
and migration 0053 dropped the schema and its role.

## Deploy

CI builds `ghcr.io/nnnotanwar/anwar-os-bot-expenses:<sha>` for `linux/amd64,linux/arm64`
with `--build-arg BOT_VERSION=<sha>`. The image carries the labels `os.managed=true`,
`os.kind=bot`, `os.name=expenses`, so the ops-agent can list, restart and redeploy it.
The service is in `infra/compose.prod.yml` (profile `bots`), on the `internal` network
(web) and `egress` (Telegram), starting after web is healthy. `.env` on the server needs
`BOT_EXPENSES_TOKEN`, `BOT_EXPENSES_API_SECRET` and `BOT_EXPENSES_OWNER_ID` (or
`OSBOT_OWNER_CHAT_ID`); see docs/DEPLOY.md §13.
