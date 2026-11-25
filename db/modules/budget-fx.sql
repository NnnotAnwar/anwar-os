-- Module: budget (exchange rates from the Czech National Bank). Row-level
-- security, grants and the only write path for budget_fx_rates and
-- budget_fx_days. Apply after the migration that creates both tables
-- (src/db/schema/budget.ts).
--
-- The rates are public data shared by every user, so the tables have no
-- owner_id: os_app may read every row (with or without a viewer: the rates are
-- loaded outside the viewer's transaction) and may not insert, update or delete
-- anything. The web app saves what it fetched from ČNB through the two security
-- definer functions below, which validate every value, never change a
-- published rate (first write wins) and only move a day's fixing while that day
-- is still open (today in Prague or later). A bug or an injected query in the
-- app can't rewrite another user's history this way, and the shared data can't
-- carry anyone's identity.

alter table public.budget_fx_rates enable row level security;
--> statement-breakpoint
alter table public.budget_fx_days enable row level security;
--> statement-breakpoint
create policy "budget fx rates: everyone reads" on public.budget_fx_rates for select to os_app
  using (true);
--> statement-breakpoint
create policy "budget fx days: everyone reads" on public.budget_fx_days for select to os_app
  using (true);
--> statement-breakpoint
grant select on public.budget_fx_rates to os_app;
--> statement-breakpoint
grant select on public.budget_fx_days to os_app;
--> statement-breakpoint

-- Shared argument check: 1 to 300 rows, parallel arrays of the same length,
-- ISO-shaped codes (never CZK, never twice), ČNB's unit sizes and a positive
-- rate. Error code 22023 (invalid parameter value). Not callable by os_app;
-- only the definer functions below use it.
create function app.budget_fx_check_rates(p_currencies text[], p_units integer[], p_rates numeric[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  n integer := coalesce(cardinality(p_currencies), 0);
begin
  if n not between 1 and 300
     or coalesce(cardinality(p_units), -1) <> n
     or coalesce(cardinality(p_rates), -1) <> n then
    raise exception 'rates must be 1 to 300 entries with a code, units and rate each' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_currencies, p_units, p_rates) as x(code, units, rate)
     where code is null or code !~ '^[A-Z]{3}$' or code = 'CZK'
        or units is null or units not in (1, 10, 100, 1000, 10000, 100000, 1000000)
        or rate is null or rate <= 0 or rate >= 1000000000
  ) then
    raise exception 'a rate has a bad code, units or value' using errcode = '22023';
  end if;
  if (select count(distinct code) from unnest(p_currencies) as code) <> n then
    raise exception 'a currency appears twice' using errcode = '22023';
  end if;
end;
$$;
--> statement-breakpoint
revoke execute on function app.budget_fx_check_rates(text[], integer[], numeric[]) from public;
--> statement-breakpoint

-- What ČNB's daily file answered for `p_day`: the fixing of `p_fixing` (the
-- day itself, or the latest fixing before it). Saves the fixing's rates (kept
-- as they are if already known) and points every day from p_fixing to p_day at
-- it: no fixing was published in between. Days before today in Prague, and the
-- fixing's own day, are final; later ones stay open and are re-checked by the
-- app. Returns how many days were recorded or moved.
create function app.budget_fx_save_daily(
  p_day date,
  p_fixing date,
  p_currencies text[],
  p_units integer[],
  p_rates numeric[]
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_days integer;
begin
  if p_day is null or p_fixing is null then
    raise exception 'day and fixing date are required' using errcode = '22023';
  end if;
  if p_day > v_today + 1 then
    raise exception 'can''t record a day after today' using errcode = '22023';
  end if;
  if p_fixing > p_day or p_fixing > v_today or p_fixing < p_day - 31 then
    raise exception 'the fixing must be on or up to 31 days before the day, and not in the future' using errcode = '22023';
  end if;
  perform app.budget_fx_check_rates(p_currencies, p_units, p_rates);

  insert into public.budget_fx_rates (source, valid_on, currency, units, rate)
  select 'daily', p_fixing, x.code, x.units, x.rate
    from unnest(p_currencies, p_units, p_rates) as x(code, units, rate)
  on conflict do nothing;

  insert into public.budget_fx_days (day, fixing_date, final, checked_at)
  select d::date, p_fixing, d::date < v_today or d::date = p_fixing, now()
    from generate_series(p_fixing::timestamp, p_day::timestamp, interval '1 day') as d
  on conflict (day) do update
    set fixing_date = excluded.fixing_date, final = excluded.final, checked_at = excluded.checked_at
    where not public.budget_fx_days.final;
  get diagnostics v_days = row_count;
  return v_days;
end;
$$;
--> statement-breakpoint
revoke execute on function app.budget_fx_save_daily(date, date, text[], integer[], numeric[]) from public;
--> statement-breakpoint
grant execute on function app.budget_fx_save_daily(date, date, text[], integer[], numeric[]) to os_app;
--> statement-breakpoint

-- ČNB's monthly "other currencies" list valid for the month starting on
-- `p_month`, declared on `p_declared` (the last working day of the month
-- before). Rates already known are kept. Returns how many rates were added.
create function app.budget_fx_save_monthly(
  p_month date,
  p_declared date,
  p_currencies text[],
  p_units integer[],
  p_rates numeric[]
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_added integer;
begin
  if p_month is null or p_declared is null or extract(day from p_month) <> 1 then
    raise exception 'month must be the first day of a month' using errcode = '22023';
  end if;
  if p_declared >= p_month or p_declared < p_month - 10 or p_declared > v_today then
    raise exception 'the list must be declared in the last days of the month before' using errcode = '22023';
  end if;
  perform app.budget_fx_check_rates(p_currencies, p_units, p_rates);

  insert into public.budget_fx_rates (source, valid_on, currency, units, rate)
  select 'monthly', p_month, x.code, x.units, x.rate
    from unnest(p_currencies, p_units, p_rates) as x(code, units, rate)
  on conflict do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;
--> statement-breakpoint
revoke execute on function app.budget_fx_save_monthly(date, date, text[], integer[], numeric[]) from public;
--> statement-breakpoint
grant execute on function app.budget_fx_save_monthly(date, date, text[], integer[], numeric[]) to os_app;
