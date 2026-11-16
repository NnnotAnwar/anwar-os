-- Module: links. Trigger, row-level security and grants for links_links.
-- Apply after the migration that creates the table (drizzle schema in
-- src/db/schema/links.ts).

create trigger links_links_set_updated_at
  before update on public.links_links
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.links_links enable row level security;
--> statement-breakpoint

create policy "links: read own" on public.links_links for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
-- Visitors (and anyone else) see only the site owner's published links. Select
-- policies are OR-ed, so private queries also filter on owner_id explicitly.
create policy "links: read published" on public.links_links for select to os_app
  using (is_public and owner_id = app.site_owner_id());
--> statement-breakpoint
create policy "links: insert own" on public.links_links for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "links: update own" on public.links_links for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "links: delete own" on public.links_links for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.links_links to os_app;
