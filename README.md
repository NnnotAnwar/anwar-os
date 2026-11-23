<div align="center">

# anwar.os

**A personal operating system and a public portfolio in one self-hosted app.**

Tasks, notes, calendar, budget, files and ideas for me; a CV, projects, tools and a
feedback form for everyone else. Two Telegram bots, an installable PWA and a control
panel for the server it all runs on.

[**anwar-os.com**](https://anwar-os.com) ·
[Architecture](docs/ARCHITECTURE.md) ·
[Deploy guide](docs/DEPLOY.md) ·
[Conventions](docs/CONVENTIONS.md)

[![CI](https://github.com/NnnotAnwar/anwar-os/actions/workflows/ci.yml/badge.svg)](https://github.com/NnnotAnwar/anwar-os/actions/workflows/ci.yml)
[![Deploy](https://github.com/NnnotAnwar/anwar-os/actions/workflows/deploy.yml/badge.svg)](https://github.com/NnnotAnwar/anwar-os/actions/workflows/deploy.yml)
[![Infra](https://github.com/NnnotAnwar/anwar-os/actions/workflows/infra.yml/badge.svg)](https://github.com/NnnotAnwar/anwar-os/actions/workflows/infra.yml)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white)
![Self-hosted](https://img.shields.io/badge/self--hosted-Hetzner-d50c2d?logo=hetzner&logoColor=white)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/site-home-dark.png">
  <img alt="The public home page of anwar-os.com" src="docs/images/site-home-light.png" width="900">
</picture>

</div>

## On the phone

The private app is a PWA built phone-first: a tab bar (Today · Feedback · Calendar ·
More), a grid of services with option sheets, safe areas for the iPhone home screen.

<p align="center">
  <img alt="Today: date, a ruler of the year and the onboarding checklist" src="docs/images/app-today-dark.png" width="260">
  &nbsp;
  <img alt="Services: every module as a card" src="docs/images/app-services.png" width="260">
  &nbsp;
  <img alt="A service sheet with quick actions" src="docs/images/app-sheet.png" width="260">
</p>

## What's inside

**Public site** (`/`): CV, projects with case studies, ideas, saved links, small tools
(calculator, calories, compound interest, statistics) and an anonymous feedback form.
Everything private stays private; what's public is chosen item by item.

**Private app** (`/app`, owner only)

| Module | What it does |
|---|---|
| Today | The day at a glance: calendar, due tasks, reminders and widgets from every module |
| Tasks | Lists, due dates, priorities and repeats, typed in plain words |
| Inbox | Capture now, sort later (also the PWA share target) |
| Notes | Autosaving editor with pinning and search |
| Calendar | Events, recurrence, reminders and an ICS feed |
| Budget | Accounts, categories, plans, goals and recurring payments |
| Files | Knowledge base: folders, uploads to object storage, markdown documents |
| Links, Ideas, Projects, CV | Private by default, publish item by item to the public site |
| Feedback | Complaints and suggestions from the public form, with status |
| Ops | Server control panel: status, logs, restart and deploy of each service |
| Bots | Telegram bot stats and settings |

**Everywhere:** ⌘K palette (jump, search every module, create), light and dark theme,
passkeys and two-factor sign-in, an offline page, and the same UI on desktop and phone.

**Telegram bots** (`bots/`, Python + aiogram)

- **osbot**: forward anything to save it as a task, note, link or idea; `/today`;
  calendar reminders with snooze; new-feedback alerts. Talks to the app only through
  an HMAC-signed internal API.
- **Expense bot**: type `250 coffee`, pick a category, done. Every expense is a Budget
  transaction; day / week / month summaries, history and CSV export.

## Architecture

```mermaid
flowchart LR
  user([Browser / PWA]) -->|HTTPS| caddy
  tg([Telegram]) <--> bots
  subgraph server [Hetzner CAX · Docker Compose]
    caddy[Edge Caddy<br/>TLS for every site] --> web[Next.js 16<br/>web]
    caddy --> spa[Static sites<br/>e.g. Shiftella]
    web --> db[(PostgreSQL 17<br/>row-level security)]
    bots[osbot · expense bot] -->|signed internal API| web
    web -->|signed| ops[ops-agent<br/>Go · Docker socket]
  end
  web -->|presigned URLs| s3[(Object Storage<br/>files + encrypted backups)]
  gh([GitHub Actions]) -->|multi-arch images · deploy over SSH| server
```

- **Security first:** the app connects as `os_app`, which can't bypass RLS; every query
  runs as the viewer and every table is owner-scoped (`db/tests` tries to break it).
  Sign-up is closed; the owner signs in with a password plus TOTP, or a passkey.
  Nonce-based CSP, security headers at the edge, rate limits stored in Postgres.
- **Modules** live in `src/modules/<id>/` and plug in through one manifest: routes,
  widgets, search, quick-create and typed actions (also what the bots call).
- **One server, several projects:** a shared edge Caddy owns 80/443; each project joins
  the `edge` network or ships a static build. Nightly `pg_dump` encrypted with `age`
  goes to object storage; restores are drilled.
- **Deploys:** every push to `main` runs CI (unit, DB/RLS, Playwright, bots, Go), builds
  arm64 + amd64 images to GHCR and deploys by commit sha, with automatic rollback when
  the new release fails its health check.

## Stack

Next.js 16 (App Router, Cache Components, React 19.3) · TypeScript · Tailwind CSS 4 ·
shadcn/ui on Base UI · Phosphor icons · PostgreSQL 17 · Drizzle ORM · Better Auth
(TOTP, passkeys, Google link-only) · Vitest · Playwright · Python 3.12 + aiogram 3 ·
Go 1.25 · Docker Compose · Caddy 2.10 · GitHub Actions · Hetzner Cloud + Object Storage

## Repository

```
src/app/            routes: (public) site, (private)/app, api/internal for the bots
src/modules/        one folder per module (manifest, actions, routes, widgets)
src/core/           auth, module system, signed internal APIs
db/                 migrations, init roles, RLS tests
bots/               osbot and the expense bot (Python)
services/ops-agent/ the control panel's Docker agent (Go, stdlib only)
infra/              compose, edge Caddy, bootstrap, deploy, backups
docs/               architecture, deploy guide, conventions
```

## Local development

Requirements: Node 24+, pnpm 10, Docker. Bots need Python 3.12 and uv; the agent needs Go.

```bash
pnpm install
cp .env.example .env.local         # set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm db:up                         # Postgres 17 on localhost:55432
pnpm db:migrate
pnpm owner:create you@example.com  # sign-up is disabled; this creates the owner
pnpm dev                           # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` | Dev server / production build |
| `pnpm lint` / `pnpm typecheck` | ESLint / route types + `tsc` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:db` | Database, RLS and internal-API tests against local Postgres |
| `pnpm e2e` | Playwright end-to-end suite on a production build |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply migrations |
| `pnpm owner:create <email>` | Create or promote the owner account |

Deploying to a fresh server, step by step: [docs/DEPLOY.md](docs/DEPLOY.md).
