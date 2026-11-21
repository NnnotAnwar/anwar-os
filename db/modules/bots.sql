-- Module: bots. Triggers, row-level security and grants for bots_bots
-- (src/db/schema/bots.ts). Apply after the migration that creates the table.
-- The bots' own schemas (bot_expenses, ...) are created by each bot's
-- bootstrap.sql and grant os_app SELECT on their stats views only.

create trigger bots_bots_set_updated_at
  before update on public.bots_bots
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.bots_bots enable row level security;
--> statement-breakpoint

create policy "bots: read own" on public.bots_bots for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "bots: insert own" on public.bots_bots for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "bots: update own" on public.bots_bots for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "bots: delete own" on public.bots_bots for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.bots_bots to os_app;
