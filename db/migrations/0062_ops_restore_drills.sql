-- Module: ops (restore drills). Trigger, row-level security and grants for
-- ops_restore_drills (src/db/schema/ops.ts). Apply after the migration that
-- creates the table.
--
-- The monthly drill runs in GitHub Actions and reports through the signed
-- /api/ops/restore-drill/report, which acts as the site owner (actAs()), so
-- the usual "own rows" policies apply. The report keeps the newest drills and
-- deletes older ones; nothing else writes here.

create trigger ops_restore_drills_set_updated_at
  before update on public.ops_restore_drills
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.ops_restore_drills enable row level security;
--> statement-breakpoint

create policy "ops restore drills: read own" on public.ops_restore_drills for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "ops restore drills: insert own" on public.ops_restore_drills for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
-- Pruning: only the newest drills are kept.
create policy "ops restore drills: delete own" on public.ops_restore_drills for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

-- No UPDATE: a drill's record is final.
grant select, insert, delete on public.ops_restore_drills to os_app;
