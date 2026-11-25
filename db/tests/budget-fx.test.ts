// ČNB exchange rates in Budget: the shared rate tables' RLS and grants, the
// two security definer write functions, the lazy fetch-and-cache (against a
// stubbed ČNB: tests never touch the network) and the conversions in the
// overview, transactions, accounts and fxRate actions. `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const { actAs, loadViewer } = await import("@/core/auth")
const { withApiToken } = await import("@/db")
const { actions } = await import("@/modules/budget/actions")
const { ensureRates, setFxFetcher } = await import("@/modules/budget/fx/rates")
const { todayIn } = await import("@/modules/budget/lib/dates")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-fx-alice-${run}`
const startedAt = new Date()
const pragueToday = todayIn("Europe/Prague")

async function pgError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    return (e as { code?: string }).code
  }
  return null
}

function asApp<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    if (viewer) await sql`select set_config('app.user_id', ${viewer}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function asAlice<T>(fn: () => Promise<T>) {
  const viewer = await loadViewer(alice)
  return actAs(viewer!, fn)
}

// --- a stand-in for ČNB ---------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const header = (iso: string, seq: number) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)} #${seq}`

/** The latest weekday on or before `iso`, never after today in Prague (like ČNB). */
function fixingFor(iso: string) {
  const d = new Date(`${(iso > pragueToday ? pragueToday : iso)}T00:00:00Z`)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

type Stub = { calls: string[]; fail: boolean; delayMs: number }

function stubCnb(): Stub {
  const stub: Stub = { calls: [], fail: false, delayMs: 0 }
  setFxFetcher(async (url) => {
    stub.calls.push(url)
    if (stub.delayMs) await new Promise((r) => setTimeout(r, stub.delayMs))
    if (stub.fail) throw new Error("ČNB is down (stub)")
    const daily = /daily\.txt\?date=(\d{2})\.(\d{2})\.(\d{4})$/.exec(url)
    if (daily) {
      const fixing = fixingFor(`${daily[3]}-${daily[2]}-${daily[1]}`)
      return `${header(fixing, 1)}\nCountry|Currency|Amount|Code|Rate\nEMU|euro|1|EUR|25.000\nJapan|yen|100|JPY|15.000\nUSA|dollar|1|USD|20.000\n`
    }
    const monthly = /fx_rates\.txt\?year=(\d{4})&month=(\d{1,2})$/.exec(url)
    if (monthly) {
      // Declared on the last day of the month asked for (close enough for the stub).
      const last = new Date(Date.UTC(Number(monthly[1]), Number(monthly[2]), 0)).toISOString().slice(0, 10)
      if (last > pragueToday) return ""
      return `${header(last, Number(monthly[2]))}\nCountry|Currency|Amount|Code|Rate\nKazakhstan|tenge|100|KZT|4,000\nUkraine|hryvna|100|UAH|50,000\n`
    }
    throw new Error(`unexpected URL ${url}`)
  })
  return stub
}

beforeAll(async () => {
  await admin`insert into auth."user" (id, name, email, email_verified) values (${alice}, 'Alice', ${`${alice}@test.local`}, true)`
})

afterAll(async () => {
  setFxFetcher(null)
  await admin`delete from budget_transactions where owner_id = ${alice}`
  await admin`delete from auth."user" where id = ${alice}`
  // Everything this run put into the shared cache (fake rates must not outlive it).
  await admin`delete from budget_fx_rates where created_at >= ${startedAt} or currency in ('XTA', 'XTB')`
  await admin`delete from budget_fx_days where checked_at >= ${startedAt} or day between '2003-01-01' and '2004-12-31'`
  await Promise.all([admin.end(), app.end()])
})

describe("budget fx: shared tables", () => {
  it("lets os_app read the rates with or without a viewer", async () => {
    await admin`select app.budget_fx_save_daily('2003-03-10', '2003-03-07', '{XTA}', '{1}', '{2.5}')`
    for (const viewer of [null, alice]) {
      const rows = await asApp(viewer, (sql) => sql`select currency, units, rate::text from budget_fx_rates where currency = 'XTA'`)
      expect(rows).toEqual([{ currency: "XTA", units: 1, rate: "2.500000" }])
      const [day] = await asApp(viewer, (sql) => sql`select fixing_date::text, final from budget_fx_days where day = '2003-03-09'`)
      expect(day).toEqual({ fixing_date: "2003-03-07", final: true })
    }
  })

  it("refuses direct writes and the private check function to os_app", async () => {
    expect(await pgError(asApp(alice, (sql) => sql`insert into budget_fx_rates (source, valid_on, currency, units, rate) values ('daily', '2003-03-11', 'XTB', 1, 1)`))).toBe("42501")
    expect(await pgError(asApp(null, (sql) => sql`update budget_fx_rates set rate = 1 where currency = 'XTA'`))).toBe("42501")
    expect(await pgError(asApp(null, (sql) => sql`delete from budget_fx_rates where currency = 'XTA'`))).toBe("42501")
    expect(await pgError(asApp(null, (sql) => sql`insert into budget_fx_days (day, fixing_date, final) values ('2003-03-12', '2003-03-12', true)`))).toBe("42501")
    expect(await pgError(asApp(null, (sql) => sql`delete from budget_fx_days where day = '2003-03-09'`))).toBe("42501")
    expect(await pgError(asApp(null, (sql) => sql`select app.budget_fx_check_rates('{XTB}', '{1}', '{1}')`))).toBe("42501")
  })

  it("validates what the save functions get", async () => {
    const daily = (day: string, fixing: string, codes: string, units: string, rates: string) =>
      pgError(asApp(null, (sql) => sql`select app.budget_fx_save_daily(${day}, ${fixing}, ${codes}::text[], ${units}::integer[], ${rates}::numeric[])`))
    expect(await daily("2003-03-12", "2003-03-12", "{xtb}", "{1}", "{1}")).toBe("22023")
    expect(await daily("2003-03-12", "2003-03-12", "{CZK}", "{1}", "{1}")).toBe("22023")
    expect(await daily("2003-03-12", "2003-03-12", "{XTB}", "{3}", "{1}")).toBe("22023")
    expect(await daily("2003-03-12", "2003-03-12", "{XTB}", "{1}", "{0}")).toBe("22023")
    expect(await daily("2003-03-12", "2003-03-12", "{XTB,XTB}", "{1,1}", "{1,2}")).toBe("22023")
    expect(await daily("2003-03-12", "2003-03-12", "{XTB}", "{1,1}", "{1}")).toBe("22023")
    expect(await daily("2003-03-12", "2003-03-13", "{XTB}", "{1}", "{1}")).toBe("22023") // fixing after the day
    expect(await daily("2003-03-12", "2003-01-01", "{XTB}", "{1}", "{1}")).toBe("22023") // too far back
    expect(await daily("2999-01-01", "2003-03-12", "{XTB}", "{1}", "{1}")).toBe("22023") // the future
    const monthly = (month: string, declared: string) =>
      pgError(asApp(null, (sql) => sql`select app.budget_fx_save_monthly(${month}, ${declared}, '{XTB}', '{100}', '{4}')`))
    expect(await monthly("2003-03-02", "2003-02-27")).toBe("22023")
    expect(await monthly("2003-03-01", "2003-03-01")).toBe("22023")
    expect(await monthly("2003-03-01", "2003-01-31")).toBe("22023")
    expect(await monthly("2003-03-01", "2003-02-28")).toBeNull()
  })

  it("never changes a published rate or a final day, and moves open days", async () => {
    await asApp(null, (sql) => sql`select app.budget_fx_save_daily('2003-03-09', '2003-03-07', '{XTA}', '{1}', '{9.99}')`)
    const [rate] = await admin`select rate::text from budget_fx_rates where currency = 'XTA' and valid_on = '2003-03-07'`
    expect(rate!.rate).toBe("2.500000")
    // A final day keeps its fixing even if asked again with another answer.
    await asApp(null, (sql) => sql`select app.budget_fx_save_daily('2003-03-09', '2003-03-05', '{XTA}', '{1}', '{2.4}')`)
    const [day] = await admin`select fixing_date::text from budget_fx_days where day = '2003-03-09'`
    expect(day!.fixing_date).toBe("2003-03-07")

    // Today (Prague) before the fixing: open, pointing at an earlier one; once published, it moves and closes.
    const yesterday = new Date(Date.parse(`${pragueToday}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    await admin`delete from budget_fx_days where day >= ${yesterday}`
    await asApp(null, (sql) => sql`select app.budget_fx_save_daily(${pragueToday}, ${yesterday}, '{XTA}', '{1}', '{3}')`)
    const [open] = await admin`select fixing_date::text, final from budget_fx_days where day = ${pragueToday}`
    expect(open).toEqual({ fixing_date: yesterday, final: false })
    await asApp(null, (sql) => sql`select app.budget_fx_save_daily(${pragueToday}, ${pragueToday}, '{XTA}', '{1}', '{3.1}')`)
    const [closed] = await admin`select fixing_date::text, final from budget_fx_days where day = ${pragueToday}`
    expect(closed).toEqual({ fixing_date: pragueToday, final: true })
    // A fixing with only XTA must not stand for today in the tests below.
    await admin`delete from budget_fx_days where day >= ${yesterday}`
  })
})

describe("budget fx: fetching and caching", () => {
  it("covers a weekend with one request and never asks for a final day again", async () => {
    const stub = stubCnb()
    // Fri 7, Sat 8, Sun 9 Mar 2004: asking for Sunday answers Friday, which covers all three.
    await ensureRates(
      ["2004-03-05", "2004-03-06", "2004-03-07"].map((day) => ({ currency: "EUR", day })),
      "CZK",
    )
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toMatch(/date=07\.03\.2004$/)
    const days = await admin`select day::text, fixing_date::text, final from budget_fx_days where day between '2004-03-05' and '2004-03-07' order by day`
    expect(days).toEqual([
      { day: "2004-03-05", fixing_date: "2004-03-05", final: true },
      { day: "2004-03-06", fixing_date: "2004-03-05", final: true },
      { day: "2004-03-07", fixing_date: "2004-03-05", final: true },
    ])
    await ensureRates([{ currency: "USD", day: "2004-03-06" }], "CZK")
    expect(stub.calls).toHaveLength(1)
  })

  it("shares one request between concurrent callers", async () => {
    const stub = stubCnb()
    stub.delayMs = 50
    await Promise.all([ensureRates([{ currency: "EUR", day: "2004-03-10" }], "CZK"), ensureRates([{ currency: "EUR", day: "2004-03-10" }], "CZK")])
    expect(stub.calls.filter((u) => u.includes("10.03.2004"))).toHaveLength(1)
  })

  it("fetches the monthly list for currencies outside the daily fixing", async () => {
    const stub = stubCnb()
    await ensureRates([{ currency: "KZT", day: "2004-03-10" }], "CZK")
    // The day is known already; only March's list (declared in February) is fetched.
    expect(stub.calls).toEqual([expect.stringMatching(/fx_rates\.txt\?year=2004&month=2$/)])
    const [kzt] = await admin`select units, rate::text from budget_fx_rates where source = 'monthly' and valid_on = '2004-03-01' and currency = 'KZT'`
    expect(kzt).toEqual({ units: 100, rate: "4.000000" })
  })

  it("doesn't break or hammer ČNB when it is down", async () => {
    const stub = stubCnb()
    stub.fail = true
    await expect(ensureRates([{ currency: "EUR", day: "2004-03-16" }], "CZK")).resolves.toBeUndefined()
    const after = stub.calls.length
    expect(after).toBeGreaterThan(0)
    // Cooling down: nothing is asked for a while.
    await ensureRates([{ currency: "EUR", day: "2004-03-17" }], "CZK")
    expect(stub.calls.length).toBe(after)
  })
})

describe("budget fx: converted amounts in the actions", () => {
  const month = "2004-02"
  let accounts: Record<string, string> = {}

  beforeAll(async () => {
    stubCnb()
    await asAlice(() => actions.ensureSetup.handler({}))
    const make = async (currency: string) => {
      const [row] = await admin`
        insert into budget_accounts (owner_id, name, currency, opening_balance_minor, opened_on)
        values (${alice}, ${`${currency} account`}, ${currency}, 0, '2004-01-01') returning id`
      return row!.id as string
    }
    accounts = { CZK: await make("CZK"), EUR: await make("EUR"), KZT: await make("KZT"), XTS: await make("XTS") }
    const [food] = await admin`select id from budget_categories where owner_id = ${alice} and name = 'Food' and kind = 'expense'`
    const add = (currency: string, amount: number, day: string) =>
      admin`
        insert into budget_transactions (owner_id, account_id, category_id, amount_minor, occurred_on, note)
        values (${alice}, ${accounts[currency]!}, ${amount < 0 ? food!.id : null}, ${amount}, ${day}, 'fx test')`
    await add("CZK", -10000, "2004-02-02") // 100 CZK
    await add("EUR", -1000, "2004-02-07") // 10 EUR on a Saturday: Friday's 25.000 → 250 CZK
    await add("EUR", 2000, "2004-02-09") // +20 EUR → +500 CZK
    await add("KZT", -500000, "2004-02-10") // 5 000 KZT at 4.000 per 100 → 200 CZK
    await add("XTS", -999, "2004-02-11") // no rate anywhere
  })

  it("counts other currencies in the month's totals and keeps the rest apart", async () => {
    const o = await asAlice(() => actions.overview.handler({ month }))
    expect(o.baseCurrency).toBe("CZK")
    expect(o.expenseMinor).toBe(10000 + 25000 + 20000)
    expect(o.incomeMinor).toBe(50000)
    expect(o.netMinor).toBe(50000 - 55000)
    expect(o.savingsRate).toBe(-10)
    expect(o.spending).toEqual([expect.objectContaining({ name: "Food", amountMinor: 55000 })])
    expect(o.convertedCurrencies).toEqual([
      { currency: "EUR", incomeMinor: 2000, expenseMinor: 1000, baseIncomeMinor: 50000, baseExpenseMinor: 25000 },
      { currency: "KZT", incomeMinor: 0, expenseMinor: 500000, baseIncomeMinor: 0, baseExpenseMinor: 20000 },
    ])
    expect(o.otherCurrencies).toEqual([{ currency: "XTS", incomeMinor: 0, expenseMinor: 999 }])
    expect(o.fx).toEqual({ source: "ČNB", rateOn: "2004-02-09", approximate: false, converted: ["EUR", "KZT"], unavailable: ["XTS"] })
    expect(o.transactionCount).toBe(5)
    // Balances at today's rate; the XTS account has none.
    const eur = o.accounts.find((a) => a.id === accounts.EUR)!
    expect(eur.balanceMinor).toBe(1000)
    // Today's rate may already be cached for real (first write wins): read it back.
    expect(eur.baseBalance).toMatchObject({ currency: "CZK", approximate: false })
    const [today] = await admin`select rate::float8 as rate, units from budget_fx_rates where source = 'daily' and currency = 'EUR' and valid_on = ${eur.baseBalance!.rateOn}`
    expect(eur.baseBalance!.minor).toBe(Math.round((1000 * today!.rate) / today!.units))
    expect(o.accounts.find((a) => a.id === accounts.XTS)!.baseBalance).toBeNull()
    expect(o.accounts.find((a) => a.id === accounts.CZK)!.baseBalance).toBeUndefined()
  })

  it("puts the base amount on each foreign transaction and keeps the original", async () => {
    const rows = await asAlice(() => actions.listTransactions.handler({ month, limit: 50 }))
    const byCurrency = Object.fromEntries(rows.map((r) => [`${r.currency}${r.amountMinor}`, r.baseAmount]))
    expect(byCurrency["EUR-1000"]).toEqual({ minor: -25000, currency: "CZK", rateOn: "2004-02-06", approximate: false })
    expect(byCurrency["KZT-500000"]).toEqual({ minor: -20000, currency: "CZK", rateOn: "2004-02-01", approximate: false })
    expect(byCurrency["XTS-999"]).toBeNull()
    expect(byCurrency["CZK-10000"]).toBeUndefined()
  })

  it("answers fxRate, crossing through CZK", async () => {
    const eurCzk = await asAlice(() => actions.fxRate.handler({ currency: "EUR", date: "2004-02-07", amountMinor: 1299 }))
    expect(eurCzk).toEqual({ currency: "EUR", to: "CZK", date: "2004-02-07", rate: 25, rateOn: "2004-02-06", source: "daily", approximate: false, amountMinor: 1299, convertedMinor: 32475 })
    const usdEur = await asAlice(() => actions.fxRate.handler({ currency: "USD", to: "EUR", date: "2004-02-07" }))
    expect(usdEur).toMatchObject({ rate: 0.8, rateOn: "2004-02-06", approximate: false })
    expect(await asAlice(() => actions.fxRate.handler({ currency: "XTS", date: "2004-02-07" }))).toBeNull()
  })

  it("counts converted spending against limits", async () => {
    const data = await asAlice(() => actions.limits.handler({ month }))
    const food = data.withoutLimit.find((x) => x.name === "Food")
    expect(food).toBeDefined()
    expect(data.fx.converted).toEqual(["EUR", "KZT"])
    expect(data.fx.unavailable).toEqual(["XTS"])
    const march = await asAlice(() => actions.limits.handler({ month: "2004-03" }))
    // February's 550 CZK (converted included) averaged over three months.
    expect(march.withoutLimit.find((x) => x.name === "Food")!.averageMinor).toBe(Math.round(55000 / 3))
  })

  it("fills the shared cache even for a read-only API token", async () => {
    stubCnb()
    await admin`delete from budget_fx_days where day = '2004-02-16'`
    await admin`
      insert into budget_transactions (owner_id, account_id, amount_minor, occurred_on, note)
      values (${alice}, ${accounts.EUR!}, -400, '2004-02-16', 'fx token test')`
    const rows = await withApiToken({ id: "00000000-0000-4000-8000-000000000000", write: false }, () =>
      asAlice(() => actions.listTransactions.handler({ from: "2004-02-16", to: "2004-02-16", limit: 5 })),
    )
    expect(rows[0]!.baseAmount).toMatchObject({ minor: -10000, rateOn: "2004-02-16", approximate: false })
  })
})
