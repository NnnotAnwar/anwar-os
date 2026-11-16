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
