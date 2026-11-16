// Row-level security for the calendar module: `pnpm test:db`.
// Same setup as rls.test.ts: `admin` creates fixtures, `app` is os_app.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-cal-alice-${run}`
const bob = `test-cal-bob-${run}`
const aliceToken = randomBytes(32).toString("base64url")

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

let aliceEvent = ""

beforeAll(async () => {
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${alice}, 'Alice', ${`${alice}@test.local`}, true),
           (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
})

afterAll(async () => {
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("calendar_events", () => {
  it("lets a user create an event; owner_id defaults to the viewer", async () => {
    const [event] = await as(
      alice,
      (sql) => sql`
        insert into calendar_events (title, start_at, end_at, rrule)
        values ('Standup', '2026-11-16 09:00+01', '2026-11-16 09:15+01', 'FREQ=WEEKLY;BYDAY=MO')
        returning id, owner_id`,
    )
    expect(event!.owner_id).toBe(alice)
    aliceEvent = event!.id
  })

  it("refuses an event that ends before it starts, or an unknown category", async () => {
    const backwards = await pgError(
      as(alice, (sql) => sql`insert into calendar_events (title, start_at, end_at) values ('x', '2026-11-16 10:00Z', '2026-11-16 09:00Z')`),
    )
    expect(backwards).toBe("23514")
    const category = await pgError(
      as(
        alice,
        (sql) => sql`insert into calendar_events (title, start_at, end_at, category) values ('x', now(), now(), 'party')`,
      ),
    )
    expect(category).toBe("23514")
  })

  it("hides other users' events and refuses changes to them", async () => {
    const result = await as(bob, async (sql) => {
      const rows = await sql`select id from calendar_events`
      const updated = await sql`update calendar_events set title = 'hijacked'`
      const deleted = await sql`delete from calendar_events`
      return { seen: rows.length, updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ seen: 0, updated: 0, deleted: 0 })
  })

  it("refuses an event created on someone else's behalf", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`insert into calendar_events (owner_id, title, start_at, end_at) values (${alice}, 'forged', now(), now())`),
    )
    expect(code).toBe("42501")
  })

  it("keeps updated_at current through the trigger", async () => {
    const [before] = await as(alice, (sql) => sql`select updated_at from calendar_events where id = ${aliceEvent}`)
    await new Promise((r) => setTimeout(r, 20))
    const [after] = await as(
      alice,
      (sql) => sql`update calendar_events set location = 'Room 2' where id = ${aliceEvent} returning updated_at`,
    )
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime())
  })
})

describe("calendar_reminders", () => {
  it("lets a user remind themselves of their own event", async () => {
    const [reminder] = await as(
      alice,
      (sql) => sql`insert into calendar_reminders (event_id, minutes_before) values (${aliceEvent}, 10) returning owner_id`,
    )
    expect(reminder!.owner_id).toBe(alice)
  })

  it("refuses a reminder on someone else's event", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`insert into calendar_reminders (event_id, minutes_before) values (${aliceEvent}, 5)`),
    )
    expect(code).toBe("23503")
  })

  it("hides other users' reminders", async () => {
    const rows = await as(bob, (sql) => sql`select id from calendar_reminders`)
    expect(rows).toHaveLength(0)
  })

  it("goes away with its event", async () => {
    const [event] = await as(
      alice,
      (sql) => sql`insert into calendar_events (title, start_at, end_at) values ('Temp', now(), now()) returning id`,
    )
    await as(alice, (sql) => sql`insert into calendar_reminders (event_id, minutes_before) values (${event!.id}, 0)`)
    await as(alice, (sql) => sql`delete from calendar_events where id = ${event!.id}`)
    const rows = await as(alice, (sql) => sql`select id from calendar_reminders where event_id = ${event!.id}`)
    expect(rows).toHaveLength(0)
  })
})

describe("calendar_feed_tokens", () => {
  it("lets a user store one feed token", async () => {
    await as(
      alice,
      (sql) => sql`insert into calendar_feed_tokens (selector, token) values (${aliceToken.slice(0, 12)}, ${aliceToken})`,
    )
    const code = await pgError(
      as(
        alice,
        (sql) => sql`insert into calendar_feed_tokens (selector, token) values (${aliceToken.slice(1, 13)}, ${aliceToken.slice(1) + "x"})`,
      ),
    )
    expect(code).toBe("23505")
  })

  it("never shows a token to anyone else, or to no one", async () => {
    expect(await as(bob, (sql) => sql`select token from calendar_feed_tokens`)).toHaveLength(0)
    expect(await as(null, (sql) => sql`select token from calendar_feed_tokens`)).toHaveLength(0)
  })

  it("resolves a selector to its owner through the lookup function, without a viewer", async () => {
    const [row] = await as(null, (sql) => sql`select * from app.calendar_feed_lookup(${aliceToken.slice(0, 12)})`)
    expect(row).toEqual({ owner_id: alice, token: aliceToken })
    const none = await as(null, (sql) => sql`select * from app.calendar_feed_lookup('nope-nope-no')`)
    expect(none).toHaveLength(0)
  })
})
