-- Module: tasks. Triggers, row-level security and grants for tasks_lists and
-- tasks_tasks (drizzle schema in src/db/schema/tasks.ts). Apply after the
-- migration that creates those tables. Conventions: docs/ARCHITECTURE.md §6.

-- ---------------------------------------------------------------------------
-- tasks_lists
-- ---------------------------------------------------------------------------
create trigger tasks_lists_set_updated_at
  before update on public.tasks_lists
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.tasks_lists enable row level security;
--> statement-breakpoint

create policy "tasks lists: read own" on public.tasks_lists for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "tasks lists: insert own" on public.tasks_lists for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "tasks lists: update own" on public.tasks_lists for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "tasks lists: delete own" on public.tasks_lists for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.tasks_lists to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tasks_tasks
-- ---------------------------------------------------------------------------
create trigger tasks_tasks_set_updated_at
  before update on public.tasks_tasks
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.tasks_tasks enable row level security;
--> statement-breakpoint

-- Foreign keys check existence while bypassing RLS, so a guessed id of someone
-- else's list, project or task would pass them. These checks run under RLS
-- (the subqueries only see the viewer's own rows) and close that gap.
create function app.tasks_refs_are_own(list_id uuid, project_id uuid, spawned_from uuid) returns boolean
language sql stable as $$
  -- Parameters are qualified with the function name: inside the subqueries an
  -- unqualified spawned_from would mean the tasks_tasks column instead.
  select (tasks_refs_are_own.list_id is null or exists (
           select 1 from public.tasks_lists l where l.id = tasks_refs_are_own.list_id))
     and (tasks_refs_are_own.project_id is null or exists (
           select 1 from public.projects_projects p
           where p.id = tasks_refs_are_own.project_id and p.owner_id = app.current_user_id()))
     and (tasks_refs_are_own.spawned_from is null or exists (
           select 1 from public.tasks_tasks t where t.id = tasks_refs_are_own.spawned_from))
$$;
--> statement-breakpoint
revoke execute on function app.tasks_refs_are_own(uuid, uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.tasks_refs_are_own(uuid, uuid, uuid) to os_app;
--> statement-breakpoint

create policy "tasks: read own" on public.tasks_tasks for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "tasks: insert own" on public.tasks_tasks for insert to os_app
  with check (owner_id = app.current_user_id() and app.tasks_refs_are_own(list_id, project_id, spawned_from));
--> statement-breakpoint
create policy "tasks: update own" on public.tasks_tasks for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id() and app.tasks_refs_are_own(list_id, project_id, spawned_from));
--> statement-breakpoint
create policy "tasks: delete own" on public.tasks_tasks for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.tasks_tasks to os_app;

--> statement-breakpoint
-- Module: inbox. Trigger, row-level security and grants for inbox_items
-- (drizzle schema in src/db/schema/inbox.ts). Apply after the migration that
-- creates the table. Conventions: docs/ARCHITECTURE.md §6.

create trigger inbox_items_set_updated_at
  before update on public.inbox_items
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.inbox_items enable row level security;
--> statement-breakpoint

create policy "inbox: read own" on public.inbox_items for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "inbox: insert own" on public.inbox_items for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "inbox: update own" on public.inbox_items for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "inbox: delete own" on public.inbox_items for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.inbox_items to os_app;
