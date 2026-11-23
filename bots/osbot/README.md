# osbot

anwar.os's own Telegram bot (aiogram 3, long polling). It serves exactly one
chat, the owner's (`OSBOT_OWNER_CHAT_ID`); everyone else gets "Sorry, this is a
private bot."

| | |
|---|---|
| `/start` | short welcome and the main menu keyboard: 📅 Today · ➕ Task · ❓ Help |
| `/help` | every command, with Today and Open anwar.os buttons |
| `/today` | calendar, due tasks (5 per page, numbered) and new feedback; a number opens the task: ✓ Done, ⏭ Tomorrow, ↗ Open, each with ↩ Undo |
| `/note`, `/link`, `/idea`, `/task` `<text>` | save straight into that module; without text, asks for it (ForceReply) |
| `/save <text>` | save to the default destination (Inbox) |
| any message, forward or URL | "Save this to…" 📥 Inbox · ✅ Task · 📝 Note · 🔗 Link · 💡 Idea · ✕ Cancel |
| after saving | ↗ Open and ↩ Undo (for 2 hours; Undo offers the other destinations) |
| reminders | `⏰ Dentist in 30 min · 14:00` with 💤 10 min / 1 h, ✓ Got it, ↗ Open in calendar |
| feedback alerts | the message quoted, ↗ Open, ✓ Mark read, 🚫 Spam, ↩ Undo |

Messages are HTML (`texts.py`), edited in place where a button changes them,
and every button press gets an answer (a toast) even when it has expired.
Failures say what kind they are (app down, signature/config problem, bad input,
item gone) with a 🔄 Try again where retrying can help; the details go to the
log. Snoozes are kept in memory (`snooze.py`), so a restart forgets them; the
button then says so. The command menu and the bot's descriptions are set at
startup when they differ from `app.py`/`texts.py`.

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
| `POST capture/undo` | `{ kind, id }`: deletes what a capture just created |
| `GET today` | agenda summary (tasks with their `id`) |
| `POST tasks/action` | `{ id, action: complete \| reopen \| postpone \| schedule, dueDate? }` |
| `GET reminders/due?until=<epoch ms>` | due reminders (recurrences expanded, each with a calendar `url`) |
| `POST reminders/ack` | `{ keys }` once sent: idempotent |
| `GET feedback/new`, `POST feedback/ack` | feedback alerts, same pattern |
| `POST feedback/status` | `{ id, status }`, returns the previous status (for Undo) |
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
| `OSBOT_APP_URL` | optional, default `https://anwar-os.com` (Open anwar.os buttons) |
| `OSBOT_TIMEZONE` | optional, default `Europe/Prague` (times the bot formats itself) |

## Development

```sh
cd bots/osbot
uv sync
uv run pytest          # no network: Telegram and the web API are faked
```

Running it locally against `pnpm dev` needs a throwaway bot token of your own;
never reuse the production token (only one process may poll it).
