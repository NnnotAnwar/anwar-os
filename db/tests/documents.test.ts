// Documents: RLS on documents_documents and documents_files, the module actions
// (create / update / renew / delete, attaching Files items) and the osbot
// endpoints (/api/internal/osbot/documents/*) end to end: expiry reminders
// going out once, late, and "Remind tomorrow". `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

// The handlers start with `await connection()`; outside Next it is stubbed.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}))

const SECRET = `documents-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const routes = await import("@/modules/documents/osbot-routes")
const { actions, DocumentInputError } = await import("@/modules/documents/actions")
const { actAs, loadViewer } = await import("@/core/auth")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-documents-alice-${run}`
const bob = `test-documents-bob-${run}`
const marker = `doc-${run}`

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

type Handler = (request: Request) => Promise<Response>

async function call(handler: Handler, method: "GET" | "POST", path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const response = await handler(
    new Request(`http://127.0.0.1:3303${path}`, {
      method,
      headers: { "content-type": "application/json", ...signedHeaders(SECRET, { method, path, body: raw }) },
      body: method === "POST" ? raw : undefined,
    }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

async function insertFile(owner: string, name: string) {
  const [row] = await as(owner, (sql) => sql<{ id: string }[]>`
    insert into files_files (name, size_bytes, mime, storage_key)
    values (${name}, 1234, 'application/pdf', ${`${owner}/${crypto.randomUUID()}`}) returning id`)
  return row!.id
}

let aliceDoc = ""
let bobDoc = ""
let aliceFile = ""
let bobFile = ""

beforeAll(async () => {
  for (const id of [alice, bob]) {
    await admin`
      insert into auth."user" (id, name, email, email_verified)
      values (${id}, ${id}, ${`${id}@test.local`}, true)`
  }
  ;[{ id: aliceDoc }] = await as(alice, (sql) => sql<{ id: string }[]>`
    insert into documents_documents (name, kind, expires_on) values (${`Passport ${marker}`}, 'passport', '2030-05-01') returning id`)
  ;[{ id: bobDoc }] = await as(bob, (sql) => sql<{ id: string }[]>`
    insert into documents_documents (name, expires_on) values (${`Visa ${marker}`}, '2027-01-01') returning id`)
  aliceFile = await insertFile(alice, `passport-${marker}.pdf`)
  bobFile = await insertFile(bob, `visa-${marker}.pdf`)
})

afterAll(async () => {
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await admin`delete from documents_documents where name like ${`%${marker}%`}`
  await Promise.all([admin.end(), app.end()])
})

describe("documents RLS", () => {
  it("creates a document for the viewer with the default reminders", async () => {
    const [doc] = await as(alice, (sql) => sql`
      select owner_id, kind, reminder_days, history, snoozed_until, notes from documents_documents where id = ${aliceDoc}`)
    expect(doc).toEqual({ owner_id: alice, kind: "passport", reminder_days: [90, 30, 7, 0], history: [], snoozed_until: null, notes: "" })
  })

  it("hides one user's documents and links from another and from anonymous sessions", async () => {
    await as(alice, (sql) => sql`insert into documents_files (document_id, file_id) values (${aliceDoc}, ${aliceFile})`)
    const bobSees = await as(bob, (sql) => sql`
      select (select count(*)::int from documents_documents where owner_id = ${alice}) as documents,
             (select count(*)::int from documents_files where owner_id = ${alice}) as links`)
    expect(bobSees[0]).toEqual({ documents: 0, links: 0 })
    const anon = await as(null, (sql) => sql`
      select (select count(*)::int from documents_documents) + (select count(*)::int from documents_files) as n`)
    expect(anon[0]!.n).toBe(0)
  })

  it("never lets anyone else change or delete the owner's documents or links", async () => {
    const result = await as(bob, async (sql) => ({
      renamed: (await sql`update documents_documents set name = 'x' where id = ${aliceDoc}`).count,
      deleted: (await sql`delete from documents_documents where id = ${aliceDoc}`).count,
      unlinked: (await sql`delete from documents_files where document_id = ${aliceDoc}`).count,
    }))
    expect(result).toEqual({ renamed: 0, deleted: 0, unlinked: 0 })
    expect(await pgError(as(bob, (sql) => sql`insert into documents_documents (owner_id, name, expires_on) values (${alice}, 'x', '2030-01-01')`))).toBe(
      "42501",
    )
  })

  it("refuses linking someone else's file or document, even by a guessed id", async () => {
    // Bob's file on Alice's document: the insert policy requires the file to be hers.
    expect(await pgError(as(alice, (sql) => sql`insert into documents_files (document_id, file_id) values (${aliceDoc}, ${bobFile})`))).toBe("42501")
    // Her file on Bob's document: the (owner_id, document_id) foreign key refuses it.
    expect(await pgError(as(alice, (sql) => sql`insert into documents_files (document_id, file_id) values (${bobDoc}, ${aliceFile})`))).toBe("23503")
    expect(
      await pgError(as(alice, (sql) => sql`insert into documents_files (owner_id, document_id, file_id) values (${bob}, ${bobDoc}, ${bobFile})`)),
    ).toBe("42501")
  })

  it("can't edit a link (attach or detach only)", async () => {
    expect(await pgError(as(alice, (sql) => sql`update documents_files set file_id = ${aliceFile} where document_id = ${aliceDoc}`))).toBe("42501")
  })

  it("checks kinds, dates, reminder days, notes and history", async () => {
    const bad = (values: string) => pgError(as(alice, (sql) => sql.unsafe(`insert into documents_documents ${values}`)))
    expect(await bad(`(name, kind, expires_on) values ('x', 'credit_card', '2030-01-01')`)).toBe("23514")
    expect(await bad(`(name, expires_on, issued_on) values ('x', '2030-01-01', '2030-01-02')`)).toBe("23514")
    expect(await bad(`(name, expires_on, reminder_days) values ('x', '2030-01-01', '{-1}')`)).toBe("23514")
    expect(await bad(`(name, expires_on, reminder_days) values ('x', '2030-01-01', '{731}')`)).toBe("23514")
    expect(await bad(`(name, expires_on, reminder_days) values ('x', '2030-01-01', '{1,2,3,4,5,6,7,8,9}')`)).toBe("23514")
    expect(await bad(`(name, expires_on, reminder_days) values ('x', '2030-01-01', '{1,null}')`)).toBe("23514")
    expect(await bad(`(name, expires_on, notes) values ('x', '2030-01-01', repeat('n', 501))`)).toBe("23514")
    expect(await bad(`(name, expires_on, history) values ('x', '2030-01-01', '{}')`)).toBe("23514")
    expect(await bad(`(name, expires_on) values ('', '2030-01-01')`)).toBe("23514")
    expect(await bad(`(name) values ('x')`)).toBe("23502")
  })

  it("deleting a file removes the link; deleting a document keeps the file", async () => {
    const extra = await insertFile(alice, `scan-${marker}.pdf`)
    await as(alice, (sql) => sql`insert into documents_files (document_id, file_id) values (${aliceDoc}, ${extra})`)
    await as(alice, (sql) => sql`delete from files_files where id = ${extra}`)
    const [links] = await admin`select count(*)::int as n from documents_files where file_id = ${extra}`
    expect(links!.n).toBe(0)

    const [{ id }] = await as(alice, (sql) => sql<{ id: string }[]>`
      insert into documents_documents (name, expires_on) values (${`Gone ${marker}`}, '2030-01-01') returning id`)
    await as(alice, (sql) => sql`insert into documents_files (document_id, file_id) values (${id}, ${aliceFile})`)
    await as(alice, (sql) => sql`delete from documents_documents where id = ${id}`)
    const [file] = await admin`select count(*)::int as n from files_files where id = ${aliceFile}`
    expect(file!.n).toBe(1)
  })

  it("accepts the 'document' kind in osbot_deliveries", async () => {
    await as(alice, (sql) => sql`insert into osbot_deliveries (kind, key) values ('document', ${`${aliceDoc}:2030-05-01:90`})`)
    const [row] = await admin`select count(*)::int as n from osbot_deliveries where owner_id = ${alice} and kind = 'document'`
    expect(row!.n).toBe(1)
  })
})

describe("documents actions (as a signed-in viewer)", () => {
  const asAlice = async <T>(fn: () => Promise<T>) => actAs((await loadViewer(alice))!, fn)

  it("creates with attached files, lists soonest expiry first and finds by name or kind", async () => {
    const created = await asAlice(() =>
      actions.create.handler({
        name: `Residence permit ${marker}`,
        kind: "residence_permit",
        expiresOn: "2027-03-01",
        issuedOn: "2025-03-01",
        notes: "MV ČR",
        reminderDays: [60, 7],
        fileIds: [aliceFile],
      }),
    )
    expect(created).toMatchObject({ name: `Residence permit ${marker}`, reminderDays: [60, 7], fileCount: 1 })
    expect(created.files.map((f) => f.id)).toEqual([aliceFile])

    const { documents } = await asAlice(() => actions.list.handler({ query: marker, limit: 10 }))
    expect(documents.map((d) => d.name)).toEqual([`Residence permit ${marker}`, `Passport ${marker}`])
    const { documents: visas } = await asAlice(() => actions.list.handler({ query: "visa", limit: 50 }))
    expect(visas.map((d) => d.id)).toContain(created.id)
    expect(visas.map((d) => d.id)).not.toContain(bobDoc)
  })

  it("won't attach Bob's file", async () => {
    await expect(
      asAlice(() => actions.update.handler({ id: aliceDoc, fileIds: [aliceFile, bobFile] })),
    ).rejects.toBeInstanceOf(DocumentInputError)
  })

  it("updates only what's given and restarts reminders when the date changes", async () => {
    await admin`update documents_documents set reminders_from = '2020-01-01', snoozed_until = '2030-01-01' where id = ${aliceDoc}`
    const notesOnly = await asAlice(() => actions.update.handler({ id: aliceDoc, notes: "In the drawer" }))
    expect(notesOnly).toMatchObject({ notes: "In the drawer", expiresOn: "2030-05-01", snoozedUntil: "2030-01-01" })
    const [kept] = await admin`select reminders_from::text as d from documents_documents where id = ${aliceDoc}`
    expect(kept!.d).toBe("2020-01-01")

    const moved = await asAlice(() => actions.update.handler({ id: aliceDoc, expiresOn: "2030-06-01", fileIds: [] }))
    expect(moved).toMatchObject({ expiresOn: "2030-06-01", snoozedUntil: null, fileCount: 0 })
    const [restarted] = await admin`select reminders_from::text as d from documents_documents where id = ${aliceDoc}`
    expect(restarted!.d).not.toBe("2020-01-01")

    await expect(asAlice(() => actions.update.handler({ id: aliceDoc, issuedOn: "2031-01-01" }))).rejects.toThrow(/issue date/)
  })

  it("renews: keeps the old dates in the history and only moves forward", async () => {
    await expect(asAlice(() => actions.renew.handler({ id: aliceDoc, expiresOn: "2030-01-01", issuedOn: null, addFileIds: [] }))).rejects.toThrow(
      /later than the current one/,
    )
    const renewed = await asAlice(() =>
      actions.renew.handler({ id: aliceDoc, expiresOn: "2040-06-01", issuedOn: "2030-05-20", addFileIds: [aliceFile] }),
    )
    expect(renewed).toMatchObject({ expiresOn: "2040-06-01", issuedOn: "2030-05-20", fileCount: 1 })
    expect(renewed.history).toEqual([{ expiresOn: "2030-06-01", issuedOn: null, renewedOn: renewed.today }])
  })

  it("lists what's coming up, and deletes", async () => {
    const soon = await asAlice(() => actions.create.handler({ name: `Insurance ${marker}`, kind: "insurance", expiresOn: "2000-01-01", issuedOn: null, notes: "", reminderDays: [], fileIds: [] }))
    const { documents } = await asAlice(() => actions.upcoming.handler({ days: 90, includeExpired: true }))
    expect(documents.find((d) => d.id === soon.id)?.status.tone).toBe("expired")
    const { documents: notExpired } = await asAlice(() => actions.upcoming.handler({ days: 90, includeExpired: false }))
    expect(notExpired.map((d) => d.id)).not.toContain(soon.id)
    expect(await asAlice(() => actions.delete.handler({ id: soon.id }))).toEqual({ deleted: 1 })
    expect(await asAlice(() => actions.get.handler({ id: soon.id }))).toBeNull()
    expect(await asAlice(() => actions.get.handler({ id: bobDoc }))).toBeNull()
  })
})

describe("osbot documents API (as the site owner)", () => {
  let owner = ""
  let createdOwner = false
  let due = ""
  let quiet = ""
  let expiresOn = ""

  beforeAll(async () => {
    const [row] = await admin`select app.site_owner_id() as id`
    if (row?.id) owner = row.id
    else {
      owner = `test-documents-owner-${run}`
      createdOwner = true
      await admin`
        insert into auth."user" (id, name, email, email_verified, role)
        values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
    }
    // The 30-day mark was two days ago (whatever the owner's zone): due now, late.
    ;[{ id: due, expires_on: expiresOn }] = await admin<{ id: string; expires_on: string }[]>`
      insert into documents_documents (owner_id, name, kind, expires_on, reminder_days, reminders_from)
      values (${owner}, ${`Residence permit ${marker}`}, 'residence_permit', current_date + 28, '{30}', '2020-01-01')
      returning id, expires_on::text`
    // Same, but its reminders were set today: the passed mark is never sent.
    ;[{ id: quiet }] = await admin<{ id: string }[]>`
      insert into documents_documents (owner_id, name, expires_on, reminder_days, reminders_from)
      values (${owner}, ${`Fresh ${marker}`}, current_date + 28, '{30}', current_date + 1) returning id`
  })

  afterAll(async () => {
    await admin`delete from documents_documents where id in (${due}, ${quiet})`
    await admin`delete from osbot_deliveries where kind = 'document' and key like ${`${due}:%`}`
    if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mine = (items: Record<string, any>[]) => items.filter((i) => i.id === due || i.id === quiet || i.id === bobDoc)

  it("rejects unsigned requests", async () => {
    const response = await routes.documentRemindersDueGET(new Request("http://127.0.0.1:3303/api/internal/osbot/documents/reminders/due"))
    expect(response.status).toBe(401)
  })

  it("sends a missed reminder late, once, with links to open and renew", async () => {
    const first = await call(routes.documentRemindersDueGET, "GET", "/api/internal/osbot/documents/reminders/due")
    expect(first.status).toBe(200)
    expect(first.json.reminderTime).toBe("10:00")
    const items = mine(first.json.items)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: due,
      name: `Residence permit ${marker}`,
      kind: "residence_permit",
      kindLabel: "Residence permit / visa",
      emoji: "🪪",
      expiresOn,
      stage: "30",
      late: true,
      snoozed: false,
      keys: [`${due}:${expiresOn}:30`],
    })
    expect([27, 28, 29]).toContain(items[0].daysLeft)
    expect(items[0].url).toMatch(new RegExp(`/app/documents/${due}$`))
    expect(items[0].renewUrl).toMatch(new RegExp(`/app/documents/${due}\\?renew=1$`))

    const ack = await call(routes.documentRemindersAckPOST, "POST", "/api/internal/osbot/documents/reminders/ack", { keys: items[0].keys })
    expect(ack.json.acked).toBe(1)
    const repeat = await call(routes.documentRemindersAckPOST, "POST", "/api/internal/osbot/documents/reminders/ack", { keys: items[0].keys })
    expect(repeat.json.acked).toBe(0)

    const again = await call(routes.documentRemindersDueGET, "GET", "/api/internal/osbot/documents/reminders/due")
    expect(mine(again.json.items)).toEqual([])
  })

  it("never acks or shows Bob's documents", async () => {
    const ack = await call(routes.documentRemindersAckPOST, "POST", "/api/internal/osbot/documents/reminders/ack", {
      keys: [`${bobDoc}:2027-01-01:30`],
    })
    expect(ack.json.acked).toBe(0)
    const bad = await call(routes.documentRemindersAckPOST, "POST", "/api/internal/osbot/documents/reminders/ack", { keys: ["nope"] })
    expect(bad.status).toBe(400)
  })

  it("Remind tomorrow: one more card on the owner's next day", async () => {
    const snooze = await call(routes.documentSnoozePOST, "POST", "/api/internal/osbot/documents/snooze", { id: due })
    expect(snooze.status).toBe(200)
    expect(snooze.json).toMatchObject({ id: due, time: "10:00" })
    const [row] = await admin`select snoozed_until::text as d from documents_documents where id = ${due}`
    expect(row!.d).toBe(snooze.json.snoozedUntil)

    // Pretend tomorrow has come (the bot was down, even): the snoozed card is due once.
    await admin`update documents_documents set snoozed_until = current_date - 2 where id = ${due}`
    const first = await call(routes.documentRemindersDueGET, "GET", "/api/internal/osbot/documents/reminders/due")
    const [card] = mine(first.json.items)
    expect(card).toMatchObject({ id: due, stage: "snooze", snoozed: true })
    await call(routes.documentRemindersAckPOST, "POST", "/api/internal/osbot/documents/reminders/ack", { keys: card.keys })
    const again = await call(routes.documentRemindersDueGET, "GET", "/api/internal/osbot/documents/reminders/due")
    expect(mine(again.json.items)).toEqual([])
  })

  it("says when the document is gone", async () => {
    const gone = await call(routes.documentSnoozePOST, "POST", "/api/internal/osbot/documents/snooze", { id: bobDoc })
    expect(gone.status).toBe(404)
    expect(gone.json.error).toBe("gone")
  })
})
