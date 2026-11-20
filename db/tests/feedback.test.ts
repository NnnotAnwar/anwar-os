// Feedback: the one anonymous write path. `pnpm test:db`. Same harness as
// rls.test.ts: `admin` sets up fixtures, `app` connects as os_app.
import { createHash, randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-feedback-bob-${run}`
let owner = ""
let createdOwner = false
const created: string[] = []
const usedHashes: string[] = []

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

/** A fresh sender: its own IP hash, so rate limits never leak between tests. */
function sender() {
  const hash = createHash("sha256").update(randomBytes(16)).digest("hex")
  usedHashes.push(hash)
  return hash
}

const challenge = () => `test-${run}-${randomBytes(12).toString("hex")}`

type Submission = { kind?: string; message?: string; name?: string | null; contact?: string | null }

async function submit(ipHash: string, s: Submission = {}, ch = challenge()) {
  const [row] = await as(
    null,
    (sql) => sql`
      select app.submit_feedback(
        ${s.kind ?? "suggestion"},
        ${s.message ?? `A thoughtful message ${run}`},
        ${s.name ?? null},
        ${s.contact ?? null},
        ${ipHash},
        ${ch}
      ) as id`,
  )
  created.push(row!.id)
  return row!.id as string
}

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-feedback-owner-${run}`
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
  if (created.length) await admin`delete from feedback_items where id in ${admin(created)}`
  if (usedHashes.length) await admin`delete from feedback_submissions where ip_hash in ${admin(usedHashes)}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("feedback_items access", () => {
  it("cannot be inserted into directly, with or without a viewer", async () => {
    const values = (sql: postgres.TransactionSql) =>
      sql`insert into feedback_items (owner_id, kind, message) values (${owner}, 'thanks', 'direct insert attempt')`
    expect(await pgError(as(null, values))).toBe("42501")
    expect(await pgError(as(owner, values))).toBe("42501")
    expect(await pgError(as(bob, values))).toBe("42501")
  })

  it("keeps the rate-limit log out of reach of the app", async () => {
    expect(await pgError(as(null, (sql) => sql`select * from feedback_submissions`))).toBe("42501")
    expect(await pgError(as(owner, (sql) => sql`delete from feedback_submissions`))).toBe("42501")
  })

  it("files a submission from a visitor for the site owner", async () => {
    const id = await submit(sender(), { kind: "complaint", name: "  Jana ", contact: "@jana" })
    const [row] = await admin`select owner_id, kind, name, contact, status from feedback_items where id = ${id}`
    expect(row).toEqual({ owner_id: owner, kind: "complaint", name: "Jana", contact: "@jana", status: "new" })
  })

  it("stores empty name and contact as null and trims the message", async () => {
    const id = await submit(sender(), { message: `   padded message ${run}   `, name: " ", contact: "" })
    const [row] = await admin`select message, name, contact from feedback_items where id = ${id}`
    expect(row).toEqual({ message: `padded message ${run}`, name: null, contact: null })
  })

  it("is invisible to visitors and to other users", async () => {
    const id = await submit(sender())
    expect(await as(null, (sql) => sql`select id from feedback_items where id = ${id}`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`select id from feedback_items where id = ${id}`)).toHaveLength(0)
    expect(await as(owner, (sql) => sql`select id from feedback_items where id = ${id}`)).toHaveLength(1)
  })

  it("can't be changed or deleted by anyone but the owner", async () => {
    const id = await submit(sender())
    const result = await as(bob, async (sql) => {
      const updated = await sql`update feedback_items set status = 'spam' where id = ${id}`
      const deleted = await sql`delete from feedback_items where id = ${id}`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
  })

  it("lets the owner triage and annotate, but never rewrite the message", async () => {
    const id = await submit(sender())
    const [row] = await as(
      owner,
      (sql) => sql`update feedback_items set status = 'in_progress', reply_note = 'Replied by email'
                   where id = ${id} returning status, reply_note`,
    )
    expect(row).toEqual({ status: "in_progress", reply_note: "Replied by email" })
    const code = await pgError(as(owner, (sql) => sql`update feedback_items set message = 'rewritten text' where id = ${id}`))
    expect(code).toBe("42501")
    const handOver = await pgError(as(owner, (sql) => sql`update feedback_items set owner_id = ${bob} where id = ${id}`))
    expect(handOver).toBe("42501")
  })

  it("lets the owner delete feedback", async () => {
    const id = await submit(sender())
    const deleted = await as(owner, (sql) => sql`delete from feedback_items where id = ${id}`)
    expect(deleted.count).toBe(1)
  })
})

describe("app.submit_feedback", () => {
  it("is a security definer with an empty search_path", async () => {
    const [fn] = await admin`
      select prosecdef, proconfig from pg_proc
      where oid = 'app.submit_feedback(text, text, text, text, text, text)'::regprocedure`
    expect(fn!.prosecdef).toBe(true)
    expect(fn!.proconfig).toContain('search_path=""')
  })

  it("can be executed by os_app but not by public", async () => {
    const [row] = await admin`
      select has_function_privilege('os_app', 'app.submit_feedback(text, text, text, text, text, text)', 'execute') as app,
             exists (
               select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = 'app.submit_feedback(text, text, text, text, text, text)'::regprocedure
                 and a.grantee = 0 and a.privilege_type = 'EXECUTE'
             ) as public`
    expect(row).toEqual({ app: true, public: false })
  })

  it.each([
    ["an unknown kind", { kind: "praise" }],
    ["a message under 10 characters", { message: "too short" }],
    ["a message of only spaces", { message: "              " }],
    ["a message over 5000 characters", { message: "x".repeat(5001) }],
    ["a name over 100 characters", { name: "n".repeat(101) }],
    ["a contact over 200 characters", { contact: "c".repeat(201) }],
  ])("rejects %s", async (_, input) => {
    expect(await pgError(submit(sender(), input))).toBe("22023")
  })

  it("rejects a malformed IP hash or a missing challenge", async () => {
    expect(await pgError(submit("not-a-hash"))).toBe("22023")
    expect(await pgError(submit("A".repeat(64)))).toBe("22023")
    expect(await pgError(submit(sender(), {}, "short"))).toBe("22023")
  })

  it("accepts exactly 10 and 5000 characters", async () => {
    await submit(sender(), { message: "1234567890" })
    await submit(sender(), { message: "y".repeat(5000) })
  })

  it("allows 3 submissions per 10 minutes from one sender", async () => {
    const ip = sender()
    await submit(ip)
    await submit(ip)
    await submit(ip)
    expect(await pgError(submit(ip))).toBe("OS429")
    // Someone else is unaffected.
    await submit(sender())
  })

  it("allows 20 submissions per day from one sender", async () => {
    const ip = sender()
    // 20 earlier today, outside the 10-minute window.
    await admin`
      insert into feedback_submissions (challenge, ip_hash, created_at)
      select ${`day-${run}-`} || g, ${ip}, now() - interval '2 hours' from generate_series(1, 20) g`
    expect(await pgError(submit(ip))).toBe("OS430")
  })

  // db/modules/feedback.sql: the form shows "Try again in m:ss" from DETAIL.
  it("says how many seconds until the sender may try again", async () => {
    const detail = async (p: Promise<unknown>) => {
      try {
        await p
      } catch (e) {
        return Number((e as { detail?: string }).detail)
      }
      return null
    }
    const burst = sender()
    await admin`
      insert into feedback_submissions (challenge, ip_hash, created_at)
      select ${`burst-${run}-`} || g, ${burst}, now() - interval '4 minutes' from generate_series(1, 3) g`
    const wait = await detail(submit(burst))
    expect(wait).toBeGreaterThan(355)
    expect(wait).toBeLessThanOrEqual(360)

    const daily = sender()
    await admin`
      insert into feedback_submissions (challenge, ip_hash, created_at)
      select ${`daily-${run}-`} || g, ${daily}, now() - interval '23 hours' from generate_series(1, 20) g`
    const until = await detail(submit(daily))
    expect(until).toBeGreaterThan(3595)
    expect(until).toBeLessThanOrEqual(3600)
  })

  it("forgets submissions older than a day", async () => {
    const ip = sender()
    await admin`
      insert into feedback_submissions (challenge, ip_hash, created_at)
      select ${`old-${run}-`} || g, ${ip}, now() - interval '25 hours' from generate_series(1, 20) g`
    await submit(ip)
    const [row] = await admin`select count(*)::int as n from feedback_submissions where ip_hash = ${ip}`
    expect(row!.n).toBe(1)
  })

  it("refuses a proof-of-work challenge that was already used", async () => {
    const ch = challenge()
    await submit(sender(), {}, ch)
    expect(await pgError(submit(sender(), {}, ch))).toBe("OS409")
  })
})
