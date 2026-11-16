-- 0001_init: tables, stats views and the os_app grant helper.
-- Applied by the bot at startup (expenses_bot/db.py), inside one transaction,
-- connected as the bot_expenses role that owns the schema.
-- Days are counted in Europe/Prague, the owner's timezone.

-- Telegram users the bot has seen.
create table bot_expenses.users (
  telegram_id bigint primary key,
  username    text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index users_last_seen_idx on bot_expenses.users (last_seen);

-- Expenses. Money is integer minor units (haléře, cents) + ISO 4217 currency.
create table bot_expenses.expenses (
  id               bigint generated always as identity primary key,
  telegram_user_id bigint not null references bot_expenses.users (telegram_id),
  amount_minor     bigint not null check (amount_minor > 0),
  currency         text   not null default 'CZK' check (currency ~ '^[A-Z]{3}$'),
  category         text   not null check (length(category) between 1 and 64),
  created_at       timestamptz not null default now(),
  -- Set by one-off imports (e.g. 'sqlite:42') so re-running an import is a no-op.
  external_ref     text unique
);
create index expenses_user_created_idx on bot_expenses.expenses (telegram_user_id, created_at desc);
create index expenses_created_idx on bot_expenses.expenses (created_at);

-- Per-day interaction counter (messages + button taps) for stats_daily.
create table bot_expenses.activity_daily (
  day              date    not null,
  telegram_user_id bigint  not null references bot_expenses.users (telegram_id),
  updates          integer not null default 0 check (updates >= 0),
  primary key (day, telegram_user_id)
);

-- Liveness signal for the ops panel: exactly one row, updated every 60 s.
create table bot_expenses.heartbeat (
  id           smallint primary key default 1 check (id = 1),
  bot_name     text not null,
  version      text,
  started_at   timestamptz not null,
  last_beat_at timestamptz not null
);

-- One row per day with any activity or expenses.
-- amounts_minor: {"CZK": 15050, "EUR": 1000} (sum of amount_minor per currency).
create view bot_expenses.stats_daily as
with expense_days as (
  select (created_at at time zone 'Europe/Prague')::date as day,
         currency,
         count(*)          as n,
         sum(amount_minor) as total_minor
  from bot_expenses.expenses
  group by 1, 2
),
expense_totals as (
  select day,
         sum(n)::integer                         as expenses,
         jsonb_object_agg(currency, total_minor) as amounts_minor
  from expense_days
  group by day
),
activity as (
  select day,
         sum(updates)::integer as messages,
         count(*)::integer     as active_users
  from bot_expenses.activity_daily
  group by day
)
select coalesce(a.day, e.day)                as day,
       coalesce(a.messages, 0)               as messages,
       coalesce(a.active_users, 0)           as active_users,
       coalesce(e.expenses, 0)               as expenses,
       coalesce(e.amounts_minor, '{}'::jsonb) as amounts_minor
from activity a
full join expense_totals e on e.day = a.day;

-- Single-row summary.
create view bot_expenses.stats_overview as
select
  (select count(*) from bot_expenses.users)::integer as total_users,
  (select count(*) from bot_expenses.users
    where last_seen >= now() - interval '7 days')::integer  as active_users_7d,
  (select count(*) from bot_expenses.users
    where last_seen >= now() - interval '30 days')::integer as active_users_30d,
  (select count(*) from bot_expenses.expenses)::bigint      as total_expenses,
  (select coalesce(jsonb_object_agg(currency, total_minor), '{}'::jsonb)
     from (select currency, sum(amount_minor) as total_minor
             from bot_expenses.expenses group by currency) t) as total_amounts_minor,
  (select last_beat_at from bot_expenses.heartbeat where id = 1) as last_heartbeat_at,
  (select version from bot_expenses.heartbeat where id = 1)      as bot_version;

-- Grants read-only access to the stats views (and nothing else) to the web app.
-- Called by the bot after every startup migration run, because os_app may be created
-- after this schema and because re-created views lose their grants.
create function bot_expenses.grant_stats_access() returns boolean
language plpgsql as $$
begin
  if not exists (select 1 from pg_roles where rolname = 'os_app') then
    return false;
  end if;
  execute 'grant usage on schema bot_expenses to os_app';
  execute 'grant select on bot_expenses.stats_daily, bot_expenses.stats_overview to os_app';
  return true;
end
$$;
revoke all on function bot_expenses.grant_stats_access() from public;
