// The public /now page: `pnpm test:db`. Same harness as goals.test.ts.
// now_settings: the site owner's row is public, everyone else's is private, and
// only its owner writes it. Goals stay private: the page gets the site owner's
// goals marked show_on_now (this year, not dropped, section on) through
// app.now_goals(), with no "why"; a goal that wasn't switched on never shows.
// Habits come out of app.now_habits() as one aggregate, only while switched on.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const { actAs, loadViewer } = await import("@/core/auth")
const { actions: goalActions } = await import("@/modules/goals/actions")
const { actions: nowActions } = await import("@/modules/now/actions")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-bob-${run}`
let owner = ""
let createdOwner = false
let year = 0
let savedSettings: Record<string, unknown> | undefined

function as<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${viewer ?? ""}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function pgError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    return (e as { code?: string }).code
  }
  return null
}

async function asOwner<T>(fn: () => Promise<T>) {
  const viewer = await loadViewer(owner)
  return actAs(viewer!, fn)
}

beforeAll(async () => {
  const [row] = await admin<{ id: string | null }[]>`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
  const [y] = await admin<{ year: number }[]>`
    select extract(year from now() at time zone coalesce(nullif(timezone, ''), 'Europe/Prague'))::int as year
      from auth."user" where id = ${owner}`
  year = y!.year
  // A real owner's settings survive the run.
  const [existing] = await admin`select * from now_settings where owner_id = ${owner}`
  savedSettings = existing
  await admin`delete from now_settings where owner_id = ${owner}`
})

afterAll(async () => {
  await admin`delete from goals_goals where title like ${`%${run}`}`
  await admin`delete from tasks_tasks where title like ${`%${run}`}`
  await admin`delete from habits_habits where name like ${`%${run}`}`
  await admin`delete from now_settings where owner_id in (${owner}, ${bob})`
  if (savedSettings && !createdOwner) await admin`insert into now_settings ${admin(savedSettings)}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

async function goal(viewer: string, title: string, extra: { year?: number; onNow?: boolean; status?: string; target?: number; current?: number } = {}) {
  const [row] = await as(viewer, (sql) => sql<{ id: string }[]>`
    insert into goals_goals (title, why, year, show_on_now, status, target_value, current_value)
    values (${`${title} ${run}`}, ${`private why ${run}`}, ${extra.year ?? year}, ${extra.onNow ?? false},
            ${extra.status ?? "active"}, ${extra.target ?? null}, ${extra.current ?? 0})
    returning id`)
  return row!.id
}

type NowGoalRow = { id: string; title: string; target_value: number | null; current_value: number; status: string; tasks_done: number; tasks_total: number }

/** What a visitor gets: no viewer at all. */
async function publicGoals() {
  const rows = await as(null, (sql) => sql<NowGoalRow[]>`select * from app.now_goals()`)
  return rows.filter((r) => r.title.endsWith(run))
}

async function setSettings(viewer: string, values: { intro?: string; location?: string; show_goals?: boolean; show_habits?: boolean }) {
  await as(viewer, (sql) => sql`
    insert into now_settings ${sql(values)}
    on conflict (owner_id) do update set ${sql(values)}`)
}

describe("goals on /now", () => {
  it("are off by default: a new goal is never shown until the owner switches it on", async () => {
    const id = await goal(owner, "Untoggled")
    const [row] = await as(owner, (sql) => sql`select show_on_now from goals_goals where id = ${id}`)
    expect(row).toEqual({ show_on_now: false })
    expect((await publicGoals()).map((g) => g.id)).not.toContain(id)
  })

  it("lists only this year's switched-on, not dropped goals of the site owner, without the why", async () => {
    const shown = await goal(owner, "Shown", { onNow: true, target: 20, current: 5 })
    const achieved = await goal(owner, "Achieved", { onNow: true, status: "done" })
    const hidden = await goal(owner, "Hidden")
    const dropped = await goal(owner, "Dropped", { onNow: true, status: "dropped" })
    const lastYear = await goal(owner, "Last year", { onNow: true, year: year - 1 })
    const bobs = await goal(bob, "Bobs", { onNow: true })

    const rows = await publicGoals()
    expect(rows.map((r) => r.id).sort()).toEqual([shown, achieved].sort())
    for (const id of [hidden, dropped, lastYear, bobs]) expect(rows.map((r) => r.id)).not.toContain(id)
    expect(rows.find((r) => r.id === shown)).toMatchObject({ target_value: 20, current_value: 5, status: "active" })
    // Active goals first.
    expect(rows[0]!.id).toBe(shown)
    // Only safe columns leave the function.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["current_value", "id", "status", "target_unit", "target_value", "tasks_done", "tasks_total", "title", "updated_at"].sort(),
      )
      expect(JSON.stringify(row)).not.toContain("private why")
    }
  })

  it("keeps the goals table itself private: no visitor or other user reads a switched-on goal", async () => {
    const id = await goal(owner, "Still private", { onNow: true })
    expect(await as(null, (sql) => sql`select id from goals_goals where id = ${id}`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`select id from goals_goals where id = ${id}`)).toHaveLength(0)
    expect((await as(bob, (sql) => sql`update goals_goals set show_on_now = false where id = ${id}`)).count).toBe(0)
  })

  it("counts linked tasks for a goal without a target, and sends counts only", async () => {
    const id = await goal(owner, "Tasks", { onNow: true })
    for (const done of [true, false, false]) {
      const [t] = await as(owner, (sql) => sql<{ id: string }[]>`
        insert into tasks_tasks (title, done_at) values (${`Task ${run}`}, ${done ? new Date() : null}) returning id`)
      await as(owner, (sql) => sql`insert into goals_links (goal_id, task_id) values (${id}, ${t!.id})`)
    }
    const row = (await publicGoals()).find((r) => r.id === id)
    expect(row).toMatchObject({ tasks_done: 1, tasks_total: 3 })
  })

  it("disappear when the owner switches the section off", async () => {
    await goal(owner, "Section", { onNow: true })
    expect((await publicGoals()).length).toBeGreaterThan(0)
    await setSettings(owner, { show_goals: false })
    expect(await publicGoals()).toEqual([])
    await setSettings(owner, { show_goals: true })
  })

  it("are switched by the goals action, for the owner's own goals only", async () => {
    const id = await goal(owner, "Action")
    await asOwner(() => goalActions.setShowOnNow.handler({ id, value: true }))
    expect((await publicGoals()).map((g) => g.id)).toContain(id)
    const listed = await asOwner(() => goalActions.list.handler({ year, limit: 100 }))
    expect(listed.find((g) => g.id === id)?.showOnNow).toBe(true)
    await asOwner(() => goalActions.setShowOnNow.handler({ id, value: false }))
    expect((await publicGoals()).map((g) => g.id)).not.toContain(id)
  })
})

describe("now_settings", () => {
  it("is saved by its owner and read back through the action", async () => {
    const saved = await asOwner(() =>
      nowActions.save.handler({
        intro: `Shipping things ${run}`,
        location: "Prague, Czech Republic",
        showGoals: true,
        showProjects: true,
        showWriting: false,
        showHabits: false,
      }),
    )
    expect(saved).toMatchObject({ intro: `Shipping things ${run}`, showWriting: false })
    expect(saved.updatedAt).toEqual(expect.any(String))
    expect(await asOwner(() => nowActions.get.handler({}))).toEqual(saved)
  })

  it("shows the site owner's row to visitors, and nobody else's", async () => {
    await setSettings(bob, { intro: `Bob's secret plans ${run}` })
    const visible = await as(null, (sql) => sql<{ owner_id: string }[]>`select owner_id from now_settings`)
    expect(visible.map((r) => r.owner_id)).toEqual([owner])
    // Bob sees his own row and the public one, but his action reads only his.
    const bobView = await asOwnerOf(bob, () => nowActions.get.handler({}))
    expect(bobView.intro).toBe(`Bob's secret plans ${run}`)
  })

  it("can only be written by its owner", async () => {
    expect((await as(bob, (sql) => sql`update now_settings set intro = 'hijacked' where owner_id = ${owner}`)).count).toBe(0)
    expect((await as(null, (sql) => sql`update now_settings set intro = 'hijacked'`)).count).toBe(0)
    expect(await pgError(as(bob, (sql) => sql`insert into now_settings (owner_id, intro) values (${owner}, 'planted')`))).toBe("42501")
    expect(await pgError(as(null, (sql) => sql`insert into now_settings (owner_id) values (${owner})`))).toBe("42501")
    expect((await as(bob, (sql) => sql`delete from now_settings where owner_id = ${owner}`)).count).toBe(0)
  })

  it("refuses an over-long intro or place", async () => {
    expect(await pgError(setSettings(owner, { intro: "x".repeat(601) }))).toBe("23514")
    expect(await pgError(setSettings(owner, { location: "x".repeat(81) }))).toBe("23514")
  })
})

async function asOwnerOf<T>(id: string, fn: () => Promise<T>) {
  const viewer = await loadViewer(id)
  return actAs(viewer!, fn)
}

describe("habits on /now", () => {
  const habitsNow = () =>
    as(null, (sql) => sql<{ habits: number; daily: number; longest_streak: number }[]>`select * from app.now_habits()`)

  it("say nothing until the owner switches them on", async () => {
    await setSettings(owner, { show_habits: false })
    expect(await habitsNow()).toEqual([])
  })

  it("are one aggregate row: how many, how many daily, the longest current streak", async () => {
    await setSettings(owner, { show_habits: true })
    const [before] = await habitsNow()
    const [habit] = await as(owner, (sql) => sql<{ id: string }[]>`
      insert into habits_habits (name, weekdays) values (${`Read ${run}`}, 127) returning id`)
    const [today] = await admin<{ today: string }[]>`
      select (now() at time zone coalesce(nullif(timezone, ''), 'Europe/Prague'))::date::text as today
        from auth."user" where id = ${owner}`
    // Yesterday and the 40 days before it, then a gap: a 41-day streak (today still open).
    await as(owner, (sql) => sql`
      insert into habits_checks (habit_id, day)
      select ${habit!.id}, (${today!.today}::date - g)::date from generate_series(1, 41) g`)
    await as(owner, (sql) => sql`insert into habits_checks (habit_id, day) values (${habit!.id}, ${today!.today}::date - 50)`)

    const [after] = await habitsNow()
    expect(after!.habits).toBe(before!.habits + 1)
    expect(after!.daily).toBe(before!.daily + 1)
    expect(after!.longest_streak).toBeGreaterThanOrEqual(41)
    expect(Object.keys(after!).sort()).toEqual(["daily", "habits", "longest_streak"])
    await setSettings(owner, { show_habits: false })
  })
})
