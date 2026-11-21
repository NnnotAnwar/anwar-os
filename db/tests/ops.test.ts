// RLS for ops_events and bots_bots: `pnpm test:db`. Same harness as rls.test.ts.
// The audit trail is private and append-only; the bot registry is private.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-alice-${run}`
const bob = `test-bob-${run}`
const service = `svc-${run}`

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

beforeAll(async () => {
  for (const id of [alice, bob]) {
    await admin`
      insert into auth."user" (id, name, email, email_verified)
      values (${id}, ${id}, ${`${id}@test.local`}, true)`
  }
})

afterAll(async () => {
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("ops_events", () => {
  let pendingId = ""

  it("records an action for the viewer; owner_id defaults to them", async () => {
    const [row] = await as(alice, (sql) => sql`
      insert into ops_events (actor, service, action, detail)
      values ('Alice', ${service}, 'deploy', ${sql.json({ tag: "abc1234" })})
      returning id, owner_id, result`)
    expect(row).toMatchObject({ owner_id: alice, result: "pending" })
    pendingId = row!.id
  })

  it("lets the actor finalize a pending event exactly once", async () => {
    const first = await as(alice, (sql) => sql`
      update ops_events set result = 'ok', duration_ms = 1200 where id = ${pendingId}`)
    expect(first.count).toBe(1)
    const again = await as(alice, (sql) => sql`
      update ops_events set result = 'error' where id = ${pendingId}`)
    expect(again.count).toBe(0)
    const [row] = await as(alice, (sql) => sql`select result from ops_events where id = ${pendingId}`)
    expect(row!.result).toBe("ok")
  })

  it("never lets the app rewrite who, what or when", async () => {
    const [row] = await as(alice, (sql) => sql`
      insert into ops_events (service, action) values (${service}, 'restart') returning id`)
    expect(await pgError(as(alice, (sql) => sql`
      update ops_events set action = 'stop' where id = ${row!.id}`))).toBe("42501")
    expect(await pgError(as(alice, (sql) => sql`
      update ops_events set created_at = now() - interval '1 year' where id = ${row!.id}`))).toBe("42501")
  })

  it("has no delete for the app: the trail is append-only", async () => {
    expect(await pgError(as(alice, (sql) => sql`delete from ops_events where service = ${service}`))).toBe("42501")
  })

  it("hides one user's trail from another and from anonymous visitors", async () => {
    const bobs = await as(bob, (sql) => sql`select id from ops_events where service = ${service}`)
    expect(bobs).toHaveLength(0)
    const anon = await as(null, (sql) => sql`select id from ops_events where service = ${service}`)
    expect(anon).toHaveLength(0)
    const finalize = await as(bob, (sql) => sql`update ops_events set result = 'error' where service = ${service}`)
    expect(finalize.count).toBe(0)
  })

  it("refuses anonymous inserts and inserts on someone else's behalf", async () => {
    expect(await pgError(as(null, (sql) => sql`
      insert into ops_events (service, action) values (${service}, 'stop')`))).toBe("42501")
    expect(await pgError(as(bob, (sql) => sql`
      insert into ops_events (owner_id, service, action) values (${alice}, ${service}, 'stop')`))).toBe("42501")
  })

  it("only accepts known actions, results and service names", async () => {
    expect(await pgError(as(alice, (sql) => sql`
      insert into ops_events (service, action) values (${service}, 'exec')`))).toBe("23514")
    expect(await pgError(as(alice, (sql) => sql`
      insert into ops_events (service, action, result) values (${service}, 'stop', 'maybe')`))).toBe("23514")
    expect(await pgError(as(alice, (sql) => sql`
      insert into ops_events (service, action) values ('../etc; rm', 'stop')`))).toBe("23514")
  })
})

describe("bots_bots", () => {
  it("lets a user register bots; owner_id defaults to them", async () => {
    const [row] = await as(alice, (sql) => sql`
      insert into bots_bots (name, telegram_username, service_name, stats_source)
      values (${`Expenses ${run}`}, 'expenses_bot', 'bot-expenses', 'bot_expenses')
      returning owner_id`)
    expect(row!.owner_id).toBe(alice)
  })

  it("keeps bots private to their owner", async () => {
    const mine = await as(alice, (sql) => sql`select name from bots_bots where name like ${`%${run}`}`)
    expect(mine.length).toBeGreaterThanOrEqual(1)
    expect(await as(bob, (sql) => sql`select name from bots_bots where name like ${`%${run}`}`)).toHaveLength(0)
    expect(await as(null, (sql) => sql`select name from bots_bots where name like ${`%${run}`}`)).toHaveLength(0)
    const result = await as(bob, async (sql) => ({
      updated: (await sql`update bots_bots set description = 'x' where name like ${`%${run}`}`).count,
      deleted: (await sql`delete from bots_bots where name like ${`%${run}`}`).count,
    }))
    expect(result).toEqual({ updated: 0, deleted: 0 })
  })

  it("only accepts bot_* schemas or osbot as stats sources, and well-formed usernames", async () => {
    expect(await pgError(as(alice, (sql) => sql`
      insert into bots_bots (name, stats_source) values (${`Bad ${run}`}, 'public')`))).toBe("23514")
    await as(alice, (sql) => sql`insert into bots_bots (name, stats_source) values (${`osbot ${run}`}, 'osbot')`)
    expect(await pgError(as(alice, (sql) => sql`
      insert into bots_bots (name, telegram_username) values (${`Bad2 ${run}`}, '@with_at')`))).toBe("23514")
  })

  it("keeps names unique per owner", async () => {
    expect(await pgError(as(alice, (sql) => sql`
      insert into bots_bots (name) values (${`Expenses ${run}`})`))).toBe("23505")
    await as(bob, (sql) => sql`insert into bots_bots (name) values (${`Expenses ${run}`})`)
  })
})
