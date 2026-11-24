-- Budget: monthly category limits (budget_limits) and the osbot delivery kind
-- for their alerts. Apply after the migration that creates budget_limits and
-- widens osbot_deliveries_kind_valid to 'budget-limit'
-- (src/db/schema/budget.ts, src/db/schema/osbot.ts). osbot_deliveries'
-- existing policies and grants (0033) cover the new kind.

create trigger budget_limits_set_updated_at
  before update on public.budget_limits
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- A limit belongs to a top-level expense category (spending rolls
-- subcategories up into their parent). The composite foreign key already pins
-- it to one of the owner's own categories; this checks its shape. Runs as the
-- caller, so RLS applies to the lookup too.
create function app.budget_limits_check_category() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cat record;
begin
  select kind, parent_id into cat from public.budget_categories where id = new.category_id;
  if not found then
    raise exception 'budget limit: unknown category' using errcode = '23503';
  end if;
  if cat.kind <> 'expense' or cat.parent_id is not null then
    raise exception 'budget limit: only a top-level expense category can have a limit' using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger budget_limits_check_category
  before insert or update of category_id on public.budget_limits
  for each row execute function app.budget_limits_check_category();
--> statement-breakpoint

alter table public.budget_limits enable row level security;
--> statement-breakpoint
create policy "budget limits: read own" on public.budget_limits for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget limits: insert own" on public.budget_limits for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget limits: update own" on public.budget_limits for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget limits: delete own" on public.budget_limits for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
grant select, insert, update, delete on public.budget_limits to os_app;
