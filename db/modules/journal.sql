-- Module: journal. Triggers, row-level security, grants and the search index
-- for journal_entries and journal_settings (drizzle schema in
-- src/db/schema/journal.ts). Apply after the migration that creates those
-- tables. Everything is private: the owner's rows only.

-- ---------------------------------------------------------------------------
-- journal_entries
-- ---------------------------------------------------------------------------
create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.journal_entries enable row level security;
--> statement-breakpoint

create policy "journal: read own" on public.journal_entries for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "journal: insert own" on public.journal_entries for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "journal: update own" on public.journal_entries for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "journal: delete own" on public.journal_entries for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.journal_entries to os_app;
--> statement-breakpoint

-- Global search (⌘K) matches the line with `ilike '%query%'`, like the other
-- modules' providers (0031_search_trgm_indexes.sql).
create extension if not exists pg_trgm;
--> statement-breakpoint
create index if not exists journal_entries_text_trgm_idx on public.journal_entries using gin (text gin_trgm_ops);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- journal_settings (one row per owner)
-- ---------------------------------------------------------------------------
create trigger journal_settings_set_updated_at
  before update on public.journal_settings
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.journal_settings enable row level security;
--> statement-breakpoint

create policy "journal settings: read own" on public.journal_settings for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "journal settings: insert own" on public.journal_settings for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "journal settings: update own" on public.journal_settings for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update on public.journal_settings to os_app;
