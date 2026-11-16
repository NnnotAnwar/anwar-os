# Conventions

How code in anwar.os is written. Read with [ARCHITECTURE.md](ARCHITECTURE.md).

## Stack facts

- Next.js 16 with **Cache Components**: request data (`cookies()`, `headers()`,
  `searchParams`, `params`, `Date.now()`) must render inside `<Suspense>` or the
  build fails. Read `node_modules/next/dist/docs/` before writing routes.
- Postgres 17 via Drizzle + postgres.js. The app connects as `os_app` (no
  superuser, no BYPASSRLS). Every query on a module table runs through
  `asViewer()` (`src/core/auth.ts`) or `asPublic()` (`src/db/index.ts`).
- Better Auth (email + password, TOTP). DAL: `getViewer()` / `requireViewer()`.
- UI copy is English (sentence case, verbs on buttons). The owner speaks Russian.

## Modules

A module is `src/modules/<id>/` with a `manifest.ts` registered in
`src/modules/_registry.ts` (order = priority). The manifest declares:

| field | used by |
|---|---|
| `nav` | sidebar ("My services" if starred), ⌘K "Go to" |
| `tagline`, `description`, `icon` | the service card on /app/services and Today |
| `create` | header "New" menu, ⌘K, the card's sheet |
| `shortcuts` | options inside the card's sheet (private `/app/…` or public `/…`) |
| `badge` | lazy count on the card ("3 new") |
| `widgets` | Today tiles (lazy async Server Components) |
| `search` | ⌘K global search |
| `actions` | typed operations (zod) — also future AI / MCP tools |

Routes are thin re-export files under `src/app/(private)/app/<id>/` and
`src/app/(public)/<path>/`.

## Database

- Tables: `src/db/schema/<module>.ts`, exported from `src/db/schema/index.ts`.
  Columns: `id uuid`, `owner_id text not null default app.current_user_id()` →
  `auth.user` on delete cascade, `created_at`, `updated_at` + trigger
  `app.set_updated_at()`. Money is integer minor units + ISO currency.
- RLS on every table; policies `to os_app` using `app.current_user_id()`;
  public rows also require `owner_id = app.site_owner_id()`; explicit grants.
- **Parallel branches:** never commit files under `db/migrations/` (the drizzle
  journal conflicts). Put hand-written SQL (RLS, triggers, grants, functions) in
  `db/modules/<module>.sql`, statements split by `--> statement-breakpoint`. The
  integrator generates the table migration and appends the SQL in order.
- RLS tests: `db/tests/<module>.test.ts` (see `db/tests/rls.test.ts`).

## Design: Planuj Glass

Shared with Planuj Směny. Tokens in `src/app/globals.css`.

- Surfaces: cards `glass rounded-xl p-4`; hero cards add
  `[--glass-shadow:var(--shadow-glass-lg)]`; menus/dialogs `glass glass-menu`;
  fields use `bg-field border-field-border` (shadcn Input/Textarea already do).
- One accent: `bg-primary` buttons, `text-text-accent` for eyebrows/links,
  scale `accent-50…950`. Status colours only for states.
- Type: `text-greeting` (page titles), `text-card-title`, `text-heading`,
  `text-body`, `text-body-strong`, `text-meta` (13px secondary line),
  `text-caption`, `text-eyebrow` / `text-micro` (uppercase), `text-metric`.
  Numbers `tabular-nums`. Satoshi (`font-display`) only for titles.
- Radii: cards `rounded-xl`, buttons/fields `rounded-lg`. Never bigger.
- Icons: `@/components/icons` only (Phosphor bold). Add new ones with
  `bold(P.Name)`; never import lucide-react.
- Frequent actions act in one tap with an Undo toast (sonner); confirm dialogs
  only for rare, heavy, irreversible actions.
- `cn()` from `@/lib/utils` (it knows the type styles). Check 375 px (no
  horizontal scroll, 44 px touch targets) and dark mode.

## Motion and interaction

One vocabulary, in `src/components/motion` + "Motion" in `globals.css`:

- Wrap each page's content in `<Page>` (in `page.tsx`, not layouts).
- Links into detail: `transitionTypes={NAV_FORWARD}`; back links:
  `transitionTypes={NAV_BACK}`; sibling sections: `NAV_TAB` (the sidebar and tab
  bar already do this).
- Streamed content: `<Reveal>` around the content, `<SkeletonExit>` around its
  skeleton. Shared elements across screens: `<Morph name="project-123">` on both.
- Pressable cards/tiles: add `press`. A completed or starred item: `animate-pop`.
- Dialogs that act as bottom sheets on phones: add `sheet` (slide up) and a grab
  handle (see `ServiceSheet` in `src/components/services/service-card.tsx`).
- Durations/easings: `--duration-exit/enter/move`, `--ease-out`, `--ease-spring`.
  No bounces on layout, no parallax; `prefers-reduced-motion` disables it all.
- Keyboard: app-wide `g` + letter and `?` live in the shell
  (`keyboard-shortcuts.tsx`); module keys only on their own pages, never when the
  focus is in a field, and listed in the page (a small "Shortcuts" hint).
- Guidance: highlight the one next step (see `GetStarted`), empty states with one
  primary action, hints in `text-caption`. The user should never wonder where to tap.

## Working in parallel (agents)

- Branch from `main` in your own worktree; commit there; never push or merge.
- Shared files: one line per module in `_registry.ts` and `schema/index.ts`,
  append-only in `icons.tsx`. Anything else shared: describe it in your report.
- Local services: your own Postgres container on your own port
  (`-v "$PWD/db/init:/docker-entrypoint-initdb.d:ro" postgres:17-alpine`), your
  own dev server port, and `BETTER_AUTH_URL=http://127.0.0.1:<port>` (serve on
  127.0.0.1) so auth cookies don't collide with other sessions on localhost.
- Browser pane: open your own tab; never navigate a tab you didn't open.
- Before reporting: rebase on `main`; `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm test:db`, `pnpm build` pass.
- Dependencies: pin exact versions published at least two weeks ago.
