-- Module: now (the public /now page). Apply after the migration that creates
-- now_settings and adds goals_goals.show_on_now (drizzle schema in
-- src/db/schema/now.ts and src/db/schema/goals.ts).
--
-- What visitors can reach, and how:
--   * now_settings: the site owner's row is public (intro, location, which
--     sections show). Every column of it is meant for the page.
--   * goals: still no public read policy on goals_goals. app.now_goals()
--     returns only the site owner's goals marked show_on_now, of the owner's
--     current year, not dropped, while the page's goals section is on; and only
--     title, measure and progress counts (never "why", never task titles).
--   * habits: app.now_habits() returns one aggregate row (how many habits,
--     how many are daily, the longest current streak) while the owner has
--     switched that section on; never names, days or anything per habit.

-- ---------------------------------------------------------------------------
-- now_settings
-- ---------------------------------------------------------------------------
create trigger now_settings_set_updated_at
  before update on public.now_settings
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.now_settings enable row level security;
--> statement-breakpoint

create policy "now settings: read own" on public.now_settings for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "now settings: read the site owner's" on public.now_settings for select to os_app
  using (owner_id = app.site_owner_id());
--> statement-breakpoint
create policy "now settings: insert own" on public.now_settings for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "now settings: update own" on public.now_settings for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "now settings: delete own" on public.now_settings for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.now_settings to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- app.now_goals(): this year's goals the owner put on /now, with progress
-- ---------------------------------------------------------------------------
-- "This year" is the owner's calendar year (auth.user.timezone). Progress for a
-- goal without a target counts its tasks (linked directly or through a linked
-- project) exactly like the private goals list; only the counts leave.
create function app.now_goals()
returns table (
  id uuid,
  title text,
  target_value double precision,
  target_unit text,
  current_value double precision,
  status text,
  tasks_done integer,
  tasks_total integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with site as (
    select u.id as owner_id,
           extract(year from now() at time zone coalesce(nullif(u.timezone, ''), 'Europe/Prague'))::int as year
      from auth."user" u
     where u.id = app.site_owner_id()
  ),
  counted as (
    select g.*,
           (select count(*)::int from public.tasks_tasks t
             where t.owner_id = g.owner_id
               and (t.id in (select x.task_id from public.goals_links x where x.goal_id = g.id and x.task_id is not null)
                 or t.project_id in (select x.project_id from public.goals_links x where x.goal_id = g.id and x.project_id is not null))
           ) as total,
           (select count(*)::int from public.tasks_tasks t
             where t.owner_id = g.owner_id and t.done_at is not null
               and (t.id in (select x.task_id from public.goals_links x where x.goal_id = g.id and x.task_id is not null)
                 or t.project_id in (select x.project_id from public.goals_links x where x.goal_id = g.id and x.project_id is not null))
           ) as done
      from site s
      join public.goals_goals g on g.owner_id = s.owner_id and g.year = s.year
     where g.show_on_now
       and g.status <> 'dropped'
       and coalesce((select n.show_goals from public.now_settings n where n.owner_id = s.owner_id), true)
  )
  select c.id, c.title, c.target_value, c.target_unit, c.current_value, c.status, c.done, c.total, c.updated_at
    from counted c
   order by array_position(array['active', 'done'], c.status), c.sort_order, c.created_at
   limit 12
$$;
--> statement-breakpoint
revoke execute on function app.now_goals() from public;
--> statement-breakpoint
grant execute on function app.now_goals() to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- app.now_habits(): one aggregate line, only while the owner switched it on
-- ---------------------------------------------------------------------------
-- Streaks follow src/modules/habits/lib/streak.ts (currentStreak): only
-- scheduled weekdays count (weekdays: bit 0 = Monday … bit 6 = Sunday), today
-- never breaks a streak, at most 2000 days back. No row while the section is
-- off or there is no site owner.
create function app.now_habits()
returns table (habits integer, daily integer, longest_streak integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner text := app.site_owner_id();
  v_today date;
  v_habit record;
  v_done date[];
  v_day date;
  v_streak integer;
  v_count integer := 0;
  v_daily integer := 0;
  v_best integer := 0;
begin
  if v_owner is null then
    return;
  end if;
  if not coalesce((select n.show_habits from public.now_settings n where n.owner_id = v_owner), false) then
    return;
  end if;
  select (now() at time zone coalesce(nullif(u.timezone, ''), 'Europe/Prague'))::date
    into v_today
    from auth."user" u
   where u.id = v_owner;

  for v_habit in
    select h.id, h.weekdays from public.habits_habits h where h.owner_id = v_owner and h.archived_at is null
  loop
    v_count := v_count + 1;
    if v_habit.weekdays = 127 then
      v_daily := v_daily + 1;
    end if;
    select coalesce(array_agg(c.day), '{}')
      into v_done
      from public.habits_checks c
     where c.habit_id = v_habit.id and c.owner_id = v_owner and c.day between v_today - 2000 and v_today;
    v_streak := 0;
    v_day := v_today;
    for i in 0..2000 loop
      if (v_habit.weekdays >> (extract(isodow from v_day)::int - 1)) & 1 = 1 then
        if v_day = any(v_done) then
          v_streak := v_streak + 1;
        elsif v_day <> v_today then
          exit;
        end if;
      end if;
      v_day := v_day - 1;
    end loop;
    v_best := greatest(v_best, v_streak);
  end loop;

  return query select v_count, v_daily, v_best;
end;
$$;
--> statement-breakpoint
revoke execute on function app.now_habits() from public;
--> statement-breakpoint
grant execute on function app.now_habits() to os_app;
