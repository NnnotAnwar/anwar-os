-- Module: cv. Apply after the drizzle migration that creates the cv_* tables.
-- Owner rows as in notes. Publicly, the site owner's profile is readable while
-- it is published, and each entry is readable while it is visible AND the
-- profile is published: unpublishing the CV hides everything at once.

-- cv_profile
alter table public.cv_profile enable row level security;
--> statement-breakpoint
create trigger cv_profile_set_updated_at
  before update on public.cv_profile
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create policy "cv_profile: read own" on public.cv_profile for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_profile: insert own" on public.cv_profile for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_profile: update own" on public.cv_profile for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_profile: delete own" on public.cv_profile for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_profile: read published" on public.cv_profile for select to os_app
  using (is_public and owner_id = app.site_owner_id());
--> statement-breakpoint
grant select, insert, update, delete on public.cv_profile to os_app;
--> statement-breakpoint
-- cv_experience
alter table public.cv_experience enable row level security;
--> statement-breakpoint
create trigger cv_experience_set_updated_at
  before update on public.cv_experience
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create policy "cv_experience: read own" on public.cv_experience for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_experience: insert own" on public.cv_experience for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_experience: update own" on public.cv_experience for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_experience: delete own" on public.cv_experience for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_experience: read published" on public.cv_experience for select to os_app
  using (
    is_public
    and owner_id = app.site_owner_id()
    and exists (select 1 from public.cv_profile p where p.owner_id = cv_experience.owner_id and p.is_public)
  );
--> statement-breakpoint
grant select, insert, update, delete on public.cv_experience to os_app;
--> statement-breakpoint
-- cv_education
alter table public.cv_education enable row level security;
--> statement-breakpoint
create trigger cv_education_set_updated_at
  before update on public.cv_education
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create policy "cv_education: read own" on public.cv_education for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_education: insert own" on public.cv_education for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_education: update own" on public.cv_education for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_education: delete own" on public.cv_education for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_education: read published" on public.cv_education for select to os_app
  using (
    is_public
    and owner_id = app.site_owner_id()
    and exists (select 1 from public.cv_profile p where p.owner_id = cv_education.owner_id and p.is_public)
  );
--> statement-breakpoint
grant select, insert, update, delete on public.cv_education to os_app;
--> statement-breakpoint
-- cv_skills
alter table public.cv_skills enable row level security;
--> statement-breakpoint
create trigger cv_skills_set_updated_at
  before update on public.cv_skills
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create policy "cv_skills: read own" on public.cv_skills for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_skills: insert own" on public.cv_skills for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_skills: update own" on public.cv_skills for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_skills: delete own" on public.cv_skills for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_skills: read published" on public.cv_skills for select to os_app
  using (
    is_public
    and owner_id = app.site_owner_id()
    and exists (select 1 from public.cv_profile p where p.owner_id = cv_skills.owner_id and p.is_public)
  );
--> statement-breakpoint
grant select, insert, update, delete on public.cv_skills to os_app;
--> statement-breakpoint
-- cv_languages
alter table public.cv_languages enable row level security;
--> statement-breakpoint
create trigger cv_languages_set_updated_at
  before update on public.cv_languages
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create policy "cv_languages: read own" on public.cv_languages for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_languages: insert own" on public.cv_languages for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_languages: update own" on public.cv_languages for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_languages: delete own" on public.cv_languages for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "cv_languages: read published" on public.cv_languages for select to os_app
  using (
    is_public
    and owner_id = app.site_owner_id()
    and exists (select 1 from public.cv_profile p where p.owner_id = cv_languages.owner_id and p.is_public)
  );
--> statement-breakpoint
grant select, insert, update, delete on public.cv_languages to os_app;
