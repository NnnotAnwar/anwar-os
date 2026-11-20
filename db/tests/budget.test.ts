// RLS and integrity for the budget_* tables: `pnpm test:db`. Same harness as
// rls.test.ts. Everything in budget is private to its owner.
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

let account = ""
let category = ""
let recurring = ""
let bobAccount = ""

beforeAll(async () => {
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${alice}, 'Alice', ${`${alice}@test.local`}, true),
           (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
})

afterAll(async () => {
  // Transactions restrict account deletes, so clear them before the user cascade.
  await admin`delete from budget_transactions where owner_id in (${alice}, ${bob})`
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("budget: own rows", () => {
  it("creates accounts, categories and transactions for the viewer", async () => {
    const rows = await as(alice, async (sql) => {
      const [a] = await sql`
        insert into budget_accounts (name, kind, currency, opening_balance_minor)
        values ('Current', 'bank', 'EUR', 100000) returning id, owner_id`
      const [c] = await sql`insert into budget_categories (name, kind) values ('Food', 'expense') returning id`
      const [t] = await sql`
        insert into budget_transactions (account_id, category_id, amount_minor, occurred_on, note)
        values (${a!.id}, ${c!.id}, -25000, '2026-11-16', 'lunch') returning owner_id, currency`
      return { a: a!, c: c!, t: t! }
    })
    account = rows.a.id
    category = rows.c.id
    expect(rows.a.owner_id).toBe(alice)
    // The currency comes from the account even though the insert didn't name it.
    expect(rows.t).toEqual({ owner_id: alice, currency: "EUR" })
  })

  it("hides every budget table from other users and from anonymous visitors", async () => {
    for (const viewer of [bob, null]) {
      const counts = await as(viewer, async (sql) => {
        const [r] = await sql`
          select (select count(*) from budget_accounts)::int as accounts,
                 (select count(*) from budget_categories)::int as categories,
                 (select count(*) from budget_transactions)::int as transactions`
        return r
      })
      expect(counts).toEqual({ accounts: 0, categories: 0, transactions: 0 })
    }
  })

  it("never lets another user edit or delete the owner's rows", async () => {
    const result = await as(bob, async (sql) => {
      const updated = await sql`update budget_transactions set amount_minor = -1 where owner_id = ${alice}`
      const deleted = await sql`delete from budget_accounts where owner_id = ${alice}`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
  })

  it("refuses rows forged for someone else and anonymous inserts", async () => {
    expect(
      await pgError(as(bob, (sql) => sql`insert into budget_accounts (owner_id, name) values (${alice}, 'forged')`)),
    ).toBe("42501")
    expect(await pgError(as(null, (sql) => sql`insert into budget_categories (name) values ('anon')`))).toBe("42501")
    expect(
      await pgError(as(alice, (sql) => sql`update budget_accounts set owner_id = ${bob} where id = ${account}`)),
    ).toBe("42501")
  })

  it("refuses pointing at another user's account or category, even by id", async () => {
    const [b] = await as(bob, (sql) => sql`insert into budget_accounts (name) values ('Bob cash') returning id`)
    bobAccount = b!.id
    expect(
      await pgError(as(bob, (sql) => sql`
        insert into budget_transactions (account_id, amount_minor, occurred_on) values (${account}, -100, '2026-11-16')`)),
    ).toBe("23503")
    expect(
      await pgError(as(bob, (sql) => sql`
        insert into budget_transactions (account_id, category_id, amount_minor, occurred_on)
        values (${bobAccount}, ${category}, -100, '2026-11-16')`)),
    ).toBe("23503")
    expect(
      await pgError(as(bob, (sql) => sql`insert into budget_goals (name, target_minor, account_id) values ('x', 1, ${account})`)),
    ).toBe("23503")
  })
})

describe("budget: integrity", () => {
  it("rejects zero amounts, unknown kinds and a second plan", async () => {
    expect(
      await pgError(as(alice, (sql) => sql`
        insert into budget_transactions (account_id, amount_minor, occurred_on) values (${account}, 0, '2026-11-16')`)),
    ).toBe("23514")
    expect(await pgError(as(alice, (sql) => sql`insert into budget_accounts (name, kind) values ('x', 'crypto')`))).toBe(
      "23514",
    )
    await as(alice, (sql) => sql`insert into budget_plans (start_on) values ('2026-11-01')`)
    expect(await pgError(as(alice, (sql) => sql`insert into budget_plans (start_on) values ('2026-12-01')`))).toBe("23505")
  })

  it("creates at most one transaction per template and date", async () => {
    const [r] = await as(alice, (sql) => sql`
      insert into budget_recurring (account_id, amount_minor, note, start_on, next_due)
      values (${account}, -50000, 'rent', '2026-01-01', '2026-01-01') returning id`)
    recurring = r!.id
    const insert = () =>
      as(alice, (sql) => sql`
        insert into budget_transactions (account_id, amount_minor, occurred_on, recurring_id)
        values (${account}, -50000, '2026-01-01', ${recurring})`)
    await insert()
    expect(await pgError(insert())).toBe("23505")
  })

  it("keeps transactions when their account would be deleted", async () => {
    expect(await pgError(as(alice, (sql) => sql`delete from budget_accounts where id = ${account}`))).toBe("23503")
  })

  it("moves the currency of an account's transactions along with it", async () => {
    const currencies = await as(alice, async (sql) => {
      await sql`update budget_accounts set currency = 'CZK' where id = ${account}`
      return sql`select distinct currency from budget_transactions where account_id = ${account}`
    })
    expect(currencies.map((r) => r.currency)).toEqual(["CZK"])
  })

  it("uncategorises transactions when their category is deleted", async () => {
    const rows = await as(alice, async (sql) => {
      await sql`delete from budget_categories where id = ${category}`
      return sql`select owner_id, category_id from budget_transactions where note = 'lunch'`
    })
    expect(rows).toEqual([{ owner_id: alice, category_id: null }])
  })

  it("keeps generated transactions when their template is deleted", async () => {
    const rows = await as(alice, async (sql) => {
      await sql`delete from budget_recurring where id = ${recurring}`
      return sql`select recurring_id from budget_transactions where occurred_on = '2026-01-01'`
    })
    expect(rows).toEqual([{ recurring_id: null }])
  })
})
