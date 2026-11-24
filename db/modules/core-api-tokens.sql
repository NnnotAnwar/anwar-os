-- Core: personal API tokens (src/db/schema/api-tokens.ts). Trigger, row-level
-- security, grants and the lookup function. Apply after the migration that
-- creates public.core_api_tokens. Conventions: docs/ARCHITECTURE.md §6; the
-- whole model: docs/API.md.
--
-- A request authenticated by a token runs as its owner through withViewer()
-- (src/db/index.ts), which also sets app.api_token_id for the transaction (and
-- transaction_read_only for read-only tokens). The policies below refuse every
-- statement on this table while app.api_token_id is set: a token can never
-- list, mint or revoke tokens, not even its own.

-- The token this transaction acts through; null for a signed-in session.
create function app.current_api_token_id() returns uuid
language sql stable
set search_path = ''
as $$ select nullif(current_setting('app.api_token_id', true), '')::uuid $$;
--> statement-breakpoint

grant execute on function app.current_api_token_id() to os_app;
--> statement-breakpoint

create trigger core_api_tokens_set_updated_at
  before update on public.core_api_tokens
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.core_api_tokens enable row level security;
--> statement-breakpoint

create policy "api tokens: read own, not via a token" on public.core_api_tokens for select to os_app
  using (owner_id = app.current_user_id() and app.current_api_token_id() is null);
--> statement-breakpoint
create policy "api tokens: create own, not via a token" on public.core_api_tokens for insert to os_app
  with check (owner_id = app.current_user_id() and app.current_api_token_id() is null);
--> statement-breakpoint
create policy "api tokens: update own, not via a token" on public.core_api_tokens for update to os_app
  using (owner_id = app.current_user_id() and app.current_api_token_id() is null)
  with check (owner_id = app.current_user_id() and app.current_api_token_id() is null);
--> statement-breakpoint

-- Column grants: the app never reads a hash back, and after creation it can
-- only rename or revoke (no un-revoking: revoked_at is set, never cleared,
-- enforced by the trigger below). No DELETE: revoked rows stay as a record and
-- go away with the user (cascade).
grant select (id, owner_id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_at, updated_at)
  on public.core_api_tokens to os_app;
--> statement-breakpoint
grant insert (name, prefix, token_hash, scopes, expires_at) on public.core_api_tokens to os_app;
--> statement-breakpoint
grant update (name, revoked_at) on public.core_api_tokens to os_app;
--> statement-breakpoint

create function app.core_api_tokens_keep_revoked() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked token stays revoked' using errcode = '22023';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

revoke execute on function app.core_api_tokens_keep_revoked() from public;
--> statement-breakpoint

create trigger core_api_tokens_keep_revoked
  before update on public.core_api_tokens
  for each row execute function app.core_api_tokens_keep_revoked();
--> statement-breakpoint

-- Bearer lookup. Runs before there is a viewer, so it is security definer (the
-- migration role) and does the whole check itself: the row with this prefix
-- and hash, not revoked, not expired. Marks it used (at most once a minute, to
-- keep writes down) and returns who it acts for and what it may do. No match
-- of any kind returns no row, so callers can't tell which check failed.
create function app.authenticate_api_token(p_prefix text, p_hash text)
returns table (token_id uuid, user_id text, scopes text[], expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.core_api_tokens%rowtype;
begin
  if p_prefix is null or p_prefix !~ '^aos_[A-Za-z0-9]{8}$' or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select * into v_token
    from public.core_api_tokens t
   where t.prefix = p_prefix
     and t.token_hash = p_hash
     and t.revoked_at is null
     and (t.expires_at is null or t.expires_at > now());
  if not found then
    return;
  end if;

  update public.core_api_tokens t
     set last_used_at = now()
   where t.id = v_token.id
     and (t.last_used_at is null or t.last_used_at < now() - interval '1 minute');

  token_id := v_token.id;
  user_id := v_token.owner_id;
  scopes := v_token.scopes;
  expires_at := v_token.expires_at;
  return next;
end;
$$;
--> statement-breakpoint

revoke execute on function app.authenticate_api_token(text, text) from public;
--> statement-breakpoint
grant execute on function app.authenticate_api_token(text, text) to os_app;
