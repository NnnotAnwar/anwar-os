-- Grants for the runtime role and row-level security. os_app never owns
-- objects and has no BYPASSRLS, so these rules are what actually protects data.

-- ---------------------------------------------------------------------------
-- auth: Better Auth reads and writes these on behalf of whoever is signing in,
-- so there is no viewer yet and no RLS. Instead, grants are minimal.
-- ---------------------------------------------------------------------------
alter table auth."user"
  add constraint user_role_valid check (role in ('owner', 'demo', 'user'));
--> statement-breakpoint

grant usage on schema auth to os_app;
--> statement-breakpoint

-- No INSERT on user: sign-ups are disabled; the owner is created by
-- scripts/create-owner.mts with the migration role. Column-level UPDATE keeps
-- `role` out of reach of the app.
grant select on auth."user" to os_app;
--> statement-breakpoint
grant update (name, email, email_verified, image, updated_at, timezone, locale, two_factor_enabled)
  on auth."user" to os_app;
--> statement-breakpoint
grant select, insert, update, delete on auth.session, auth.account, auth.verification, auth.two_factor
  to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- notes_notes
-- ---------------------------------------------------------------------------
create trigger notes_notes_set_updated_at
  before update on public.notes_notes
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.notes_notes enable row level security;
--> statement-breakpoint

create policy "notes: read own" on public.notes_notes for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "notes: insert own" on public.notes_notes for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "notes: update own" on public.notes_notes for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "notes: delete own" on public.notes_notes for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant usage on schema public to os_app;
--> statement-breakpoint
grant select, insert, update, delete on public.notes_notes to os_app;
