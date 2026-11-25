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
| `/habits` | today's habits as buttons (`✅ 🧘 Stretch · 🔥 4` / `⬜ Read`): a tap ticks one off or back and the card redraws with the new streaks; ↗ Open in app, 🔄 Refresh. Buttons carry their day, so an old card changes its own day |
| habit reminders | at a habit's own reminder time, if it isn't done yet: `⏰ Time for 🧘 Stretch` with a tick button; the evening nudge (off unless switched on in Habits) lists what's still open. Once a day each; nothing when all is done (`habits.py`) |
| `/brief` | the morning brief on demand (below), with ↗ Today and 🔄 Refresh |
| morning brief | at the time set in Settings → Telegram (default 08:00 the owner's time, on by default), once a day: today's calendar (time · title · place), tasks due today numbered like /today (a number opens the same task card) and the overdue count, today's habits as tick buttons (a tick redraws the brief), spending this month against the Budget limits (what's left, categories at ≥ 90 %) or the plan, payments charging today; "🌤 Nothing planned — a clear day" when empty. Skipped when the bot is more than 3 hours late, so it never arrives at lunch (`brief.py`) |
| `/journal` | "🌙 How was today?" with 😞 🙁 😐 🙂 😄; a face saves the mood and a ForceReply prompt asks for one line (⏭ Skip); the saved line comes back with ↩ Undo and ↗ Open. Undo is kept in memory: after a restart the button says so |
| evening question | the same card at the time set in Journal (default 21:30, on by default), once a day, only while the day has no mood; skipped more than 3 hours late. A window past midnight still asks about the day it started on (`journal.py`) |
| document expiry | at 10:00 on each reminder day of a document (Documents; default 90, 30, 7 days before and on the day): `🪪 Residence permit expires in 30 days · 24 Dec 2026`, one card per document, with ↗ Open, ✓ Renewed (opens the app with the new expiry date ready) and 💤 Remind tomorrow (kept by the web app); once more the day after it expires. A day missed while the bot was down is sent late, once; a stage a later one replaced is dropped (`documents.py`) |
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
| `GET habits?date=` | the day's habits (default today) for the `/habits` card: `{ date, label, habits: [{ id, name, emoji, done, current }], done, total, url }` |
| `POST habits/toggle` | `{ id, date? }`: flips one habit for that day, returns `toggled` plus the day's card |
| `GET habits/nudges`, `POST habits/nudges/ack` | habit reminders and the evening nudge due now; `{ date, reminders: [ids], evening }` once sent |
| `GET brief` | today's morning brief, with `delivered` |
| `GET brief/due` | `{ due, date, time, brief }`: the brief only when it should go out now (switched on, within 3 h of its time in the owner's zone, not sent that day) |
| `POST brief/ack` | `{ date }` (brief/due's `date`) once sent: idempotent |
| `GET journal?date=` | the question card for a day (default today): `{ date, today, label, short, entry: { mood, text } \| null, url }` |
| `POST journal/save` | `{ date, mood?, text? }`: a face (`null` clears it) and/or the line; a field left out keeps its value; returns the card and `previous` (Undo writes it back) |
| `GET journal/due`, `POST journal/ack` | the evening question when due (`{ due, date, time, card }`; not once the day has a mood); `{ date }` once sent |
| `GET documents/reminders/due` | expiry reminder cards due now (10:00 owner time), not sent yet: `{ items: [{ id, name, emoji, kindLabel, dateLabel, daysLeft, stage, late, dueLabel, snoozed, keys, url, renewUrl }] }` |
| `POST documents/reminders/ack` | `{ keys }` (`<document id>:<expires on>:<90…0 \| expired \| snooze-<date>>`) once sent: idempotent |
| `POST documents/snooze` | `{ id }`: one more card tomorrow at 10:00; `{ snoozedUntil, label, time }` |
| `POST ops-alerts/check`, `POST ops-alerts/ack` | server alerts (`osbot/ops_alerts.py`): what started or stopped being wrong since the owner was last told; `{ items: [{ key, event }] }` once sent |

Loops run once a minute, just after the minute turns: heartbeat, reminders,
feedback, payments, weekly (`digest.py`), monthly (`monthly.py`), budget limits (`budget_limits.py`), habits (`habits.py`), documents (`documents.py`), the morning brief (`brief.py`) and the journal question (`journal.py`). For the brief and the journal question the web app decides when they are due, in the owner's time zone (`src/modules/osbot/lib/schedule.ts`: from their time until 3 hours later, measured in real time across DST changes). Each item is sent first and acknowledged after, so a crash can repeat
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
