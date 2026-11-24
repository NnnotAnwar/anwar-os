-- Module: ops (files storage check). Trigger, row-level security and grants
-- for ops_files_check (src/db/schema/ops.ts), and the inventory the check
-- compares the bucket with. Apply after the migration that creates the table
-- and widens the ops alert kinds with 'files'.
--
-- The check runs as the site owner (Ops → Server, or osbot through actAs()),
-- so the usual "own rows" policies apply to its result.

create trigger ops_files_check_set_updated_at
  before update on public.ops_files_check
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.ops_files_check enable row level security;
--> statement-breakpoint

create policy "ops files check: read own" on public.ops_files_check for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops files check: insert own" on public.ops_files_check for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops files check: update own" on public.ops_files_check for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

-- No DELETE: the row is replaced by every run and goes away with the user (cascade).
grant select, insert, update on public.ops_files_check to os_app;
--> statement-breakpoint

-- Every uploaded file's object key and size, across all accounts: the bucket
-- is shared, so an object is only orphaned when no account's row points at
-- it. RLS would show the owner only their own rows, hence security definer;
-- it answers the site owner alone, and never a personal API token (tokens
-- can't reach ops). Other accounts' file names stay private: null.
create function app.files_storage_inventory()
returns table (id uuid, owner_id text, name text, storage_key text, size_bytes bigint, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me text := app.current_user_id();
begin
  if v_me is null or v_me is distinct from app.site_owner_id() then
    raise exception 'only the site owner can read the storage inventory' using errcode = '42501';
  end if;
  if app.current_api_token_id() is not null then
    raise exception 'the storage inventory is not available to API tokens' using errcode = '42501';
  end if;
  return query
    select f.id, f.owner_id, case when f.owner_id = v_me then f.name end, f.storage_key, f.size_bytes, f.created_at
    from public.files_files f;
end
$$;
--> statement-breakpoint

revoke execute on function app.files_storage_inventory() from public;
--> statement-breakpoint
grant execute on function app.files_storage_inventory() to os_app;
