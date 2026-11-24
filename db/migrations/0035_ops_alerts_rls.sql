-- Module: ops (server alerts). Triggers, row-level security and grants for
-- ops_alert_state and ops_alert_settings (src/db/schema/ops.ts). Apply after
-- the migration that creates the tables.
-- osbot has no database role: web writes these rows as the site owner
-- (actAs() in /api/internal/osbot/ops-alerts/*), and the owner edits the
-- settings from Ops → Server, so the usual "own rows" policies apply.

create trigger ops_alert_state_set_updated_at
  before update on public.ops_alert_state
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger ops_alert_settings_set_updated_at
  before update on public.ops_alert_settings
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.ops_alert_state enable row level security;
--> statement-breakpoint
alter table public.ops_alert_settings enable row level security;
--> statement-breakpoint

create policy "ops alert state: read own" on public.ops_alert_state for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops alert state: insert own" on public.ops_alert_state for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops alert state: update own" on public.ops_alert_state for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
-- Resolved problems the owner has been told about are deleted by the check.
create policy "ops alert state: delete own" on public.ops_alert_state for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

create policy "ops alert settings: read own" on public.ops_alert_settings for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops alert settings: insert own" on public.ops_alert_settings for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops alert settings: update own" on public.ops_alert_settings for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.ops_alert_state to os_app;
--> statement-breakpoint
-- No DELETE: the row goes away with the user (cascade).
grant select, insert, update on public.ops_alert_settings to os_app;
