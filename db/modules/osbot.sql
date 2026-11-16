-- Module: osbot (bots/osbot + /api/internal/osbot/*). Triggers, row-level
-- security and grants for the tables in src/db/schema/osbot.ts. Apply after the
-- migration that creates those tables. Conventions: docs/ARCHITECTURE.md §6.
-- The bot has no database role: the web app writes these rows as the site
-- owner (withViewer), so the usual "own rows" policies apply.

-- ---------------------------------------------------------------------------
-- osbot_heartbeats: one row per owner, upserted every minute.
-- ---------------------------------------------------------------------------
create trigger osbot_heartbeats_set_updated_at
  before update on public.osbot_heartbeats
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.osbot_heartbeats enable row level security;
--> statement-breakpoint

create policy "osbot heartbeats: read own" on public.osbot_heartbeats for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "osbot heartbeats: insert own" on public.osbot_heartbeats for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "osbot heartbeats: update own" on public.osbot_heartbeats for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

-- No DELETE: the row goes away with the user (cascade).
grant select, insert, update on public.osbot_heartbeats to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- calendar_reminder_deliveries: append-only log of sent reminders. The
-- composite foreign key already ties each row to an event of the same owner.
-- ---------------------------------------------------------------------------
alter table public.calendar_reminder_deliveries enable row level security;
--> statement-breakpoint

create policy "reminder deliveries: read own" on public.calendar_reminder_deliveries for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "reminder deliveries: insert own" on public.calendar_reminder_deliveries for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
-- Pruning old rows (the ack endpoint drops anything older than 60 days).
create policy "reminder deliveries: delete own" on public.calendar_reminder_deliveries for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, delete on public.calendar_reminder_deliveries to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- osbot_feedback_alerts: feedback the owner was already told about.
-- ---------------------------------------------------------------------------
alter table public.osbot_feedback_alerts enable row level security;
--> statement-breakpoint

create policy "feedback alerts: read own" on public.osbot_feedback_alerts for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
-- Only for feedback addressed to the viewer.
create policy "feedback alerts: insert own" on public.osbot_feedback_alerts for insert to os_app
  with check (
    owner_id = app.current_user_id()
    and exists (
      select 1 from public.feedback_items f
      where f.id = feedback_id and f.owner_id = app.current_user_id()
    )
  );
--> statement-breakpoint

grant select, insert on public.osbot_feedback_alerts to os_app;
