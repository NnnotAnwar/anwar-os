-- Module: inbox. Trigger, row-level security and grants for inbox_items
-- (drizzle schema in src/db/schema/inbox.ts). Apply after the migration that
-- creates the table. Conventions: docs/ARCHITECTURE.md §6.

create trigger inbox_items_set_updated_at
  before update on public.inbox_items
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.inbox_items enable row level security;
--> statement-breakpoint

create policy "inbox: read own" on public.inbox_items for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "inbox: insert own" on public.inbox_items for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "inbox: update own" on public.inbox_items for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "inbox: delete own" on public.inbox_items for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.inbox_items to os_app;
