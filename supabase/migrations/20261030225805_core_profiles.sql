-- Core: profiles + roles + shared helpers.
-- Conventions for every module table are documented in docs/ARCHITECTURE.md §6.

-- Helpers live in a schema that is NOT exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- updated_at maintenance, reused by every module table.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('owner', 'demo', 'user');

create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  role          public.app_role not null default 'user',
  display_name  text,
  locale        text not null default 'en',
  timezone      text not null default 'Europe/Prague',
  base_currency char(3) not null default 'CZK',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.profiles.role is
  'Authorization role. Never writable by the user: only by the provisioning trigger or service role.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Explicit grants: no anon access; users may only edit their preferences,
-- never `role` (column-level grant), and rows are created by the trigger below.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, locale, timezone, base_currency) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Provisioning: every new auth user gets a profile. Anonymous sign-ins
-- (demo mode, phase 2) become `demo`; everyone else starts as `user`.
-- The owner is promoted explicitly by scripts/create-owner.ts.
-- ---------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    case when new.is_anonymous then 'demo'::public.app_role else 'user'::public.app_role end,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
