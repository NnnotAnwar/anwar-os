// RLS for core_preferences (the "My services" selection): `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-pref-alice-${run}`
const bob = `test-pref-bob-${run}`

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
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${alice}, 'Alice', ${`${alice}@test.local`}, true),
           (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
})

afterAll(async () => {
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("core_preferences", () => {
  it("lets a user save and re-save their own selection (upsert)", async () => {
    await as(alice, (sql) => sql`
      insert into core_preferences (pinned_services) values (${["notes", "calendar"]})
      on conflict (owner_id) do update set pinned_services = excluded.pinned_services`)
    await as(alice, (sql) => sql`
      insert into core_preferences (pinned_services) values (${["ideas"]})
      on conflict (owner_id) do update set pinned_services = excluded.pinned_services`)
    const [row] = await as(alice, (sql) => sql`select pinned_services from core_preferences`)
    expect(row!.pinned_services).toEqual(["ideas"])
  })

  it("hides and protects other users' selections", async () => {
    const rows = await as(bob, (sql) => sql`select owner_id from core_preferences`)
    expect(rows).toHaveLength(0)
    const updated = await as(bob, (sql) => sql`update core_preferences set pinned_services = '{}'`)
    expect(updated.count).toBe(0)
  })

  it("refuses writing a row for someone else", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`insert into core_preferences (owner_id, pinned_services) values (${alice}, '{}')`),
    )
    expect(code).toBe("42501")
  })

  it("can't delete rows directly", async () => {
    const code = await pgError(as(alice, (sql) => sql`delete from core_preferences`))
    expect(code).toBe("42501")
  })
})

describe("core_preferences: appearance and Today layout", () => {
  const save = (viewer: string, set: Record<string, unknown>) =>
    as(viewer, (sql) => sql`
      insert into core_preferences ${sql(set)}
      on conflict (owner_id) do update set ${sql(set)}`)

  it("defaults to the system theme and the modules' own Today order", async () => {
    await save(bob, { pinned_services: ["notes"] })
    const [row] = await as(bob, (sql) => sql`
      select theme_mode, theme_schedule, theme_dark_from, theme_dark_until, theme_lat, today_order, today_hidden
      from core_preferences`)
    expect(row).toEqual({
      theme_mode: "system",
      theme_schedule: "hours",
      theme_dark_from: "20:00",
      theme_dark_until: "07:00",
      theme_lat: null,
      today_order: [],
      today_hidden: [],
    })
  })

  it("saves a sunset schedule and a layout for the user only", async () => {
    await save(alice, {
      theme_mode: "scheduled",
      theme_schedule: "sun",
      theme_lat: 50.1,
      theme_lon: 14.4,
      theme_place: "Prague",
      today_order: ["budget:month", "tasks:due"],
      today_hidden: ["notes:recent"],
    })
    const [row] = await as(alice, (sql) => sql`select theme_mode, theme_lat, theme_place, today_order, today_hidden from core_preferences`)
    expect(row).toEqual({
      theme_mode: "scheduled",
      theme_lat: 50.1,
      theme_place: "Prague",
      today_order: ["budget:month", "tasks:due"],
      today_hidden: ["notes:recent"],
    })

    // Bob sees only his own row and can't change Alice's.
    const seen = await as(bob, (sql) => sql`select owner_id from core_preferences where today_hidden <> '{}'`)
    expect(seen).toHaveLength(0)
    const updated = await as(bob, (sql) => sql`update core_preferences set theme_mode = 'dark' where owner_id = ${alice}`)
    expect(updated.count).toBe(0)
    const anonymous = await as(null, (sql) => sql`select owner_id from core_preferences`)
    expect(anonymous).toHaveLength(0)
  })

  it("refuses nonsense values", async () => {
    const bad: Record<string, unknown>[] = [
      { theme_mode: "sepia" },
      { theme_schedule: "moon" },
      { theme_dark_from: "24:00" },
      { theme_dark_until: "7pm" },
      { theme_lat: 50.1 },
      { theme_lat: 95, theme_lon: 10 },
      { theme_lat: 50, theme_lon: 200 },
      { theme_schedule: "sun", theme_lat: null, theme_lon: null },
      { theme_place: "x".repeat(81) },
      { today_order: Array.from({ length: 101 }, (_, i) => `m:${i}`) },
    ]
    for (const set of bad) {
      expect(await pgError(save(bob, set)), JSON.stringify(set).slice(0, 60)).toBe("23514")
    }
  })
})
