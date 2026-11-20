-- Module: budget. Triggers, same-owner foreign keys, row-level security and
-- grants for the tables in src/db/schema/budget.ts. Apply after the drizzle
-- migration that creates the budget_* tables. Conventions: docs/ARCHITECTURE.md §6.
--
-- Every row is private to its owner; nothing in budget is public.

-- ---------------------------------------------------------------------------
-- Same-owner references that clear one column on delete. Drizzle can't express
-- `on delete set null (column)`, and the composite key stops a row pointing at
-- another user's category/account/template even by a guessed id.
-- ---------------------------------------------------------------------------
alter table public.budget_categories
  add constraint budget_categories_parent_fk foreign key (owner_id, parent_id)
  references public.budget_categories (owner_id, id) on delete set null (parent_id);
--> statement-breakpoint
alter table public.budget_transactions
  add constraint budget_transactions_category_fk foreign key (owner_id, category_id)
  references public.budget_categories (owner_id, id) on delete set null (category_id);
--> statement-breakpoint
alter table public.budget_transactions
  add constraint budget_transactions_recurring_fk foreign key (owner_id, recurring_id)
  references public.budget_recurring (owner_id, id) on delete set null (recurring_id);
--> statement-breakpoint
alter table public.budget_recurring
  add constraint budget_recurring_category_fk foreign key (owner_id, category_id)
  references public.budget_categories (owner_id, id) on delete set null (category_id);
--> statement-breakpoint
alter table public.budget_goals
  add constraint budget_goals_account_fk foreign key (owner_id, account_id)
  references public.budget_accounts (owner_id, id) on delete set null (account_id);
--> statement-breakpoint
create index budget_categories_parent_idx on public.budget_categories (owner_id, parent_id);
--> statement-breakpoint
create index budget_transactions_recurring_idx on public.budget_transactions (owner_id, recurring_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A transaction or template always carries its account's currency. The app may
-- omit it; this fills it in (the account is read through RLS, so only the
-- viewer's own accounts resolve) and the composite FK then holds it in place.
-- ---------------------------------------------------------------------------
create function app.budget_account_currency() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  account_currency char(3);
begin
  select a.currency into account_currency
  from public.budget_accounts a
  where a.id = new.account_id and a.owner_id = new.owner_id;
  if account_currency is not null then
    new.currency := account_currency;
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger budget_transactions_account_currency
  before insert or update of account_id, currency on public.budget_transactions
  for each row execute function app.budget_account_currency();
--> statement-breakpoint
create trigger budget_recurring_account_currency
  before insert or update of account_id, currency on public.budget_recurring
  for each row execute function app.budget_account_currency();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- updated_at, RLS (own rows only) and grants, table by table.
-- ---------------------------------------------------------------------------
create trigger budget_settings_set_updated_at
  before update on public.budget_settings
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table public.budget_settings enable row level security;
--> statement-breakpoint
create policy "budget settings: read own" on public.budget_settings for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget settings: insert own" on public.budget_settings for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget settings: update own" on public.budget_settings for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget settings: delete own" on public.budget_settings for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
grant select, insert, update, delete on public.budget_settings to os_app;
--> statement-breakpoint

create trigger budget_accounts_set_updated_at
  before update on public.budget_accounts
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table public.budget_accounts enable row level security;
--> statement-breakpoint
create policy "budget accounts: read own" on public.budget_accounts for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget accounts: insert own" on public.budget_accounts for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget accounts: update own" on public.budget_accounts for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget accounts: delete own" on public.budget_accounts for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
grant select, insert, update, delete on public.budget_accounts to os_app;
--> statement-breakpoint

create trigger budget_categories_set_updated_at
  before update on public.budget_categories
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table public.budget_categories enable row level security;
--> statement-breakpoint
create policy "budget categories: read own" on public.budget_categories for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget categories: insert own" on public.budget_categories for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget categories: update own" on public.budget_categories for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget categories: delete own" on public.budget_categories for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
grant select, insert, update, delete on public.budget_categories to os_app;
--> statement-breakpoint

create trigger budget_recurring_set_updated_at
  before update on public.budget_recurring
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table public.budget_recurring enable row level security;
--> statement-breakpoint
create policy "budget recurring: read own" on public.budget_recurring for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget recurring: insert own" on public.budget_recurring for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget recurring: update own" on public.budget_recurring for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget recurring: delete own" on public.budget_recurring for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
grant select, insert, update, delete on public.budget_recurring to os_app;
--> statement-breakpoint

create trigger budget_transactions_set_updated_at
  before update on public.budget_transactions
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table public.budget_transactions enable row level security;
--> statement-breakpoint
create policy "budget transactions: read own" on public.budget_transactions for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget transactions: insert own" on public.budget_transactions for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget transactions: update own" on public.budget_transactions for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget transactions: delete own" on public.budget_transactions for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
grant select, insert, update, delete on public.budget_transactions to os_app;
--> statement-breakpoint

create trigger budget_goals_set_updated_at
  before update on public.budget_goals
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table public.budget_goals enable row level security;
--> statement-breakpoint
create policy "budget goals: read own" on public.budget_goals for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget goals: insert own" on public.budget_goals for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget goals: update own" on public.budget_goals for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget goals: delete own" on public.budget_goals for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
grant select, insert, update, delete on public.budget_goals to os_app;
--> statement-breakpoint

create trigger budget_plans_set_updated_at
  before update on public.budget_plans
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table public.budget_plans enable row level security;
--> statement-breakpoint
create policy "budget plans: read own" on public.budget_plans for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget plans: insert own" on public.budget_plans for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget plans: update own" on public.budget_plans for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget plans: delete own" on public.budget_plans for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
grant select, insert, update, delete on public.budget_plans to os_app;
