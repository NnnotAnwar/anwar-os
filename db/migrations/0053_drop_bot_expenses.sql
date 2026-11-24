-- The expense bot's former schema and login role. The bot has been a Budget
-- front-end since 0027/0028 (it calls web's internal API and never connects to
-- Postgres), and its old rows were copied into Budget once
-- (budget_transactions.import_key = 'bot-expenses:<id>'). Nothing outside the
-- schema depends on it. A fresh database never had either: both steps are no-ops.
drop schema if exists bot_expenses cascade;--> statement-breakpoint
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_expenses') then
    -- Its grants in this database (connect, revoked create on public).
    execute 'drop owned by bot_expenses';
    begin
      drop role bot_expenses;
    exception when dependent_objects_still_exist then
      -- Still holds something in another database of this cluster (a restore
      -- drill's scratch copy, say): keep the role but it can't log in.
      alter role bot_expenses nologin;
      raise notice 'bot_expenses still owns objects elsewhere; left as NOLOGIN';
    end;
  end if;
end $$;
