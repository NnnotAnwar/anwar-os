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
| `/week` | the week in review (below), with ↗ Open in app and 🔄 Refresh |
| `/month` `[last \| YYYY-MM]` | the monthly report (this month so far by default), with ↗ Open in app, 📄 PDF and 🔄 Refresh |
| payment reminders | from 10:00 the day before a recurring expense charges: `💳 Tomorrow: Netflix · 299 CZK` (several: one list with the total), ↗ Subscriptions |
| budget limits | once a category reaches 90 % of its monthly limit (Budget → Limits): `⚠️ Food: 92 % of the monthly limit` with what's left and, when it heads past the limit, the month-end pace; once it's used up: `🔴 Food: monthly limit used up` and by how much; each once per category and month (a jump straight past 100 % sends only the second), ↗ Limits |
| weekly review | Sundays from 19:00, once: tasks done / added / overdue, 🎯 focus (top 3 due or overdue), next week's calendar, spending vs last week with top categories and the Budget plan, payments next week, new ideas / notes / links / feedback; ↗ Open in app, 💤 1 h, ⏭ Skip |
| monthly report | the 1st from 10:00, once, for last month: spending vs the month before with top categories and the biggest changes, income and net, subscriptions a month, tasks done / added, new notes / ideas / links / feedback, site views with top pages. Its PDF is filed into Files → Reports first; ↗ Open in app, 📄 PDF |

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
| `GET payments/due` | recurring expenses charging tomorrow (owner's timezone) not reminded yet, each with a `key` |
| `POST payments/ack` | `{ keys }` (`<recurring id>:<date>`) once sent: idempotent |
| `GET budget-limits/due` | categories at 90 % / 100 % of their monthly limit this month not announced yet, each with `key` and every `keys` it settles |
| `POST budget-limits/ack` | `{ keys }` (`<category id>:<YYYY-MM>:<90\|100>`) once sent: idempotent |
| `GET weekly?date=` | the review of the week (Mon–Sun) containing `date`, default today, with `delivered` |
| `POST weekly/ack` | `{ week }` (its Monday) once the Sunday review is sent: idempotent |
| `GET monthly?month=` | the monthly report (`YYYY-MM`, default this month so far), with `delivered` |
| `POST monthly/pdf` | `{ month }`: saves its PDF into Files → Reports (replacing that month's copy); `{ saved, fileId, name, url }`, `saved: false` without object storage |
| `POST monthly/ack` | `{ month }` once the report on the 1st is sent: idempotent |
| `POST ops-alerts/check`, `POST ops-alerts/ack` | server alerts (`osbot/ops_alerts.py`): what started or stopped being wrong since the owner was last told; `{ items: [{ key, event }] }` once sent |

Loops run once a minute, just after the minute turns: heartbeat, reminders,
feedback, payments, weekly (`digest.py`), monthly (`monthly.py`), budget limits (`budget_limits.py`). Each item is sent first and acknowledged after, so a crash can repeat
one message but never lose one. While the heartbeat is fresh, the web app stops
sending its own direct feedback alerts and leaves them to osbot.

Server alerts run every 5 minutes (docs/DEPLOY.md §19): disk, memory, backups,
certificates, containers, a pending reboot, ops-agent. The web app keeps their
state, so each problem is sent once (🔴, with ↗ Open Ops) and its recovery
once (✅); kinds and a mute are set in Ops → Server. When the app itself
doesn't answer two checks in a row, the bot says so on its own.

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
