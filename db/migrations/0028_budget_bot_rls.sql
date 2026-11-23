-- Budget ← Telegram expense bot (bots/expenses + /api/internal/budget-bot/*).
-- Row-level security and grants for budget_bot_heartbeats (0027). The bot has
-- no database role for this: web writes the row as the site owner
-- (withViewer), so the usual "own rows" policies apply. The new
-- budget_transactions.import_key column is covered by the table's existing
-- policies and grants (0019).

create trigger budget_bot_heartbeats_set_updated_at
  before update on public.budget_bot_heartbeats
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.budget_bot_heartbeats enable row level security;
--> statement-breakpoint

create policy "budget bot heartbeats: read own" on public.budget_bot_heartbeats for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget bot heartbeats: insert own" on public.budget_bot_heartbeats for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "budget bot heartbeats: update own" on public.budget_bot_heartbeats for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

-- No DELETE: the row goes away with the user (cascade).
grant select, insert, update on public.budget_bot_heartbeats to os_app;
--> statement-breakpoint

-- The expense bot no longer writes to its own schema: its registry entry reads
-- the heartbeat above instead of the frozen bot_expenses stats views (which
-- would report it silent forever). The schema and its data stay untouched.
update public.bots_bots set stats_source = 'budget-bot' where stats_source = 'bot_expenses';
