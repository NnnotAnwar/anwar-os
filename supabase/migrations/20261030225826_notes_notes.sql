-- Module: notes. Reference implementation of the module-table convention
-- (docs/ARCHITECTURE.md §6): owner_id + RLS + explicit grants + updated_at.

create table public.notes_notes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  body        text not null default '',
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index notes_notes_owner_updated_idx
  on public.notes_notes (owner_id, pinned desc, updated_at desc);

create trigger notes_notes_set_updated_at
  before update on public.notes_notes
  for each row execute function private.set_updated_at();

alter table public.notes_notes enable row level security;

create policy "notes: read own"
  on public.notes_notes for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "notes: insert own"
  on public.notes_notes for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "notes: update own"
  on public.notes_notes for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "notes: delete own"
  on public.notes_notes for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.notes_notes from anon, authenticated;
grant select, insert, update, delete on public.notes_notes to authenticated;
