-- Module: files. Triggers, row-level security and grants for the tables in
-- src/db/schema/files.ts. Apply after the migration that creates those tables.
-- Conventions: docs/ARCHITECTURE.md §6.

-- ---------------------------------------------------------------------------
-- files_folders
-- ---------------------------------------------------------------------------
create trigger files_folders_set_updated_at
  before update on public.files_folders
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.files_folders enable row level security;
--> statement-breakpoint

create policy "files folders: read own" on public.files_folders for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files folders: insert own" on public.files_folders for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files folders: update own" on public.files_folders for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files folders: delete own" on public.files_folders for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.files_folders to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- files_files
-- ---------------------------------------------------------------------------
create trigger files_files_set_updated_at
  before update on public.files_files
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.files_files enable row level security;
--> statement-breakpoint

create policy "files: read own" on public.files_files for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files: insert own" on public.files_files for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files: update own" on public.files_files for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files: delete own" on public.files_files for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.files_files to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- files_documents
-- ---------------------------------------------------------------------------
create trigger files_documents_set_updated_at
  before update on public.files_documents
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.files_documents enable row level security;
--> statement-breakpoint

create policy "files documents: read own" on public.files_documents for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files documents: insert own" on public.files_documents for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files documents: update own" on public.files_documents for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "files documents: delete own" on public.files_documents for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.files_documents to os_app;

--> statement-breakpoint
-- Module: calendar. Triggers, row-level security, grants and the ICS feed
-- lookup for the tables in src/db/schema/calendar.ts. Apply after the
-- migration that creates those tables. Conventions: docs/ARCHITECTURE.md §6.

-- ---------------------------------------------------------------------------
-- calendar_events
-- ---------------------------------------------------------------------------
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.calendar_events enable row level security;
--> statement-breakpoint

create policy "calendar events: read own" on public.calendar_events for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar events: insert own" on public.calendar_events for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar events: update own" on public.calendar_events for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar events: delete own" on public.calendar_events for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.calendar_events to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- calendar_reminders
-- ---------------------------------------------------------------------------
create trigger calendar_reminders_set_updated_at
  before update on public.calendar_reminders
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.calendar_reminders enable row level security;
--> statement-breakpoint

create policy "calendar reminders: read own" on public.calendar_reminders for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar reminders: insert own" on public.calendar_reminders for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar reminders: update own" on public.calendar_reminders for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar reminders: delete own" on public.calendar_reminders for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.calendar_reminders to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- calendar_feed_tokens
-- ---------------------------------------------------------------------------
create trigger calendar_feed_tokens_set_updated_at
  before update on public.calendar_feed_tokens
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.calendar_feed_tokens enable row level security;
--> statement-breakpoint

create policy "calendar feed tokens: read own" on public.calendar_feed_tokens for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar feed tokens: insert own" on public.calendar_feed_tokens for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar feed tokens: update own" on public.calendar_feed_tokens for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar feed tokens: delete own" on public.calendar_feed_tokens for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.calendar_feed_tokens to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ICS feed: subscribed calendar apps have no session, so there is no viewer to
-- satisfy RLS. This definer function maps a token's selector to its owner and
-- token; the app compares the full token in constant time, then reads the
-- events as that owner through the normal RLS path (withViewer).
-- ---------------------------------------------------------------------------
create function app.calendar_feed_lookup(p_selector text)
returns table (owner_id text, token text)
language sql stable
security definer
set search_path = ''
as $$
  select t.owner_id, t.token
  from public.calendar_feed_tokens t
  where t.selector = p_selector
$$;
--> statement-breakpoint

revoke execute on function app.calendar_feed_lookup(text) from public;
--> statement-breakpoint
grant execute on function app.calendar_feed_lookup(text) to os_app;
