-- Module: ideas. Apply after the drizzle migration that creates ideas_ideas.
-- Owner rows as in notes, plus a public read of ideas the site owner chose to
-- publish (see app.site_owner_id()).

create trigger ideas_ideas_set_updated_at
  before update on public.ideas_ideas
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.ideas_ideas enable row level security;
--> statement-breakpoint

create policy "ideas: read own" on public.ideas_ideas for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ideas: insert own" on public.ideas_ideas for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ideas: update own" on public.ideas_ideas for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ideas: delete own" on public.ideas_ideas for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

-- Anyone (no viewer needed) may read the site owner's published ideas.
create policy "ideas: read published" on public.ideas_ideas for select to os_app
  using (is_public and owner_id = app.site_owner_id());
--> statement-breakpoint

grant select, insert, update, delete on public.ideas_ideas to os_app;
