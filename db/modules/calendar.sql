-- Module: calendar. Triggers, row-level security, grants and the ICS feed
-- lookup for the tables in src/db/schema/calendar.ts. Apply after the
-- migration that creates those tables. Conventions: docs/ARCHITECTURE.md §6.

-- ---------------------------------------------------------------------------
-- calendar_events
-- ---------------------------------------------------------------------------
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.calendar_events enable row level security;
--> statement-breakpoint

create policy "calendar events: read own" on public.calendar_events for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar events: insert own" on public.calendar_events for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar events: update own" on public.calendar_events for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar events: delete own" on public.calendar_events for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.calendar_events to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- calendar_reminders
-- ---------------------------------------------------------------------------
create trigger calendar_reminders_set_updated_at
  before update on public.calendar_reminders
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.calendar_reminders enable row level security;
--> statement-breakpoint

create policy "calendar reminders: read own" on public.calendar_reminders for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar reminders: insert own" on public.calendar_reminders for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar reminders: update own" on public.calendar_reminders for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar reminders: delete own" on public.calendar_reminders for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.calendar_reminders to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- calendar_feed_tokens
-- ---------------------------------------------------------------------------
create trigger calendar_feed_tokens_set_updated_at
  before update on public.calendar_feed_tokens
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.calendar_feed_tokens enable row level security;
--> statement-breakpoint

create policy "calendar feed tokens: read own" on public.calendar_feed_tokens for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar feed tokens: insert own" on public.calendar_feed_tokens for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar feed tokens: update own" on public.calendar_feed_tokens for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "calendar feed tokens: delete own" on public.calendar_feed_tokens for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.calendar_feed_tokens to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ICS feed: subscribed calendar apps have no session, so there is no viewer to
-- satisfy RLS. This definer function maps a token's selector to its owner and
-- token; the app compares the full token in constant time, then reads the
-- events as that owner through the normal RLS path (withViewer).
-- ---------------------------------------------------------------------------
create function app.calendar_feed_lookup(p_selector text)
returns table (owner_id text, token text)
language sql stable
security definer
set search_path = ''
as $$
  select t.owner_id, t.token
  from public.calendar_feed_tokens t
  where t.selector = p_selector
$$;
--> statement-breakpoint

revoke execute on function app.calendar_feed_lookup(text) from public;
--> statement-breakpoint
grant execute on function app.calendar_feed_lookup(text) to os_app;
