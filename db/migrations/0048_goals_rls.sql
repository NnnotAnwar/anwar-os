-- Module: goals. Triggers, row-level security and grants for goals_goals and
-- goals_links (drizzle schema in src/db/schema/goals.ts). Apply after the
-- migration that creates those tables. Goals are private: there is no public
-- read policy, not even for the site owner's rows.

-- ---------------------------------------------------------------------------
-- goals_goals
-- ---------------------------------------------------------------------------
create trigger goals_goals_set_updated_at
  before update on public.goals_goals
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.goals_goals enable row level security;
--> statement-breakpoint

create policy "goals: read own" on public.goals_goals for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "goals: insert own" on public.goals_goals for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "goals: update own" on public.goals_goals for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "goals: delete own" on public.goals_goals for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.goals_goals to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- goals_links
-- ---------------------------------------------------------------------------
alter table public.goals_links enable row level security;
--> statement-breakpoint

-- Foreign keys check existence while bypassing RLS, so a guessed id of someone
-- else's goal, task or project would pass them. These checks run under RLS and
-- also say "owned by the viewer" (projects have a public-read policy).
create function app.goals_refs_are_own(goal_id uuid, task_id uuid, project_id uuid) returns boolean
language sql stable as $$
  select exists (
           select 1 from public.goals_goals g
           where g.id = goals_refs_are_own.goal_id and g.owner_id = app.current_user_id())
     and (goals_refs_are_own.task_id is null or exists (
           select 1 from public.tasks_tasks t
           where t.id = goals_refs_are_own.task_id and t.owner_id = app.current_user_id()))
     and (goals_refs_are_own.project_id is null or exists (
           select 1 from public.projects_projects p
           where p.id = goals_refs_are_own.project_id and p.owner_id = app.current_user_id()))
$$;
--> statement-breakpoint
revoke execute on function app.goals_refs_are_own(uuid, uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.goals_refs_are_own(uuid, uuid, uuid) to os_app;
--> statement-breakpoint

create policy "goal links: read own" on public.goals_links for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "goal links: insert own" on public.goals_links for insert to os_app
  with check (owner_id = app.current_user_id() and app.goals_refs_are_own(goal_id, task_id, project_id));
--> statement-breakpoint
create policy "goal links: update own" on public.goals_links for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id() and app.goals_refs_are_own(goal_id, task_id, project_id));
--> statement-breakpoint
create policy "goal links: delete own" on public.goals_links for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.goals_links to os_app;
--> statement-breakpoint

-- A repeating task spawns its next occurrence on completion (tasks.complete);
-- the occurrence keeps the goal, so the goal counts every round. Runs as the
-- inserting viewer, under the policies above.
create function app.goals_follow_task_repeat() returns trigger
language plpgsql as $$
begin
  insert into public.goals_links (owner_id, goal_id, task_id)
  select l.owner_id, l.goal_id, new.id
  from public.goals_links l
  where l.task_id = new.spawned_from
  on conflict (task_id) where task_id is not null do nothing;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.goals_follow_task_repeat() from public;
--> statement-breakpoint
grant execute on function app.goals_follow_task_repeat() to os_app;
--> statement-breakpoint

create trigger goals_follow_task_repeat
  after insert on public.tasks_tasks
  for each row when (new.spawned_from is not null)
  execute function app.goals_follow_task_repeat();
