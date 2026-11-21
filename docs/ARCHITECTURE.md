# anwar.os — Architecture

Anwar's personal operating system and public face: CV, projects, ideas and useful
links for visitors; notes, files, calendar, tools and a control panel for his
Telegram bots and projects for himself. Everything runs on his own Hetzner server
under his own domain.

_v2 · 2026-11-16. Changed from v1: self-hosted on Hetzner with plain Postgres and
Better Auth instead of Supabase + Vercel; new modules (CV, ideas, files, feedback,
calendar, tools, bots, ops control panel); roadmap rewritten._

---

## 1. Principles

1. **Own the stack.** One server, one domain, Docker Compose. No managed platform
   is required to run the site; external services are optional add-ons.
2. **Modules, not features.** Every capability is a folder in `src/modules/<id>`
   with one manifest. The shell (nav, ⌘K, Today widgets, search) reads manifests and
   never reaches into module internals. *(Implemented in phase 0.)*
3. **Multi-user from row one, enforced by Postgres.** Every table has `owner_id` and
   row-level security. The app connects as a role that cannot bypass RLS, so a bug in
   a query can't leak another user's rows.
4. **Actions are the API.** Module operations are typed actions (zod in, result out,
   LLM-readable description). UI, Telegram capture, the AI assistant and MCP all call
   the same actions.
5. **The internet-facing app never holds root.** Container control goes through a
   small internal agent with a whitelist, never by mounting the Docker socket into
   the web app.
6. **Boring and recoverable.** Nightly encrypted backups that are actually restored
   in a test, infrastructure as files in the repo, one command to rebuild the server.

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Web app | Next.js 16 (App Router, Cache Components), TypeScript | unchanged from phase 0 |
| UI | Tailwind 4, shadcn/ui (Base UI), cmdk | design tokens in `globals.css` |
| Database | PostgreSQL 17 (container) | one instance: app schema + one schema per bot |
| Data access | Drizzle ORM + postgres.js | schema in TS; RLS/functions in SQL migrations |
| Auth | Better Auth (email + password, `two-factor`, later `anonymous`) | sessions stored in Postgres |
| Files | S3-compatible: Hetzner Object Storage (prod), MinIO (local) | see open decision 2 |
| Bots | Python 3 + aiogram, one container per bot | read/write their own schema |
| Reverse proxy / TLS | Caddy | automatic Let's Encrypt certificates |
| Container control | `ops-agent` (internal service, §8) | the only thing with the Docker socket |
| CI/CD | GitHub Actions → images in GHCR → deploy on server | |
| Tests | Vitest (unit + RLS integration against real Postgres), Playwright (flows) | pgTAP tests ported to Vitest |

### What changes from phase 0

| Phase 0 (Supabase) | v2 (own Postgres) |
|---|---|
| `@supabase/ssr` clients, `getClaims()` | Better Auth `auth.api.getSession()` in the DAL, cookie check in `proxy.ts` |
| `auth.uid()` in policies | `app.current_user_id()` reading `current_setting('app.user_id')` |
| `auth.users` | Better Auth tables (`user`, `session`, `account`, `two_factor`) |
| Supabase TOTP MFA | Better Auth `two-factor` plugin (TOTP + backup codes) |
| `supabase db reset` / `supabase test db` | `docker compose` Postgres, `drizzle-kit migrate`, Vitest RLS suite |
| Vercel previews | none by default; local compose mirrors prod (open decision 4) |

The module contract, shell, design system and Notes UI stay as they are. Only the
data layer under `actions.ts` and the auth layer change.

---

## 3. Infrastructure

```
                 DNS: anwar.<tld>  A/AAAA → server IP
                                │
┌───────────────────────────── Hetzner VPS (Ubuntu LTS) ─────────────────────────────┐
│  ufw: 22 (keys only), 80, 443        unattended-upgrades        fail2ban            │
│                                                                                     │
│  edge caddy ──► web (Next.js, :3000) ──► postgres (:5432, internal network only)    │
│                  │                         ▲   ▲                                    │
│                  └─(HMAC)─► ops-agent ─────┘   │ docker.sock (agent only)           │
│                                                │                                    │
│  bot-expenses (aiogram) ───────────────────────┘  bot-osbot (alerts, capture) ...   │
│                                                                                     │
│  backup (cron): pg_dump → age-encrypted → off-site (Storage Box / Object Storage)   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Server size:** the stack is light (Next ~300 MB, Postgres ~200 MB, each bot
  ~60 MB, Caddy ~30 MB). A 4 GB ARM or x86 instance is enough; 8 GB gives headroom
  for builds and a second project (memory is capped per service with `mem_limit`).
- **Several projects per server:** ports 80/443 belong to a shared edge stack
  (`infra/edge`, one Caddy). Each project joins the external `edge` network under
  its own alias and drops a site file into `/opt/edge/sites`; static SPAs are
  served from `/srv/sites/<project>` (docs/DEPLOY.md §18).
- **Provisioning as code:** `infra/` holds `compose.prod.yml`, `edge/`, a
  `bootstrap.sh` that hardens a fresh Ubuntu box (user, SSH keys only, ufw,
  unattended upgrades, Docker), and the backup script. Rebuilding the server is
  bootstrap → copy `.env` → `docker compose up -d` → restore last dump.
- **DNS:** apex `anwar.<tld>` for everything (public and `/app` share one origin, so
  auth cookies stay simple). Optional `status.` subdomain later.
- **Secrets:** a root-only `.env` on the server, never in git. CI only gets a
  deploy key scoped to pulling images.
- **Backups:** nightly `pg_dump` + object-storage sync, encrypted with `age`, kept
  7 daily / 4 weekly / 6 monthly. A monthly CI job restores the latest dump into a
  throwaway Postgres and runs the RLS suite against it. Untested backups don't count.
- **Deploys:** push to `main` → Actions builds `ghcr.io/nnnotanwar/anwar-os-web:<sha>`
  → SSH step runs `docker compose pull web && docker compose up -d web` with a
  healthcheck gate. Bots deploy the same way, or from the control panel (§8).

---

## 4. Zones and routes

**Public** (anyone, mostly static):

| Route | Content |
|---|---|
| `/` | landing: who Anwar is, featured projects, latest public ideas |
| `/cv` | résumé from structured data; print stylesheet = clean PDF |
| `/projects`, `/projects/[slug]` | showcase and case studies; links to live demos |
| `/ideas` | ideas he chose to publish, with status |
| `/links` | curated public bookmarks |
| `/tools/*` | calculators: calories, basic, statistics, compound growth |
| `/feedback` | complaints and suggestions to Anwar, anonymous allowed |

**Private** (`/app`, owner only): Today, notes, ideas, links, files, calendar,
feedback inbox, projects, bots, ops, tools with saved results, settings.

---

## 5. Auth

- **Better Auth** with email + password and the `two-factor` plugin (TOTP + backup
  codes). Sessions live in Postgres; cookie is `httpOnly`, `secure`, `sameSite=lax`.
  Config in `src/lib/auth-config.ts`.
- **Passkeys** (`@better-auth/passkey`, table `auth.passkey`): discoverable, user
  verification required, so a passkey sign-in counts as two factors and skips the
  TOTP step. rpID = hostname of `BETTER_AUTH_URL` (never an IP address).
- **Google** (optional, `GOOGLE_CLIENT_*`): link-only. Connected from Settings while
  signed in (verified Google email required); a Google sign-in never creates a user
  or links by email. 2FA is still enforced after it (an after-hook on the OAuth
  callback, since the 2FA plugin only guards password routes). ID-token sign-in is
  closed.
- **Recent sign-in:** adding a passkey or connecting/disconnecting Google needs a
  session younger than one hour (`session.freshAge`); Settings offers "Confirm it's
  you" (sign out and back in).
- **Sign-up disabled.** The owner is created by `pnpm owner:create` (as in phase 0).
  `user.role` ∈ `owner | demo | user`, writable only by the server.
- **Demo mode (later):** Better Auth `anonymous` plugin creates throwaway users with
  role `demo`; a nightly job deletes them and cascades their rows.
- **Checks:** `proxy.ts` does a cheap cookie presence check to redirect `/app` for
  signed-out visitors; the DAL (`requireViewer`) validates the session against the
  database on every request. RLS is the final guard.

---

## 6. Data model and RLS

### Roles and per-request identity

| Postgres role | Used by | Rights |
|---|---|---|
| `os_migrator` | migrations only | owns schemas and tables |
| `os_app` | the web app at runtime | DML on app tables; **no BYPASSRLS** |
| `bot_<name>` | each bot | only its own schema |
| `os_readonly` | backups, stats views | SELECT only |

Every database call from the app runs inside `withViewer(viewerId, tx => …)`, which
opens a transaction and runs `select set_config('app.user_id', $1, true)`. Policies
use `app.current_user_id()`:

```sql
create function app.current_user_id() returns text
language sql stable as $$ select nullif(current_setting('app.user_id', true), '') $$;

create policy "notes: own rows" on notes_notes for all to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
```

Because the setting is transaction-local, a pooled connection can never carry one
viewer's identity into another request.

### Conventions (unchanged)

Every module table has `id`, `owner_id` (FK to `user`, cascade), `created_at`,
`updated_at` (trigger), an `(owner_id, …)` index for list queries, RLS on, and a
module prefix (`notes_*`, `links_*`). Money is integer minor units + ISO currency.

### Public writes

The feedback form is the only anonymous write. It goes through
`app.submit_feedback(...)`, a `security definer` function in a non-exposed schema
that validates lengths, checks the rate-limit table, and inserts with
`owner_id` = the site owner. `os_app` can execute it without a viewer; it cannot
insert into `feedback_items` directly.

### Search

`search_documents` (module, entity id, title, body, `tsvector` with the `simple`
config because content mixes EN/CS/RU) kept in sync by triggers; ⌘K queries it.
`pgvector` embeddings are added to the same table in the AI phase.

---

## 7. Modules

| Module | Zone | What it does | Phase |
|---|---|---|---|
| **notes** | private | autosaving notes, pin, filter, search | ✅ 0 |
| **cv** | public + editor | experience, education, skills, languages as structured rows; `/cv` page, print/PDF | 3 |
| **projects** | public + private | showcase with case studies; private side links each project to its services in ops | 3 |
| **ideas** | private, opt-in public | backlog with status (raw → exploring → building → shipped / dropped), tags, publish toggle | 3 |
| **links** | private, opt-in public | bookmarks with tags; title/description/favicon fetched on save; public ones feed `/links` | 3 |
| **feedback** | public form + private inbox | anonymous complaints/suggestions, optional contact; statuses, reply notes, Telegram alert | 3 |
| **tools** | public + saved results | calories (Mifflin–St Jeor BMR, TDEE, macros), basic calculator, statistics (mean, median, SD, percentiles from pasted numbers), compound growth. Pure client-side math with unit tests | 3 |
| **files** | private | knowledge base: uploads to object storage, folders + tags, markdown documents, previews, full-text search (PDF text extraction later) | 4 |
| **calendar** | private | events with recurrence and reminders, important dates; private ICS feed; Google Calendar import later | 4 |
| **bots** | private | registry of Telegram bots; per-bot stats from each bot's schema (users, messages, domain data such as expenses) | 5 |
| **ops** | private | control panel for every managed service (§8) | 5 |
| **budget** | private | accounts, transactions, goals, capital-growth plan (from v1) | 6 |

Each row is one folder, one manifest line, one migration set. Modules that have a
public side expose public routes from `src/app/(public)/…` as thin re-exports, the
same way private routes do today.

---

## 8. Control panel (ops) and bots

### ops-agent

A small internal HTTP service (one container, ~150 lines of Go or Node) that is
the **only** process with `/var/run/docker.sock`. It is not reachable from the
internet; only `web` can call it, signing each request with an HMAC secret.

| Endpoint | Does |
|---|---|
| `GET /services` | containers labelled `os.managed=true`: state, health, uptime, image tag, restart count |
| `GET /services/:name/logs?tail=200` | last log lines (stdout/stderr) |
| `POST /services/:name/{start,stop,restart}` | lifecycle |
| `POST /services/:name/deploy` `{ tag }` | `docker compose pull` + recreate that one service, waits for healthcheck, rolls back to the previous tag on failure |

Only labelled services can be touched; `db`, the edge `caddy`, `ops-agent` itself and
`web` are excluded from stop and deploy from the UI. Every call is written to
`ops_events` (who, what, when, result) and shown in the panel.

### Panel (in `/app/ops`)

- Service cards: status dot, uptime, last deploy, CPU/RAM.
- Log viewer with follow mode.
- Restart in one tap, start with Undo, stop asks first (then Undo); deploy with Undo to the previous tag.
- Deploy: picks from the latest image tags in GHCR (commit message shown).
- Projects link to their services, so "Planuj Směny" shows its deploy state.

### Bots

- Each bot gets its own repo or `bots/<name>/` folder with a Dockerfile, its own
  Postgres schema and login role, and a `heartbeat` row it updates every minute
  (the panel's "alive" signal for polling bots).
- `py-telegram` (expense bot) is migrated from SQLite to its `bot_expenses` schema
  and containerized in phase 5.
- **osbot** (`bots/osbot/`): Anwar's own bot for the platform. Quick capture
  (forward a message → Inbox by default, or task / note / link / idea), `/today`,
  calendar reminders and feedback alerts (ops alerts later). Unlike the other
  bots it has **no database role**: it calls the web app's internal API
  (`/api/internal/osbot/*`, `src/modules/osbot/`), HMAC-signed with
  `OSBOT_API_SECRET` (timestamp + nonce + method + path + body, 60 s window,
  replay cache), over the internal network only (Caddy returns 404 for it). The
  handlers act as the site owner through `actAs()`, so module actions,
  `runModuleAction()` and RLS work exactly as for a signed-in owner. Only
  `OSBOT_OWNER_CHAT_ID` is served. Its heartbeat goes through the same API
  (`osbot_heartbeats`, shown in Settings → Telegram); while it is fresh, web
  leaves feedback alerts to the bot, otherwise web notifies directly.
- Stats views (`bot_expenses.stats_daily`, …) are granted to `os_app` read-only.

### Planuj Směny

Stays a separate product on its own Supabase project. In ops it appears as an
external service (health URL + Vercel or server deploy state); on Today it gets the
"next shift" widget through its read-only RPC (v1 plan, unchanged).

---

## 9. Long-term

- **AI assistant** over module actions + `search_documents` embeddings (Claude API).
- **MCP server** at `/api/mcp` exposing module actions as tools, OAuth via Better Auth.
- **PWA**: installable (`src/app/manifest.ts`, icons from `pnpm icons`, a small
  hand-written `public/sw.js`: offline page, immutable assets only), share target
  → `/app/capture` (Inbox by default, or Note / Link / Idea). Still to do: push
  for reminders.
- **Public sign-up** for tools/products, using the multi-user schema already in place.

---

## 10. Roadmap

| Phase | Scope | Done when |
|---|---|---|
| **0 Foundation** ✅ | Next.js shell, module system, Notes, design system (on Supabase, local) | done 2026-11-03 |
| **1 Own data layer** | Docker Compose (Postgres + MinIO) for dev; Drizzle schema + SQL migrations with RLS via `app.user_id`; Better Auth (password + TOTP); port Notes actions and the 12 RLS tests; remove Supabase | app behaves exactly as now with no Supabase dependency; RLS suite green in CI |
| **2 Server live** | Order the Hetzner VPS; `infra/bootstrap.sh`; DNS; Caddy + HTTPS; `compose.prod.yml`; CI build → GHCR → deploy; backups + first restore test | `https://anwar.<tld>/app` works with 2FA; a backup has been restored |
| **3 Public face** | cv, projects, ideas, links, feedback (+ osbot alerts), tools; real landing page | a stranger can read the CV, try a calculator and leave feedback that reaches Telegram |
| **4 Knowledge** | files (object storage), calendar + ICS, unified `search_documents` | Anwar keeps documents and dates here instead of elsewhere |
| **5 Control panel** | ops-agent, bots containerized and on Postgres, status/logs/actions/deploy, bot stats | a bot can be redeployed from the phone |
| **6 Budget + demo** | budget module, anonymous demo sessions | visitors can try Budget on mock data |
| **7 AI, MCP, PWA** | §9 | Claude can query and add entries via MCP |

---

## 11. Open decisions

1. **Domain.** Which name (`anwar.<tld>`)? Needed in phase 2.
2. **File storage.** Hetzner Object Storage (separate from the server, survives a
   rebuild; small monthly cost) vs a volume on the server (free, but backups must
   include it). Recommendation: Object Storage.
3. **Spam protection for `/feedback`.** Self-hosted proof-of-work (ALTCHA) + rate
   limits fits "own host"; Cloudflare Turnstile is stronger but third-party.
   Recommendation: ALTCHA + per-IP limits.
4. **Previews.** Without Vercel there are no per-PR previews. Option: a second
   compose project on the same server at `staging.` deployed from a branch.
5. **Server.** Location (Falkenstein/Nuremberg/Helsinki) and ARM vs x86; ARM is
   cheaper per GB, but all images (incl. bots) must build for `arm64`.
