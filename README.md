# anwar.os

Anwar's personal operating system and public portfolio: one place for his notes,
dates, documents, budget and apps, plus a public site where visitors can try his
products on mock data.

Built with Next.js 16 (App Router, Cache Components), PostgreSQL 17 with
row-level security (Drizzle ORM), Better Auth, and Tailwind CSS 4 with shadcn/ui.
Self-hosted on a Hetzner server (Docker Compose + Caddy); see [docs/DEPLOY.md](docs/DEPLOY.md).

**Status:** phases 0–1 done (module system, Notes, own Postgres + Better Auth with
optional TOTP two-factor). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and
roadmap.

## What's inside

- **Public zone** (`/`): placeholder landing for now; About, Projects and Links come in phase 1.
- **Private zone** (`/app`), owner only:
  - **Today**: the date in your timezone, a ruler of the year's ISO weeks, and module widgets.
  - **Notes**: autosaving editor, pinning, filter, global search.
  - **⌘K palette**: jump anywhere, search every module, create, switch theme.
- **Modules** live in `src/modules/<id>/` and plug in through one manifest file.
  Adding one is a folder, a migration and one line in `src/modules/_registry.ts`.

## Local setup

Requirements: Node 24+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env.local         # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm db:up                         # Postgres 17 on localhost:55432
pnpm db:migrate                    # apply db/migrations
pnpm owner:create you@example.com  # sign-ups are disabled; this creates the owner
pnpm dev                           # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` | Next.js dev server / production build |
| `pnpm lint` / `pnpm typecheck` | ESLint / route types + `tsc` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:db` | Row-level security tests against the local Postgres |
| `pnpm db:up` / `pnpm db:down` | Start / stop the local Postgres container |
| `pnpm db:generate` | Generate a migration from `src/db/schema` (`--custom` for SQL like RLS) |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm owner:create <email>` | Create or promote the owner account |

## Security model

- The app connects to Postgres as `os_app`, which is not a superuser and cannot
  bypass row-level security. Every query runs in a transaction that sets
  `app.user_id`; policies only show and accept the viewer's own rows.
- Every module table has `owner_id` and RLS; `db/tests/rls.test.ts` tries to break it.
- Public sign-up is disabled, `os_app` can't insert users or change roles (column
  grants). The owner is created with `pnpm owner:create` using the migration role.
- Sessions are httpOnly cookies validated against the database on every request;
  optional TOTP two-factor with backup codes.
