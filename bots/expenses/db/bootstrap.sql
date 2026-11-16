-- bot_expenses bootstrap: run ONCE per database by the superuser / migrator, with psql.
--
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v bot_password="$BOT_EXPENSES_DB_PASSWORD" -f db/bootstrap.sql
--
-- Safe to re-run: it (re)sets the password, keeps existing objects, and re-applies
-- grants. It creates only the role and the empty schema. Tables and views are
-- created by the bot itself from db/migrations/*.sql at startup.

\set ON_ERROR_STOP on

\if :{?bot_password}
\else
  \echo 'bootstrap.sql: pass the bot password with -v bot_password=...'
  select 1 / 0 as missing_bot_password;
\endif

-- 1. Login role that owns only its own schema. No superuser, no createdb/role,
--    no BYPASSRLS, no inheritance of other roles' rights.
select format(
  'create role bot_expenses login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password %L',
  :'bot_password'
)
where not exists (select 1 from pg_roles where rolname = 'bot_expenses')
\gexec

select format('alter role bot_expenses with login password %L', :'bot_password')
\gexec

select format('grant connect on database %I to bot_expenses', current_database())
\gexec

-- 2. The schema, owned by the bot role. Nobody else gets anything by default.
create schema if not exists bot_expenses authorization bot_expenses;
alter schema bot_expenses owner to bot_expenses;
revoke all on schema bot_expenses from public;

-- The bot must not create objects anywhere else. (PG15+ already revokes CREATE on
-- public from PUBLIC; this keeps older clusters and hand-made grants in line.)
revoke create on schema public from bot_expenses;
alter role bot_expenses set search_path = bot_expenses;

-- 3. Web app (os_app): read-only access to the stats views, nothing else.
--    Guarded: os_app may not exist yet (it is created by the web app's migrations).
--    The bot also re-applies the view grants at every startup
--    (bot_expenses.grant_stats_access()), so the order of setup does not matter as
--    long as this script or the bot runs after os_app exists.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'os_app') then
    execute 'grant usage on schema bot_expenses to os_app';
    if to_regclass('bot_expenses.stats_daily') is not null then
      execute 'grant select on bot_expenses.stats_daily to os_app';
    end if;
    if to_regclass('bot_expenses.stats_overview') is not null then
      execute 'grant select on bot_expenses.stats_overview to os_app';
    end if;
  else
    raise notice 'role os_app does not exist yet; skipping its grants';
  end if;
end
$$;
