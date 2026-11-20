# osbot

anwar.os's own Telegram bot (aiogram 3, long polling). It serves exactly one
chat, the owner's (`OSBOT_OWNER_CHAT_ID`); everyone else gets "Sorry, this is a
private bot."

| | |
|---|---|
| `/today` | today's calendar, due tasks and new feedback count |
| `/note`, `/link`, `/idea`, `/task` `<text>` | save straight into that module |
| `/save <text>` | save to the default destination (Inbox) |
| any message, forward or URL | "Save to Inbox / Save as note / link / idea / task" buttons |
| reminders | calendar reminders, e.g. `⏰ Dentist in 30 min · 14:00` |
| feedback alerts | new feedback from /feedback, with a link to it |

## How it talks to the app

The bot has **no database access**. It calls the web app's internal API,
`/api/internal/osbot/*` (code in `src/modules/osbot/`), over the stack's internal
network (`OSBOT_API_URL=http://web:3000`). Every request is signed with
`OSBOT_API_SECRET`:

```
signature = hex(HMAC-SHA256(secret, f"{ts}\n{nonce}\n{METHOD}\n{path?query}\n{body}"))
headers   = x-osbot-timestamp, x-osbot-nonce, x-osbot-signature
```

The web app refuses anything outside a 60 s window, any reused signature and
any mismatch, then acts as the site owner with row-level security on.

| Endpoint | |
|---|---|
| `GET capture/targets` | destinations for the buttons, default first |
| `POST capture` | `{ kind?, text, url? }` (no kind = default) |
| `GET today` | agenda summary |
| `GET reminders/due?until=<epoch ms>` | due reminders (recurrences expanded) |
| `POST reminders/ack` | `{ keys }` once sent: idempotent |
| `GET feedback/new`, `POST feedback/ack` | feedback alerts, same pattern |
| `POST heartbeat` | every minute; Settings → Telegram shows it |

Loops run once a minute, just after the minute turns: heartbeat, reminders,
feedback. Each item is sent first and acknowledged after, so a crash can repeat
one message but never lose one. While the heartbeat is fresh, the web app stops
sending its own direct feedback alerts and leaves them to osbot.

## Environment

| Variable | |
|---|---|
| `BOT_TOKEN` | from @BotFather (compose passes `OSBOT_TOKEN`) |
| `OSBOT_API_URL` | `http://web:3000` in the stack |
| `OSBOT_API_SECRET` | shared with web, `openssl rand -hex 32` |
| `OSBOT_OWNER_CHAT_ID` | your chat id (see docs/DEPLOY.md, "Connect osbot") |
| `BOT_VERSION` | set by the image build |

## Development

```sh
cd bots/osbot
uv sync
uv run pytest          # no network: Telegram and the web API are faked
```

Running it locally against `pnpm dev` needs a throwaway bot token of your own;
never reuse the production token (only one process may poll it).
