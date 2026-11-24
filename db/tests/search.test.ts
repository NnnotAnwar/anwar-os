// Global search end to end against Postgres: `pnpm test:db`.
//  - db/modules/search.sql applies cleanly (and again: it's idempotent) and its
//    trigram indexes serve infix ILIKE;
//  - runSearch() finds the viewer's rows in every module, amounts included,
//    within the per-module limits;
//  - nobody else's rows leak: the site owner's published links, ideas,
//    projects and CV never show up in another user's search.
// `admin` sets up fixtures; the providers run through the app's own pool
// (DATABASE_URL, os_app) as the viewer, via actAs().
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const { actAs, loadViewer } = await import("@/core/auth")
const { runSearch } = await import("@/core/search")
const { modules } = await import("@/modules/_registry")
type Viewer = NonNullable<Awaited<ReturnType<typeof loadViewer>>>

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
// A word no real row contains, so every hit below is a fixture.
const marker = `zq${run}`
const bob = `test-search-bob-${run}`
let owner = ""
let createdOwner = false
let ownerViewer: Viewer
let bobViewer: Viewer

function as<T>(viewer: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${viewer}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function applySearchSql() {
  const text = await readFile(new URL("../modules/search.sql", import.meta.url), "utf8")
  for (const statement of text.split("--> statement-breakpoint")) {
    if (statement.replace(/--.*$/gm, "").trim()) await admin.unsafe(statement)
  }
}

const provider = async (id: string) => (await modules.find((m) => m.id === id)!.search!())

beforeAll(async () => {
  await applySearchSql()

  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-search-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`
    insert into auth."user" (id, name, email, email_verified, role)
    values (${bob}, 'Bob', ${`${bob}@test.local`}, true, 'user')`
  ownerViewer = (await loadViewer(owner))!
  bobViewer = (await loadViewer(bob))!

  await as(owner, async (sql) => {
    await sql`insert into notes_notes (title, body) values (${`Plan ${marker}`}, 'first'), ('Groceries', ${`milk, ${marker} tea`})`
    // More than the overview shows, so "more" and the module filter are exercised.
    for (let i = 0; i < 6; i++) await sql`insert into notes_notes (title) values (${`Extra ${marker} ${i}`})`
    await sql`insert into tasks_tasks (title, notes) values (${`Call ${marker}`}, 'about the lease')`
    await sql`insert into inbox_items (text) values (${`Read ${marker} later`})`
    await sql`insert into calendar_events (title, start_at, end_at, location) values (${`Dentist ${marker}`}, now() + interval '2 days', now() + interval '2 days 1 hour', 'Prague')`
    await sql`insert into links_links (url, title, is_public) values (${`https://${marker}.example/public`}, ${`Public link ${marker}`}, true)`
    await sql`insert into links_links (url, title) values (${`https://${marker}.example/private`}, ${`Private link ${marker}`})`
    await sql`insert into ideas_ideas (title, is_public) values (${`Public idea ${marker}`}, true), (${`Private idea ${marker}`}, false)`
    await sql`insert into projects_projects (title, slug, is_public) values (${`Project ${marker}`}, ${`project-${marker}`}, true)`
    await sql`insert into cv_skills (name) values (${`Skill ${marker}`})`
    await sql`insert into files_documents (title, body) values ('Tax notes', ${`The ${marker} receipt is in the drawer`})`
    const [account] = await sql`insert into budget_accounts (name) values (${`Cash ${run}`}) returning id`
    await sql`
      insert into budget_transactions (account_id, amount_minor, occurred_on, note)
      values (${account!.id}, -25040, current_date, ${`Coffee ${marker}`}),
             (${account!.id}, 98765, current_date, 'Salary')`
  })
  await admin`insert into feedback_items (owner_id, kind, message, name) values (${owner}, 'suggestion', ${`Please add ${marker} mode`}, 'Eve')`

  // Bob's own published link: never part of the owner's results.
  await as(bob, (sql) => sql`insert into links_links (url, title, is_public) values (${`https://${marker}.example/bob`}, ${`Bob link ${marker}`}, true)`)
})

afterAll(async () => {
  const like = `%${marker}%`
  await admin`delete from notes_notes where title like ${like} or body like ${like}`
  await admin`delete from tasks_tasks where title like ${like}`
  await admin`delete from inbox_items where text like ${like}`
  await admin`delete from calendar_events where title like ${like}`
  await admin`delete from links_links where url like ${like}`
  await admin`delete from ideas_ideas where title like ${like}`
  await admin`delete from projects_projects where title like ${like}`
  await admin`delete from cv_skills where name like ${like}`
  await admin`delete from files_documents where body like ${like}`
  await admin`delete from feedback_items where message like ${like}`
  await admin`delete from budget_transactions where account_id in (select id from budget_accounts where name = ${`Cash ${run}`})`
  await admin`delete from budget_accounts where name = ${`Cash ${run}`}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("db/modules/search.sql", () => {
  it("is idempotent", async () => {
    await expect(applySearchSql()).resolves.toBeUndefined()
  })

  it("creates the trigram and amount indexes", async () => {
    const rows = await admin`select indexname from pg_indexes where schemaname = 'public' and indexname like '%trgm_idx' or indexname = 'budget_transactions_owner_abs_amount_idx'`
    const names = rows.map((r) => r.indexname)
    expect(names).toEqual(
      expect.arrayContaining([
        "notes_notes_title_trgm_idx",
        "notes_notes_body_trgm_idx",
        "files_documents_body_trgm_idx",
        "budget_transactions_note_trgm_idx",
        "budget_transactions_owner_abs_amount_idx",
      ]),
    )
  })

  it("lets the planner answer infix ILIKE from a trigram index", async () => {
    const plan = await admin.begin(async (sql) => {
      await sql`set local enable_seqscan = off`
      return sql`explain select id from notes_notes where body ilike ${`%${marker}%`}`
    })
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain("notes_notes_body_trgm_idx")
  })
})

describe("runSearch as the owner", () => {
  const search = (q: string, module?: string) => actAs(ownerViewer, () => runSearch(ownerViewer, q, { module }))

  it("finds the viewer's rows in every module", async () => {
    const { groups, failed } = await search(marker)
    expect(failed).toEqual([])
    expect(groups.map((g) => g.moduleId).sort()).toEqual(
      ["budget", "calendar", "cv", "feedback", "files", "ideas", "inbox", "links", "notes", "projects", "tasks"].sort(),
    )
  })

  it("never lists another user's published rows", async () => {
    const { groups } = await search(marker)
    const links = groups.find((g) => g.moduleId === "links")!.hits.map((h) => h.title)
    expect(links.sort()).toEqual([`Private link ${marker}`, `Public link ${marker}`])
  })

  it("ranks the exact title first and keeps each module to its overview limit", async () => {
    const { groups } = await search(`Plan ${marker}`)
    expect(groups[0]!.moduleId).toBe("notes")
    expect(groups[0]!.hits[0]!.title).toBe(`Plan ${marker}`)

    const notes = (await search(marker)).groups.find((g) => g.moduleId === "notes")!
    expect(notes.hits).toHaveLength(5)
    expect(notes.more).toBe(true)
  })

  it("shows every match when narrowed to one module", async () => {
    const { groups, module } = await search(marker, "notes")
    expect(module).toBe("notes")
    expect(groups.map((g) => g.moduleId)).toEqual(["notes"])
    expect(groups[0]!.hits).toHaveLength(8)
    expect(groups[0]!.more).toBe(false)
  })

  it("finds a body match with an excerpt around it", async () => {
    const { groups } = await search(marker, "notes")
    const groceries = groups[0]!.hits.find((h) => h.title === "Groceries")!
    expect(groceries.snippet).toContain(marker)
  })

  it("finds document text, feedback and calendar metadata", async () => {
    const { groups } = await search(marker)
    const doc = groups.find((g) => g.moduleId === "files")!.hits[0]!
    expect(doc.title).toBe("Tax notes")
    expect(doc.snippet).toContain(marker)
    expect(groups.find((g) => g.moduleId === "feedback")!.hits[0]!.meta).toContain("Eve")
    expect(groups.find((g) => g.moduleId === "calendar")!.hits[0]!.meta).toContain("Prague")
  })

  it("finds Budget transactions by note and by amount, with the amount on the side", async () => {
    const byNote = (await search(`coffee ${marker}`, "budget")).groups[0]!.hits
    expect(byNote.map((h) => h.title)).toEqual([`Coffee ${marker}`])
    expect(byNote[0]!.aside).toMatch(/250/)

    for (const q of ["250", "-250", "250,40", "250.4"]) {
      const titles = ((await search(q, "budget")).groups[0]?.hits ?? []).map((h) => h.title)
      expect(titles, q).toContain(`Coffee ${marker}`)
    }
    for (const q of ["+250", "250.41", "251"]) {
      const titles = ((await search(q, "budget")).groups[0]?.hits ?? []).map((h) => h.title)
      expect(titles, q).not.toContain(`Coffee ${marker}`)
    }
  })

  it("ignores an empty or overlong query", async () => {
    expect((await search("   ")).groups).toEqual([])
    expect((await search("x".repeat(101))).groups).toEqual([])
  })
})

describe("runSearch as another user", () => {
  it("finds none of the owner's rows, published ones included", async () => {
    const { groups } = await actAs(bobViewer, () => runSearch(bobViewer, marker))
    // Bob (role "user") searches the modules open to registered users.
    const hits = groups.flatMap((g) => g.hits.map((h) => `${g.moduleId}: ${h.title}`))
    expect(hits).toEqual([`links: Bob link ${marker}`])
  })

  it("gets nothing from the owner-only modules either, even asked directly", async () => {
    for (const id of ["projects", "cv", "ideas", "links", "budget", "files", "feedback", "calendar", "notes", "tasks", "inbox"]) {
      const search = await provider(id)
      const hits = await actAs(bobViewer, () => search(marker, 20))
      expect(
        hits.filter((h) => !h.title.startsWith("Bob")).map((h) => h.title),
        id,
      ).toEqual([])
    }
  })
})
