// Sign-in attempt limits: the Postgres-backed counter, and Better Auth's HTTP
// limiter running on it. Keys are unique per run, so parallel runs don't meet.
import { randomBytes } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import { consumeRateLimit, pruneRateLimits } from "../../src/lib/rate-limit"
import { Browser, createUser, openDatabases, testAuth } from "./support/auth-harness"

const { admin, app, db } = openDatabases()
const run = randomBytes(4).toString("hex")
const users: string[] = []

afterAll(async () => {
  await admin`delete from auth.rate_limit where key like ${`%${run}%`}`
  if (users.length) await admin`delete from auth."user" where id in ${admin(users)}`
  await Promise.all([admin.end(), app.end()])
})

describe("consumeRateLimit", () => {
  it("allows max attempts per window, then refuses with a retry time", async () => {
    const key = `test:${run}:basic`
    const rule = { window: 60, max: 3 }
    for (let i = 0; i < 3; i++) expect(await consumeRateLimit(db, key, rule)).toEqual({ allowed: true, retryAfter: null })
    const refused = await consumeRateLimit(db, key, rule)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfter).toBeGreaterThan(0)
    expect(refused.retryAfter).toBeLessThanOrEqual(60)
  })

  it("starts over once the window has passed", async () => {
    const key = `test:${run}:window`
    const rule = { window: 60, max: 1 }
    await consumeRateLimit(db, key, rule)
    expect((await consumeRateLimit(db, key, rule)).allowed).toBe(false)
    await admin`update auth.rate_limit set window_start = now() - interval '61 seconds' where key = ${key}`
    expect((await consumeRateLimit(db, key, rule)).allowed).toBe(true)
    const [row] = await admin`select count from auth.rate_limit where key = ${key}`
    expect(row!.count).toBe(1)
  })

  it("can't be raced: concurrent attempts are counted one by one", async () => {
    const key = `test:${run}:race`
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeRateLimit(db, key, { window: 60, max: 5 })))
    expect(results.filter((r) => r.allowed)).toHaveLength(5)
  })

  it("prunes only old rows", async () => {
    const fresh = `test:${run}:fresh`
    const stale = `test:${run}:stale`
    await consumeRateLimit(db, fresh, { window: 60, max: 1 })
    await consumeRateLimit(db, stale, { window: 60, max: 1 })
    await admin`update auth.rate_limit set window_start = now() - interval '2 days' where key = ${stale}`
    await pruneRateLimits(db)
    const keys = (await admin`select key from auth.rate_limit where key in (${fresh}, ${stale})`).map((r) => r.key)
    expect(keys).toEqual([fresh])
  })
})

describe("Better Auth's limiter on Postgres", () => {
  const limited = testAuth(db, { rateLimit: true })
  const unlimited = testAuth(db)

  async function wrongPassword(auth: typeof limited, ip: string, email: string) {
    return (await new Browser(ip).request(auth, "/sign-in/email", { body: { email, password: "wrong password!!" } })).status
  }

  it("refuses the fourth sign-in within 10 seconds from one address, and counts in the table", async () => {
    const owner = await createUser(admin, "rate-limit")
    users.push(owner.id)
    const ip = `203.0.113.${1 + (parseInt(run, 16) % 250)}`
    const statuses = []
    for (let i = 0; i < 4; i++) statuses.push(await wrongPassword(limited, ip, owner.email))
    expect(statuses).toEqual([401, 401, 401, 429])

    // Another address isn't affected, and the right password still works there.
    const other = new Browser(`198.51.100.${1 + (parseInt(run, 16) % 250)}`)
    const ok = await other.request(limited, "/sign-in/email", { body: { email: owner.email, password: owner.password } })
    expect(ok.status).toBe(200)

    const rows = await admin`select count from auth.rate_limit where key = ${`auth-api:${ip}|/sign-in/email`}`
    expect(rows[0]?.count).toBeGreaterThanOrEqual(4)
    await admin`delete from auth.rate_limit where key like ${`auth-api:%${ip}%`} or key like ${`auth-api:%${other.ip}%`}`
  })

  it("is off unless asked for, whatever NODE_ENV says", async () => {
    const owner = await createUser(admin, "no-limit")
    users.push(owner.id)
    const ip = `192.0.2.${1 + (parseInt(run, 16) % 250)}`
    const statuses = []
    for (let i = 0; i < 5; i++) statuses.push(await wrongPassword(unlimited, ip, owner.email))
    expect(statuses).toEqual([401, 401, 401, 401, 401])
  })
})
