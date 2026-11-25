-- osbot: triggers, row-level security and grants for osbot_settings (the
-- morning brief's on/off and time; drizzle schema in src/db/schema/osbot.ts).
-- Apply after the migration that creates the table. The web app reads and
-- writes it as the owner (Settings → Telegram, and osbot's API in actAs).
--
-- The new osbot_deliveries kinds ("brief", "journal") need no SQL here:
-- drizzle-kit generates the drop/add of osbot_deliveries_kind_valid from
-- osbotDeliveryKinds in the schema.

create trigger osbot_settings_set_updated_at
  before update on public.osbot_settings
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.osbot_settings enable row level security;
--> statement-breakpoint

create policy "osbot settings: read own" on public.osbot_settings for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "osbot settings: insert own" on public.osbot_settings for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "osbot settings: update own" on public.osbot_settings for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update on public.osbot_settings to os_app;
