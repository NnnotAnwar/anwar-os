-- Module: ops. Triggers, row-level security and grants for ops_events
-- (src/db/schema/ops.ts). Apply after the migration that creates the table.
-- The audit trail is append-only for the app: no delete grant, and an update
-- can only finalize a row that is still "pending".

create trigger ops_events_set_updated_at
  before update on public.ops_events
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.ops_events enable row level security;
--> statement-breakpoint

create policy "ops events: read own" on public.ops_events for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops events: insert own" on public.ops_events for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops events: finalize own pending" on public.ops_events for update to os_app
  using (owner_id = app.current_user_id() and result = 'pending')
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert on public.ops_events to os_app;
--> statement-breakpoint
-- Only the outcome columns can change; who/what/when stay as recorded.
grant update (result, error, duration_ms, detail, updated_at) on public.ops_events to os_app;
