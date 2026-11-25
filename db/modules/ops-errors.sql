-- Module: ops (error log). Trigger, row-level security, grants and the only
-- write path for ops_errors / ops_error_rate (src/db/schema/ops.ts). Apply
-- after the migration that creates both tables and widens the ops alert kinds
-- with 'errors' and 'drill'.
--
-- Errors are captured without a viewer (Next's onRequestError, the bots'
-- internal APIs), so they are written by app.record_error(), a security
-- definer that files them under the site owner. The web app fingerprints and
-- scrubs every error first (src/modules/ops/lib/errors.ts); the function
-- trusts none of it beyond formats and lengths, and keeps a storm from filling
-- the disk: a global budget per minute, at most 1000 groups per owner, and
-- groups unseen for 90 days are deleted.
--
-- The owner reads their groups and may change only how they are handled
-- (resolve, reopen, Telegram alert bookkeeping): column grants, no INSERT or
-- DELETE for os_app.

create trigger ops_errors_set_updated_at
  before update on public.ops_errors
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.ops_errors enable row level security;
--> statement-breakpoint
alter table public.ops_error_rate enable row level security;
--> statement-breakpoint

create policy "ops errors: read own" on public.ops_errors for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops errors: update own" on public.ops_errors for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

grant select on public.ops_errors to os_app;
--> statement-breakpoint
grant update (status, resolved_at, alert_pending, alerted_at) on public.ops_errors to os_app;
--> statement-breakpoint
revoke all on public.ops_error_rate from os_app;
--> statement-breakpoint

-- Records one occurrence of an error group for the site owner and says what
-- happened to it:
--   'new'       first time this fingerprint was seen (Telegram alert pending)
--   'reopened'  it had been resolved and came back (alert pending again)
--   'seen'      an open group got one more occurrence
--   'dropped'   over the global budget (120 a minute), or no site owner yet
-- Text arguments are trimmed to the column limits rather than refused: the
-- error log must never fail because of the error it records. The source,
-- route type and fingerprint must be valid (22023 otherwise).
create function app.record_error(
  p_source text,
  p_fingerprint text,
  p_name text,
  p_message text,
  p_route text,
  p_method text,
  p_route_type text,
  p_render_source text,
  p_digest text,
  p_stack text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_now timestamptz := now();
  v_hour timestamptz := date_trunc('hour', now());
  v_hits integer;
  v_row public.ops_errors%rowtype;
  v_shift integer;
  v_hourly integer[];
  v_name text := left(coalesce(nullif(btrim(p_name), ''), 'Error'), 120);
  v_message text := left(coalesce(p_message, ''), 1000);
  v_route text := left(coalesce(p_route, ''), 300);
  v_method text := left(upper(coalesce(p_method, '')), 10);
  v_route_type text := coalesce(p_route_type, '');
  v_render_source text := left(coalesce(p_render_source, ''), 60);
  v_digest text := left(coalesce(p_digest, ''), 100);
  v_stack text := left(coalesce(p_stack, ''), 6000);
begin
  if p_source is null or p_source not in ('web', 'osbot', 'expense-bot') then
    raise exception 'source must be web, osbot or expense-bot' using errcode = '22023';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{32}$' then
    raise exception 'fingerprint must be 32 lowercase hex characters' using errcode = '22023';
  end if;
  if v_route_type not in ('render', 'route', 'action', 'proxy', 'process', 'bot', '') then
    raise exception 'unknown route type' using errcode = '22023';
  end if;

  v_owner := app.site_owner_id();
  if v_owner is null then
    return 'dropped';
  end if;

  insert into public.ops_error_rate as r (minute, hits)
  values (date_trunc('minute', v_now), 1)
  on conflict (minute) do update set hits = r.hits + 1
  returning hits into v_hits;
  if v_hits = 1 then
    -- Once a minute at most: forget old budgets and old errors.
    delete from public.ops_error_rate where minute < v_now - interval '1 hour';
    delete from public.ops_errors where last_seen < v_now - interval '90 days';
  end if;
  if v_hits > 120 then
    return 'dropped';
  end if;

  select * into v_row from public.ops_errors
   where owner_id = v_owner and fingerprint = p_fingerprint
   for update;

  if not found then
    -- Room for the new group: keep 999 (open ones first, then the most
    -- recently seen); past that, resolved and long-quiet groups go.
    delete from public.ops_errors
     where id in (
       select id from public.ops_errors
        where owner_id = v_owner
        order by (status = 'open') desc, last_seen desc
        offset 999
     );
    insert into public.ops_errors as e (
      owner_id, fingerprint, source, name, message, route, method, route_type,
      render_source, digest, stack, count, hourly, hourly_at, first_seen, last_seen
    ) values (
      v_owner, p_fingerprint, p_source, v_name, v_message, v_route, v_method, v_route_type,
      v_render_source, v_digest, v_stack, 1,
      array_fill(0, array[23]) || 1, v_hour, v_now, v_now
    )
    on conflict (owner_id, fingerprint) do update set
      count = e.count + 1, last_seen = excluded.last_seen
    returning * into v_row;
    -- Lost a race with another first occurrence: counted as seen above.
    return case when v_row.count = 1 then 'new' else 'seen' end;
  end if;

  -- Slide the 24-hour histogram to this hour, then count the occurrence.
  v_shift := floor(extract(epoch from (v_hour - date_trunc('hour', v_row.hourly_at))) / 3600)::integer;
  v_hourly := v_row.hourly;
  if cardinality(v_hourly) <> 24 or v_shift >= 24 or v_shift < 0 then
    v_hourly := array_fill(0, array[24]);
  elsif v_shift > 0 then
    v_hourly := v_hourly[v_shift + 1:24] || array_fill(0, array[v_shift]);
  end if;
  v_hourly[24] := v_hourly[24] + 1;

  update public.ops_errors set
    count = least(count, 2147483646) + 1,
    hourly = v_hourly,
    hourly_at = v_hour,
    last_seen = v_now,
    name = v_name,
    message = v_message,
    -- An occurrence without a route (an unhandled rejection outside a
    -- request) keeps the last known place.
    route = case when v_route <> '' then v_route else route end,
    method = case when v_route <> '' then v_method else method end,
    route_type = case when v_route <> '' then v_route_type else route_type end,
    render_source = case when v_route <> '' then v_render_source else render_source end,
    digest = coalesce(nullif(v_digest, ''), digest),
    stack = coalesce(nullif(v_stack, ''), stack),
    status = 'open',
    resolved_at = null,
    reopened_count = reopened_count + (status = 'resolved')::integer,
    alert_pending = alert_pending or status = 'resolved'
  where id = v_row.id;

  return case when v_row.status = 'resolved' then 'reopened' else 'seen' end;
end;
$$;
--> statement-breakpoint

revoke execute on function app.record_error(text, text, text, text, text, text, text, text, text, text) from public;
--> statement-breakpoint
grant execute on function app.record_error(text, text, text, text, text, text, text, text, text, text) to os_app;
