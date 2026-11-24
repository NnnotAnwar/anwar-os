-- Module: analytics. Cookie-free page views of the public site. Apply after the
-- drizzle migration that creates analytics_daily and analytics_rate, after
-- notes.sql (published notes) and after app.site_owner_id().
--
-- What is stored: (UTC day, path, referrer host, device class, country) and a
-- counter. Never an IP address, a user agent string, a cookie or any visitor
-- id. The only write path is app.record_page_view() below; os_app can read the
-- owner's own rows and nothing else.

create trigger analytics_daily_set_updated_at
  before update on public.analytics_daily
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.analytics_daily enable row level security;
--> statement-breakpoint
alter table public.analytics_rate enable row level security;
--> statement-breakpoint

create policy "analytics: read own" on public.analytics_daily for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

-- Read only: counters change through app.record_page_view() alone.
grant select on public.analytics_daily to os_app;
--> statement-breakpoint
revoke all on public.analytics_rate from os_app;
--> statement-breakpoint

-- Counts one view of a public page for the site owner. Runs as the function
-- owner (the migration role), so it can write rows os_app can't; it trusts
-- none of its arguments:
--   * path must be a known public route: a section, a tool, or the slug of a
--     project / note the site owner has published right now;
--   * referrer host must look like a hostname (or be empty), device one of
--     three classes, country two capital letters (or empty);
--   * a global budget of 600 views a minute: past it, views are dropped.
-- Returns true when the view was counted, false when it was dropped (unknown
-- slug, no site owner, over budget). Malformed input raises 22023.
create function app.record_page_view(
  p_path text,
  p_referrer_host text,
  p_device text,
  p_country text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_path text := coalesce(p_path, '');
  v_referrer text := lower(btrim(coalesce(p_referrer_host, '')));
  v_country text := btrim(coalesce(p_country, ''));
  v_slug text;
  v_hits integer;
begin
  if char_length(v_path) > 120 or v_path !~ (
    '^/('
      || '|cv|projects|ideas|links|tools|feedback|writing'
      || '|tools/(calories|calculator|statistics|compound)'
      || '|projects/[a-z0-9]+(-[a-z0-9]+)*'
      || '|writing/[a-z0-9]+(-[a-z0-9]+)*'
    || ')$'
  ) then
    raise exception 'path is not a public page' using errcode = '22023';
  end if;
  if v_referrer <> '' and (
    char_length(v_referrer) > 253
    or v_referrer !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ) then
    raise exception 'referrer must be a hostname' using errcode = '22023';
  end if;
  if p_device is null or p_device not in ('desktop', 'mobile', 'tablet') then
    raise exception 'device must be desktop, mobile or tablet' using errcode = '22023';
  end if;
  if v_country <> '' and v_country !~ '^[A-Z]{2}$' then
    raise exception 'country must be an ISO 3166-1 alpha-2 code' using errcode = '22023';
  end if;

  v_owner := app.site_owner_id();
  if v_owner is null then
    return false;
  end if;

  -- Detail pages count only while they exist publicly.
  if v_path like '/projects/%' then
    v_slug := substr(v_path, char_length('/projects/') + 1);
    if not exists (
      select 1 from public.projects_projects
       where owner_id = v_owner and slug = v_slug and is_public
    ) then
      return false;
    end if;
  elsif v_path like '/writing/%' then
    v_slug := substr(v_path, char_length('/writing/') + 1);
    if not exists (
      select 1 from public.notes_notes
       where owner_id = v_owner and slug = v_slug and is_public
    ) then
      return false;
    end if;
  end if;

  insert into public.analytics_rate as r (minute, hits)
  values (date_trunc('minute', now()), 1)
  on conflict (minute) do update set hits = r.hits + 1
  returning hits into v_hits;
  if v_hits = 1 then
    delete from public.analytics_rate where minute < now() - interval '1 hour';
  end if;
  if v_hits > 600 then
    return false;
  end if;

  insert into public.analytics_daily as d (owner_id, day, path, referrer_host, device, country, views)
  values (v_owner, (now() at time zone 'utc')::date, v_path, v_referrer, p_device, v_country, 1)
  on conflict (owner_id, day, path, referrer_host, device, country)
  do update set views = d.views + 1;

  return true;
end;
$$;
--> statement-breakpoint

revoke execute on function app.record_page_view(text, text, text, text) from public;
--> statement-breakpoint
grant execute on function app.record_page_view(text, text, text, text) to os_app;
