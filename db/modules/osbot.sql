-- osbot: osbot_deliveries (payment reminders and the weekly review sent, so
-- they go out once). Row-level security and grants for the table in
-- src/db/schema/osbot.ts; apply after the migration that creates it. The bot
-- has no database role: web writes these rows as the site owner (withViewer),
-- so the usual "own rows" policies apply.

alter table public.osbot_deliveries enable row level security;
--> statement-breakpoint

create policy "osbot deliveries: read own" on public.osbot_deliveries for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "osbot deliveries: insert own" on public.osbot_deliveries for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
-- Pruning old rows (the ack endpoints drop anything older than 60 days).
create policy "osbot deliveries: delete own" on public.osbot_deliveries for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

-- Append-only: no UPDATE.
grant select, insert, delete on public.osbot_deliveries to os_app;
