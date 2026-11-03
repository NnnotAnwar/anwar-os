# anwarnnnot — Architecture

Anwar's personal operating system and public portfolio: one place for his data,
tools and apps, plus a public showcase where visitors can try his products on mock data.

_Status: design draft · 2026-10-30 · nothing built yet._

---

## 1. Principles

1. **Modules, not features.** Every capability (notes, budget, links…) is a module
   with one folder, one manifest and its own tables. The core never reaches into a
   module's internals; it only reads what the manifest declares.
2. **Multi-user from row one.** Every table has `owner_id` and RLS. The owner, a
   demo visitor and a future registered user all go through the same code path;
   only their role and data differ.
3. **Actions are the API.** Every write or query a module offers is a typed
   *action* (a zod schema plus a handler). The UI, server actions, quick-capture,
   the AI assistant and the MCP server all call the same actions, so later
   features become wiring rather than rewrites.
4. **Boring, managed infra.** Next.js on Vercel, Postgres/Auth/Storage on Supabase,
   with no extra services until one is clearly needed.
5. **Don't absorb mature apps.** Apps with their own users and lifecycle (Shift
   Planner) stay separate and integrate through narrow contracts (§8).

---

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router, latest stable), TypeScript strict, React Server Components |
| UI | Tailwind CSS v4 + shadcn/ui, lucide icons, ⌘K command palette (`cmdk`) |
| Data | Supabase Postgres + RLS, `@supabase/ssr` for cookie-based auth |
| Validation | zod (shared by actions, forms, AI tools and MCP tools) |
| Client state | Server Components first; TanStack Query only where live client state is needed |
| Tests | Vitest (units, action handlers), Playwright (zones, auth, demo flow), pgTAP for RLS |
| Tooling | pnpm, ESLint, Prettier, GitHub Actions CI |
| Hosting | Vercel (preview per PR), Supabase cloud (one prod project; local Docker for dev) |

Development starts **local-first**: `supabase start` plus migrations in the repo, with a
cloud project linked only when the first deploy happens.

---

## 3. Zones and routing

```
src/app/
  (public)/                 ← visitors, statically rendered where possible
    page.tsx                  /             landing
    about/                    /about
    projects/[slug]/          /projects     showcase + case studies
    publications/             /publications
    links/                    /links
    demo/                     /demo         "try it" hub → starts a demo session
  (private)/app/            ← requires a session (owner, demo or future user)
    layout.tsx                shell: sidebar from module registry, ⌘K, capture
    page.tsx                  /app          dashboard (widgets from modules)
    inbox/                    /app/inbox
    search/                   /app/search
    [module]/...              /app/notes, /app/budget, …
  api/
    mcp/                      MCP endpoint (phase 4)
    calendar/[token].ics      private ICS feed (phase 2)
  login/
proxy.ts (middleware)       ← refreshes the Supabase session; gates /app/*
```

- Public pages pull portfolio content from **MDX files in the repo** (`content/`):
  versioned, no CMS, reviewable in PRs. Projects can link to a live demo.
- `/app` shows a persistent **demo banner** whenever the session is a demo user.

---

## 4. Auth and roles

`profiles.role` ∈ `owner | demo | user`.

| Role | Created by | Can do |
|---|---|---|
| `owner` | seeded once (Anwar's account) | everything, all modules |
| `demo` | Supabase **anonymous sign-in** from `/demo` | modules flagged `demoable`, own sandbox only |
| `user` | public sign-up (future, disabled now) | modules flagged `public` |

- Email sign-up stays **disabled** in Supabase config. Owner signs in with email and
  password plus TOTP MFA (Supabase supports it natively).
- Anonymous sign-ins are protected with **Cloudflare Turnstile** (built into Supabase Auth)
  and rate limits.
- Authorization lives in RLS. Role checks in the UI only hide things; they are never
  the only guard.

---

## 5. Module system

```
src/modules/
  notes/
    manifest.ts        ← the only file the core imports
    actions.ts         ← typed actions (zod in → result out)
    queries.ts         ← server-side reads
    components/        ← module UI
    routes/            ← page components mounted under /app/notes
    widgets/           ← dashboard widgets
    search.ts          ← how rows become search documents
    demo-seed.ts       ← mock data for demo sessions
  budget/ …
  _registry.ts         ← import { notes } from './notes/manifest'; export const modules = [...]
supabase/migrations/   ← one migration set per module, filenames prefixed by module
```

```ts
// src/core/module.ts (implemented fields; capture/calendar/demoSeed come later)
export type ModuleManifest = {
  id: string                           // also the table prefix and route segment
  name: string
  description: string
  icon: LucideIcon
  nav: NavItem[]                       // sidebar, mobile tabs, ⌘K "Go to"
  access: { demoable: boolean; public: boolean }
  create?: { label; href }             // header "+" button and ⌘K "Create"
  widgets?: WidgetDef[]                // Today tiles; lazy async Server Components
  search?: () => Promise<SearchProvider>             // ⌘K global search
  actions?: () => Promise<Record<string, ActionDef>> // zod input + handler + LLM description
  // later: capture?: CaptureTarget; calendar?: CalendarSource; demoSeed?: (userId) => Promise<void>
}
```

Everything server-side (`widgets`, `search`, `actions`) is loaded lazily, so the
registry can be imported by client code without pulling in database calls.

Adding a module means creating a folder, writing a migration and adding one line to
`_registry.ts`. Sidebar, dashboard, search, capture, calendar, demo, AI and MCP all
pick it up from the manifest.

**Action descriptions are written for an LLM from day one.** They become tool
descriptions in phase 4 at no extra cost.

---

## 6. Data model

### Conventions (every module table)

```sql
id          uuid primary key default gen_random_uuid(),
owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
created_at  timestamptz not null default now(),
updated_at  timestamptz not null default now()   -- trigger-maintained
-- RLS: enable; policy for all using (owner_id = (select auth.uid()))
--      with check (owner_id = (select auth.uid()));
-- index on (owner_id, …) for every list query
```

- Tables live in `public`, prefixed by module (`notes_notes`, `budget_transactions`).
  Per-module Postgres schemas look tidy, but each one has to be exposed to the API
  separately, so prefixes are simpler.
- Deleting a user cascades. That single fact makes demo cleanup and future GDPR
  deletion trivial.
- Types are generated (`supabase gen types`) into `src/core/db.types.ts`.

### Core tables

| Table | Purpose |
|---|---|
| `profiles` | role, display name, locale, base currency, timezone |
| `inbox_items` | quick capture: raw text/URL/file, `status` (new/processed/archived), `processed_into` (module + id) |
| `search_documents` | one row per searchable entity: `module`, `entity_id`, `title`, `body`, `tsv tsvector`, later `embedding vector` |
| `tags`, `entity_tags` | cross-module tagging |
| `files` | Supabase Storage objects (private bucket, path prefixed by `owner_id`) |
| `calendar_tokens` | secret tokens for the private ICS feed |
| `integrations` | external connections (Google Calendar, Shift Planner), encrypted tokens via Supabase Vault |

### First-party modules

| Module | Tables (sketch) |
|---|---|
| **notes** | `notes_notes` (title, markdown body, pinned) |
| **links** | `links_links` (url, title, description, favicon, is_public). Public ones also feed `/links` |
| **dates** | `dates_events` (title, date, recurrence rule, remind_before) for birthdays, deadlines, renewals |
| **docs** | `docs_documents` (title, file_id, kind, expires_on) for passport, contracts, insurance |
| **budget** | see below |

**Budget**

- `budget_accounts`: name, type (cash/bank/savings/investment), currency
- `budget_categories`: name, kind (income/expense), parent_id
- `budget_transactions`: account_id, category_id, `amount_minor bigint`, currency, occurred_on, note
- `budget_recurring`: template plus rrule (salary, rent, subscriptions) that generates transactions
- `budget_goals`: savings goals (target, deadline, linked account)
- `budget_plans`: capital-growth plan (starting capital, monthly contribution, expected return,
  horizon). Projections are **computed, not stored**, and compared against actual
  balances month by month.

Money is always integer minor units plus an ISO currency (CZK by default). Never floats.

### Search

Each module's `search.ts` maps rows to `search_documents`. A DB trigger per module
table keeps them in sync, so search never touches module tables. Phase 1 uses Postgres
full-text search (`websearch_to_tsquery`, `simple` config because the content mixes
EN/CS/RU). Phase 4 adds a `pgvector` embedding column to the same table for semantic
search and AI retrieval.

---

## 7. Demo mode

1. A visitor clicks **Try it** on `/demo` or a project page, and Turnstile runs.
2. `signInAnonymously()` creates a real `auth.users` row, and a trigger creates a
   `profiles` row with `role = 'demo'`.
3. A server action runs `demoSeed(userId)` for every `demoable` module, inserting
   realistic mock data owned by that user.
4. The visitor lands in `/app` with the demo banner and full read/write on their
   sandbox. RLS isolates them from everyone else automatically.
5. A `pg_cron` job deletes demo users older than 24 h, and cascades remove their data.

No separate demo code path or "fake" UI is needed, and nothing has to be rebuilt when
real sign-up opens: `user` is just another role.

---

## 8. Shift Planner integration

`planuj-smeny-app` (v1.9, Vite + React + Capacitor, its own Supabase project with
46 migrations, org/role multi-tenancy, push notifications, native iOS/Android builds)
is a **team product with its own users**. Folding it into this Next.js app would mean
porting the routing, Capacitor shell and native builds, and merging two auth systems,
all for no user-visible gain. It **stays a separate repo, deployment and database**.

Integration happens in levels:

| Level | What | How |
|---|---|---|
| L1 Launcher | Tile in `/app` sidebar + case study on `/projects/shift-planner` | Link to its deployed URL. Done in phase 1. |
| L2 Widget | "Next shift / hours this month" card on the OS dashboard; shifts appear in the OS calendar | A **read-only RPC** in the planner DB (`get_my_shift_summary()`), called server-side from this app with a per-user token stored in `integrations` (Vault). This app never gets planner write access. |
| L3 Demo | Visitors try the planner | A seeded **demo org** on the planner's own deployment with a public demo login, reset nightly by its own cron. The portfolio links to it. |
| L4 (optional) Shared sign-in | One login for both | Only if it starts to hurt. Supabase third-party auth or OAuth between projects. Not planned. |

The OS treats external apps as **external modules**: a manifest with `kind: 'external'`,
nav and widgets, plus an adapter instead of local tables. Future standalone apps
plug in the same way.

---

## 9. Cross-cutting features

- **Quick capture.** A global shortcut (`c`) and a ⌘K "Capture…" command write to
  `inbox_items`. In the inbox, one click turns an item into a note, link, date or
  transaction through that module's `capture` handler. Later inputs: PWA share target,
  a Telegram bot (reusing `py-telegram`) and an MCP tool. All of them write to the same table.
- **Global search.** ⌘K queries `search_documents`, ranked and grouped by module.
- **Calendar sync.**
  - *Out* (phase 2): a private ICS feed `/api/calendar/<token>.ics` aggregates every
    module's `calendar` source (dates, recurring payments, shifts). Any calendar app
    can subscribe. One-way and simple, with no OAuth.
  - *In* (phase 3): Google Calendar read sync via OAuth into `integrations`, shown on
    the dashboard agenda.
- **Dashboard.** A grid of module widgets with layout stored per user in `profiles`.

---

## 10. Long-term (2–3 years)

| Capability | Design hook already in place |
|---|---|
| **AI assistant** ("how much did I spend on food in Sept?", "when does my passport expire?") | Claude API with tool use, where tools = module actions with read scopes. Retrieval via `search_documents` + pgvector. Lives at `/app/assistant`, server-side only. |
| **Own MCP server** (Claude reads and updates the app) | `/api/mcp` (Streamable HTTP) exposes module actions as MCP tools. Auth via OAuth: Supabase can act as the OAuth authorization server, so Claude connects as the owner and RLS still applies. Write tools are opt-in per module. |
| **PWA** | Web manifest + service worker (Serwist), offline shell, share target → inbox, web push for date reminders. Responsive layout is required from phase 1 so this is additive. |
| **Public sign-up** | Enable sign-up, add onboarding that picks `public` modules, and add billing/limits if needed. Schema and RLS already support it. |

---

## 11. Repository layout

```
anwarnnnot/
  content/                 MDX: about, projects, publications
  docs/                    this file, ADRs (docs/adr/NNN-*.md)
  public/
  src/
    app/                   routes (§3)
    core/                  module contract, registry helpers, auth, supabase clients, db types
    modules/               one folder per module (§5)
    components/ui/         shadcn components
    lib/                   generic utilities (money, dates, rrule)
  supabase/
    config.toml
    migrations/            core_*.sql, notes_*.sql, budget_*.sql …
    seed.sql               local dev data (owner account + sample content)
    tests/                 pgTAP RLS tests
  e2e/                     Playwright
```

Conventions: server actions call module actions. Module actions use the request-scoped
Supabase client (never the service role) so RLS is always on. The service role is used
only by cron/admin code in `src/core/admin/`.

---

## 12. Roadmap

| Phase | Scope | Done when |
|---|---|---|
| **0 Foundation** | Next.js + Tailwind + shadcn scaffold, local Supabase, core migrations (`profiles`, roles, RLS conventions), owner login + MFA, `/app` shell driven by the module registry, CI, Vercel preview | Owner can log in; a stub module appears in nav via its manifest; RLS tests pass |
| **1 Public + first modules** | Landing/About/Projects/Links from MDX; **notes**, **links**, **dates** modules; inbox + ⌘K search; Shift Planner L1 tile | Site is live on a domain; owner uses notes/links/dates daily |
| **2 Budget + demo** | **budget** module (accounts, transactions, categories, recurring, goals, growth plan); demo mode (anonymous + seed + cleanup); ICS feed; **docs** module | A visitor can try Budget on mock data; demo users are auto-cleaned |
| **3 Integrations** | Shift Planner L2 widget + calendar; Google Calendar import; PWA install + share target | Dashboard shows next shift and today's agenda; app installs on phone |
| **4 AI + MCP** | pgvector embeddings, assistant, `/api/mcp` with OAuth | Claude (desktop/Code) can query and add budget entries via MCP |
| **5 Open up (optional)** | Public sign-up, onboarding, limits | A stranger can use Budget with their own data |

---

## 13. Open decisions

1. **Domain.** Which one, and do public and private share it (`/app`) or use a subdomain (`app.`)? Same domain is the default; it's simpler for auth cookies.
2. **Languages.** Does the public site ship EN only, or EN/CS/RU? This decides whether i18n routing goes in phase 1.
3. **Bank import for budget.** Manual entry plus CSV import first. Czech bank APIs (e.g. Fio has a free token API) are a phase-2+ question.
4. **Old prototypes.** `my-dashboard` (Gemini task manager) and `my-super-app` (Dexie, local-first). Is anything worth porting as modules, or are they retired?
5. **Shift Planner demo login.** Confirm a public demo account on the planner deployment is acceptable (L3).
