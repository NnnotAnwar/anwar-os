// RLS for tasks_lists and tasks_tasks: `pnpm test:db`. Same harness as rls.test.ts.
// Tasks and lists are strictly private, and a task may only point at the
// viewer's own list, project and predecessor.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-alice-${run}`
const bob = `test-bob-${run}`

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

let aliceList = ""
let bobList = ""
let bobProject = ""
let aliceTask = ""

beforeAll(async () => {
  for (const id of [alice, bob]) {
    await admin`
      insert into auth."user" (id, name, email, email_verified)
      values (${id}, ${id}, ${`${id}@test.local`}, true)`
  }
  ;[{ id: aliceList }] = await as(alice, (sql) => sql<{ id: string }[]>`
    insert into tasks_lists (name) values (${`University ${run}`}) returning id`)
  ;[{ id: bobList }] = await as(bob, (sql) => sql<{ id: string }[]>`
    insert into tasks_lists (name) values (${`Bob ${run}`}) returning id`)
  ;[{ id: bobProject }] = await as(bob, (sql) => sql<{ id: string }[]>`
    insert into projects_projects (title, slug) values (${`Bob project ${run}`}, ${`bob-${run}`}) returning id`)
})

afterAll(async () => {
  // Cascades through every row these users own.
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("tasks_tasks", () => {
  it("creates a task for the viewer with sensible defaults", async () => {
    const [task] = await as(alice, (sql) => sql`
      insert into tasks_tasks (title, list_id, due_date) values (${`Call the bank ${run}`}, ${aliceList}, '2026-11-17')
      returning id, owner_id, priority, notes, done_at`)
    expect(task).toMatchObject({ owner_id: alice, priority: "none", notes: "", done_at: null })
    aliceTask = task!.id
  })

  it("hides one user's tasks and lists from another and from anonymous sessions", async () => {
    const bobSees = await as(bob, (sql) => sql`
      select (select count(*)::int from tasks_tasks where owner_id = ${alice}) as tasks,
             (select count(*)::int from tasks_lists where owner_id = ${alice}) as lists`)
    expect(bobSees[0]).toEqual({ tasks: 0, lists: 0 })
    const anon = await as(null, (sql) => sql`select count(*)::int as n from tasks_tasks`)
    expect(anon[0]!.n).toBe(0)
  })

  it("never lets anyone else complete, edit or delete the owner's tasks", async () => {
    const result = await as(bob, async (sql) => {
      const updated = await sql`update tasks_tasks set done_at = now() where id = ${aliceTask}`
      const deleted = await sql`delete from tasks_tasks where id = ${aliceTask}`
      const lists = await sql`delete from tasks_lists where id = ${aliceList}`
      return { updated: updated.count, deleted: deleted.count, lists: lists.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0, lists: 0 })
  })

  it("refuses pointing a task at someone else's list, project or task", async () => {
    expect(
      await pgError(as(alice, (sql) => sql`insert into tasks_tasks (title, list_id) values ('x', ${bobList})`)),
    ).toBe("42501")
    expect(
      await pgError(as(alice, (sql) => sql`insert into tasks_tasks (title, project_id) values ('x', ${bobProject})`)),
    ).toBe("42501")
    expect(
      await pgError(as(bob, (sql) => sql`insert into tasks_tasks (title, spawned_from) values ('x', ${aliceTask})`)),
    ).toBe("42501")
    expect(
      await pgError(as(alice, (sql) => sql`update tasks_tasks set list_id = ${bobList} where id = ${aliceTask}`)),
    ).toBe("42501")
  })

  it("lets the owner spawn the next occurrence of their own repeating task", async () => {
    const [next] = await as(alice, (sql) => sql`
      insert into tasks_tasks (title, due_date, rrule, spawned_from)
      values ('next', '2026-11-18', 'FREQ=DAILY', ${aliceTask}) returning spawned_from`)
    expect(next).toEqual({ spawned_from: aliceTask })
  })

  it("refuses handing a task or list to someone else", async () => {
    expect(
      await pgError(as(alice, (sql) => sql`update tasks_tasks set owner_id = ${bob} where id = ${aliceTask}`)),
    ).toBe("42501")
    expect(
      await pgError(as(alice, (sql) => sql`update tasks_lists set owner_id = ${bob} where id = ${aliceList}`)),
    ).toBe("42501")
  })

  it("refuses anonymous inserts, bad priorities, times without dates and repeats without dates", async () => {
    expect(await pgError(as(null, (sql) => sql`insert into tasks_tasks (title) values ('anon')`))).toBe("42501")
    expect(
      await pgError(as(alice, (sql) => sql`insert into tasks_tasks (title, priority) values ('x', 'urgent')`)),
    ).toBe("23514")
    expect(
      await pgError(as(alice, (sql) => sql`insert into tasks_tasks (title, due_time) values ('x', '10:00')`)),
    ).toBe("23514")
    expect(
      await pgError(as(alice, (sql) => sql`insert into tasks_tasks (title, rrule) values ('x', 'FREQ=DAILY')`)),
    ).toBe("23514")
  })

  it("keeps list names unique per owner, ignoring case, but not across owners", async () => {
    expect(
      await pgError(as(alice, (sql) => sql`insert into tasks_lists (name) values (${`UNIVERSITY ${run}`})`)),
    ).toBe("23505")
    const [row] = await as(bob, (sql) => sql`insert into tasks_lists (name) values (${`University ${run}`}) returning owner_id`)
    expect(row!.owner_id).toBe(bob)
  })

  it("keeps a task when its list is deleted, moving it to no list", async () => {
    await as(alice, (sql) => sql`delete from tasks_lists where id = ${aliceList}`)
    const [task] = await as(alice, (sql) => sql`select list_id from tasks_tasks where id = ${aliceTask}`)
    expect(task).toEqual({ list_id: null })
  })
})
