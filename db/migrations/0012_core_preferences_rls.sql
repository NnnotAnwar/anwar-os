-- core_preferences: each user reads and writes only their own row.
create trigger core_preferences_set_updated_at
  before update on public.core_preferences
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.core_preferences enable row level security;
--> statement-breakpoint

create policy "preferences: read own" on public.core_preferences for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "preferences: insert own" on public.core_preferences for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "preferences: update own" on public.core_preferences for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

-- No DELETE: the row goes away with the user (cascade).
grant select, insert, update on public.core_preferences to os_app;
