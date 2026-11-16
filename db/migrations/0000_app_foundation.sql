-- Foundation shared by every module: the per-request viewer identity and
-- the updated_at trigger. Conventions: docs/ARCHITECTURE.md §6.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to os_app;
--> statement-breakpoint

-- The viewer for this transaction, set by withViewer() via
-- set_config('app.user_id', <id>, true). Null when no one is signed in.
create function app.current_user_id() returns text
language sql stable
set search_path = ''
as $$ select nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint

grant execute on function app.current_user_id() to os_app;
--> statement-breakpoint

create function app.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint

revoke execute on function app.set_updated_at() from public;
