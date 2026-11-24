// RLS and actions for goals_goals and goals_links: `pnpm test:db`. Same harness
// as rls.test.ts. Goals are private (no public read at all); a link may only
// join the viewer's own goal to the viewer's own task or project; repeating
// tasks keep their goal; progress counts linked tasks and the tasks of linked
// projects.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const { actAs, loadViewer } = await import("@/core/auth")
const { actions } = await import("@/modules/goals/actions")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-bob-${run}`
let owner = ""
let createdOwner = false

function as<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    if (viewer) await sql`select set_config('app.user_id', ${viewer}, true)`
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
})

afterAll(async () => {
  await admin`delete from goals_goals where title like ${`%${run}`}`
  await admin`delete from tasks_tasks where title like ${`%${run}`}`
  await admin`delete from projects_projects where title like ${`%${run}`}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

async function goal(viewer: string, title: string, extra: { year?: number } = {}) {
  const [row] = await as(viewer, (sql) => sql<{ id: string }[]>`
    insert into goals_goals (title, year) values (${`${title} ${run}`}, ${extra.year ?? 2026}) returning id`)
  return row!.id
}

async function task(viewer: string, title: string, extra: { projectId?: string; spawnedFrom?: string; done?: boolean } = {}) {
  const [row] = await as(viewer, (sql) => sql<{ id: string }[]>`
    insert into tasks_tasks (title, project_id, spawned_from, done_at)
    values (${`${title} ${run}`}, ${extra.projectId ?? null}, ${extra.spawnedFrom ?? null}, ${extra.done ? new Date() : null})
    returning id`)
  return row!.id
}

async function project(viewer: string, title: string, isPublic = false) {
  const [row] = await as(viewer, (sql) => sql<{ id: string }[]>`
    insert into projects_projects (title, slug, is_public)
    values (${`${title} ${run}`}, ${`${title.toLowerCase().replaceAll(" ", "-")}-${run}`}, ${isPublic}) returning id`)
  return row!.id
}

describe("goals_goals", () => {
  it("starts a goal active with nothing done, owned by the viewer", async () => {
    const [row] = await as(owner, (sql) => sql`
      insert into goals_goals (title, year) values (${`Read ${run}`}, 2026)
      returning owner_id, status, current_value, target_value, target_unit`)
    expect(row).toEqual({ owner_id: owner, status: "active", current_value: 0, target_value: null, target_unit: "" })
  })

  it("is private: no other user and no visitor sees or changes it", async () => {
    const id = await goal(owner, "Private")
    expect(await as(null, (sql) => sql`select id from goals_goals where id = ${id}`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`select id from goals_goals where id = ${id}`)).toHaveLength(0)
    const result = await as(bob, async (sql) => ({
      updated: (await sql`update goals_goals set title = 'x' where id = ${id}`).count,
      deleted: (await sql`delete from goals_goals where id = ${id}`).count,
    }))
    expect(result).toEqual({ updated: 0, deleted: 0 })
    expect(await pgError(as(bob, (sql) => sql`insert into goals_goals (owner_id, title, year) values (${owner}, ${`Planted ${run}`}, 2026)`))).toBe(
      "42501",
    )
  })

  it("refuses an impossible target, a negative count or an unknown status", async () => {
    const insert = (cols: string) =>
      pgError(as(owner, (sql) => sql.unsafe(`insert into goals_goals (title, year, ${cols}) values ('Bad ${run}', 2026, $1)`, [-1])))
    expect(await insert("target_value")).toBe("23514")
    expect(await insert("current_value")).toBe("23514")
    expect(await pgError(as(owner, (sql) => sql`insert into goals_goals (title, year, status) values (${`Bad ${run}`}, 2026, 'maybe')`))).toBe(
      "23514",
    )
  })
})

describe("goals_links", () => {
  it("links the owner's own task or project, one goal each", async () => {
    const g1 = await goal(owner, "Ship")
    const g2 = await goal(owner, "Other")
    const t = await task(owner, "Write tests")
    const p = await project(owner, "Shiftella")
    await as(owner, (sql) => sql`insert into goals_links (goal_id, task_id) values (${g1}, ${t})`)
    await as(owner, (sql) => sql`insert into goals_links (goal_id, project_id) values (${g1}, ${p})`)
    expect(await pgError(as(owner, (sql) => sql`insert into goals_links (goal_id, task_id) values (${g2}, ${t})`))).toBe("23505")
    expect(await pgError(as(owner, (sql) => sql`insert into goals_links (goal_id) values (${g2})`))).toBe("23514")
    expect(await pgError(as(owner, (sql) => sql`insert into goals_links (goal_id, task_id, project_id) values (${g2}, ${t}, ${p})`))).toBe(
      "23514",
    )
  })

  it("never joins someone else's goal, task or project, even a published project", async () => {
    const mine = await goal(owner, "Mine")
    const theirs = await goal(bob, "Theirs")
    const ownerTask = await task(owner, "Owner task")
    const bobTask = await task(bob, "Bob task")
    const published = await project(owner, "Published", true)
    // Bob can see the owner's published project, but can't count it towards his goal.
    expect(await as(bob, (sql) => sql`select id from projects_projects where id = ${published}`)).toHaveLength(1)
    expect(await pgError(as(bob, (sql) => sql`insert into goals_links (goal_id, project_id) values (${theirs}, ${published})`))).toBe("42501")
    expect(await pgError(as(bob, (sql) => sql`insert into goals_links (goal_id, task_id) values (${theirs}, ${ownerTask})`))).toBe("42501")
    expect(await pgError(as(owner, (sql) => sql`insert into goals_links (goal_id, task_id) values (${theirs}, ${ownerTask})`))).toBe("42501")
    expect(await pgError(as(owner, (sql) => sql`insert into goals_links (goal_id, task_id) values (${mine}, ${bobTask})`))).toBe("42501")
    // Moving an existing link onto someone else's goal is refused too.
    await as(owner, (sql) => sql`insert into goals_links (goal_id, task_id) values (${mine}, ${ownerTask})`)
    expect(await pgError(as(owner, (sql) => sql`update goals_links set goal_id = ${theirs} where task_id = ${ownerTask}`))).toBe("42501")
    expect(await as(bob, (sql) => sql`select id from goals_links where task_id = ${ownerTask}`)).toHaveLength(0)
  })

  it("keeps the goal when a repeating task spawns its next occurrence", async () => {
    const g = await goal(owner, "Run weekly")
    const first = await task(owner, "Long run", { done: true })
    await as(owner, (sql) => sql`insert into goals_links (goal_id, task_id) values (${g}, ${first})`)
    const next = await task(owner, "Long run next", { spawnedFrom: first })
    const [link] = await as(owner, (sql) => sql`select goal_id from goals_links where task_id = ${next}`)
    expect(link).toEqual({ goal_id: g })
  })

  it("drops a link with its task, and only the links with its goal", async () => {
    const g = await goal(owner, "Temporary")
    const t = await task(owner, "Stays")
    const gone = await task(owner, "Goes")
    await as(owner, (sql) => sql`insert into goals_links (goal_id, task_id) values (${g}, ${t}), (${g}, ${gone})`)
    await as(owner, (sql) => sql`delete from tasks_tasks where id = ${gone}`)
    expect(await as(owner, (sql) => sql`select task_id from goals_links where goal_id = ${g}`)).toEqual([{ task_id: t }])
    await as(owner, (sql) => sql`delete from goals_goals where id = ${g}`)
    expect(await as(owner, (sql) => sql`select id from goals_links where task_id = ${t}`)).toHaveLength(0)
    expect(await as(owner, (sql) => sql`select id from tasks_tasks where id = ${t}`)).toHaveLength(1)
  })
})

describe("goals actions", () => {
  it("measures a goal by its number, or by its tasks and its projects' tasks", async () => {
    const result = await asOwner(async () => {
      const books = await actions.create.handler({ title: `Books ${run}`, year: 2031, why: "", targetValue: 20, targetUnit: "books", currentValue: 0 })
      await actions.logProgress.handler({ id: books.id, by: 3 })
      await actions.logProgress.handler({ id: books.id, by: -5 }) // never below zero
      await actions.logProgress.handler({ id: books.id, by: 4 })

      const ship = await actions.create.handler({ title: `Ship ${run}`, year: 2031, why: "Because", targetValue: null, targetUnit: "", currentValue: 0 })
      const p = await project(owner, "Linked project")
      const direct = await task(owner, "Direct", { done: true })
      await task(owner, "In project", { projectId: p })
      await task(owner, "In project done", { projectId: p, done: true })
      await task(owner, "Unrelated")
      await actions.link.handler({ goalId: ship.id, taskId: direct })
      await actions.link.handler({ goalId: ship.id, projectId: p })

      const list = await actions.list.handler({ year: 2031, limit: 50 })
      const detail = await actions.get.handler({ id: ship.id })
      const linked = await actions.linkedGoal.handler({ projectId: p })
      await actions.link.handler({ goalId: null, projectId: p })
      const afterUnlink = await actions.get.handler({ id: ship.id })
      return { list, detail, linked, afterUnlink, books: books.id, ship: ship.id }
    })

    const byTitle = Object.fromEntries(result.list.map((g) => [g.title, g]))
    expect(byTitle[`Books ${run}`]!.progress).toEqual({ kind: "target", current: 4, target: 20, unit: "books", ratio: 0.2 })
    expect(byTitle[`Ship ${run}`]!.progress).toEqual({ kind: "tasks", done: 2, total: 3, ratio: 2 / 3 })
    expect(byTitle[`Ship ${run}`]!.projectCount).toBe(1)
    expect(result.list.map((g) => g.title)).toEqual([`Books ${run}`, `Ship ${run}`])

    expect(result.detail!.tasks.map((t) => [t.title, t.viaProject !== null, t.doneAt !== null])).toEqual([
      // Open first, then the most recently done.
      [`In project ${run}`, true, false],
      [`In project done ${run}`, true, true],
      [`Direct ${run}`, false, true],
    ])
    expect(result.detail!.projects.map((p) => p.title)).toEqual([`Linked project ${run}`])
    expect(result.linked?.id).toBe(result.ship)
    expect(result.afterUnlink!.progress).toEqual({ kind: "tasks", done: 1, total: 1, ratio: 1 })
  })

  it("orders active goals first and reorders within them", async () => {
    const titles = await asOwner(async () => {
      const ids: string[] = []
      for (const t of ["One", "Two", "Three"]) {
        const { id } = await actions.create.handler({ title: `${t} ${run}`, year: 2032, why: "", targetValue: null, targetUnit: "", currentValue: 0 })
        ids.push(id)
      }
      await actions.setStatus.handler({ id: ids[0]!, status: "done" })
      await actions.reorder.handler({ ids: [ids[2]!, ids[1]!] })
      return (await actions.list.handler({ year: 2032, limit: 50 })).map((g) => `${g.title.split(" ")[0]}:${g.status}`)
    })
    expect(titles).toEqual(["Three:active", "Two:active", "One:done"])
  })

  it("refuses to link the owner's task to someone else's goal", async () => {
    const theirs = await goal(bob, "Bob goal")
    const t = await task(owner, "Mine to keep")
    await expect(asOwner(() => actions.link.handler({ goalId: theirs, taskId: t }))).rejects.toThrow(/isn't yours/)
  })
})
