# anwar.os

Anwar's personal operating system and public portfolio: one place for his notes,
dates, documents, budget and apps, plus a public site where visitors can try his
products on mock data.

Built with Next.js 16 (App Router, Cache Components), Supabase (Postgres + Auth +
RLS) and Tailwind CSS 4 with shadcn/ui. Deployed on Vercel.

**Status:** phase 0 done (foundation, owner sign-in with optional TOTP, module
system, Notes). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and
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

Requirements: Node 24+, pnpm 10, Docker (for the local Supabase stack).

```bash
pnpm install
pnpm db:start                      # local Supabase on ports 55321–55329
cp .env.example .env.local         # then fill in the values below
pnpm exec supabase status -o env   # prints API_URL, PUBLISHABLE_KEY, SECRET_KEY
pnpm owner:create you@example.com  # sign-ups are disabled; this creates the owner
pnpm dev                           # http://localhost:3000
```

The local ports are moved off Supabase's defaults so this stack can run next to
other local Supabase projects.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` | Next.js dev server / production build |
| `pnpm lint` / `pnpm typecheck` | ESLint / route types + `tsc` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm db:test` | Row-level security tests (pgTAP) against the local database |
| `pnpm db:reset` | Recreate the local database from migrations |
| `pnpm db:types` | Regenerate `src/core/db.types.ts` from the local schema |
| `pnpm owner:create <email>` | Create or promote the owner account |

## Security model

- Every table has `owner_id` and row-level security; the app always queries as
  the signed-in user, never with the service key.
- Public sign-up is disabled. The owner is created with `pnpm owner:create`,
  and roles can't be changed by users (column-level grants, tested in
  `supabase/tests/rls.test.sql`).
- The secret key is only read by `scripts/create-owner.mts` from `.env.local`.
