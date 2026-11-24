-- Analytics: count views of the public contact page (/contact), added after
-- 0037. Same function as there, with 'contact' in the allowed paths; grants
-- survive create or replace.
create or replace function app.record_page_view(
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
      || '|cv|projects|ideas|links|tools|feedback|writing|contact'
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
