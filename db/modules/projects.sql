-- Module: projects. Apply after the drizzle migration that creates
-- projects_projects. Owner rows as in notes, plus a public read of published
-- rows that belong to the site owner (see app.site_owner_id()).

create trigger projects_projects_set_updated_at
  before update on public.projects_projects
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.projects_projects enable row level security;
--> statement-breakpoint

create policy "projects: read own" on public.projects_projects for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "projects: insert own" on public.projects_projects for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "projects: update own" on public.projects_projects for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "projects: delete own" on public.projects_projects for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

-- Anyone (no viewer needed) may read the site owner's published projects.
create policy "projects: read published" on public.projects_projects for select to os_app
  using (is_public and owner_id = app.site_owner_id());
--> statement-breakpoint

grant select, insert, update, delete on public.projects_projects to os_app;
