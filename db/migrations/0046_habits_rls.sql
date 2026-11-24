-- Module: habits. Triggers, row-level security and grants for habits_habits,
-- habits_checks and habits_settings (drizzle schema in src/db/schema/habits.ts).
-- Apply after the migration that creates those tables. Everything is private:
-- the owner's rows only. A check can only point at the owner's own habit: its
-- foreign key includes owner_id.

-- ---------------------------------------------------------------------------
-- habits_habits
-- ---------------------------------------------------------------------------
create trigger habits_habits_set_updated_at
  before update on public.habits_habits
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.habits_habits enable row level security;
--> statement-breakpoint

create policy "habits: read own" on public.habits_habits for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "habits: insert own" on public.habits_habits for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "habits: update own" on public.habits_habits for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "habits: delete own" on public.habits_habits for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.habits_habits to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- habits_checks (insert / delete only: a check is there or it isn't)
-- ---------------------------------------------------------------------------
alter table public.habits_checks enable row level security;
--> statement-breakpoint

create policy "habit checks: read own" on public.habits_checks for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "habit checks: insert own" on public.habits_checks for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "habit checks: delete own" on public.habits_checks for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, delete on public.habits_checks to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- habits_settings (one row per owner)
-- ---------------------------------------------------------------------------
create trigger habits_settings_set_updated_at
  before update on public.habits_settings
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.habits_settings enable row level security;
--> statement-breakpoint

create policy "habit settings: read own" on public.habits_settings for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "habit settings: insert own" on public.habits_settings for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "habit settings: update own" on public.habits_settings for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update on public.habits_settings to os_app;
