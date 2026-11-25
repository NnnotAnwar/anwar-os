import { describe, expect, it } from "vitest"
import { createDocumentInput, listDocumentsInput, renewDocumentInput, updateDocumentInput, upcomingInput } from "./schema"

const ID = "11111111-1111-4111-8111-111111111111"
const FILE = "33333333-3333-4333-8333-333333333333"

const issue = (result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.success ? null : { message: result.error!.issues[0]!.message, path: result.error!.issues[0]!.path.join(".") }

describe("createDocumentInput", () => {
  it("fills the defaults: kind other, reminders 90/30/7/0, nothing attached", () => {
    expect(createDocumentInput.parse({ name: "  Passport ", expiresOn: "2030-05-01" })).toEqual({
      name: "Passport",
      kind: "other",
      expiresOn: "2030-05-01",
      issuedOn: null,
      notes: "",
      reminderDays: [90, 30, 7, 0],
      fileIds: [],
    })
  })

  it("requires a name and a real expiry date", () => {
    expect(issue(createDocumentInput.safeParse({ name: " ", expiresOn: "2030-05-01" }))?.path).toBe("name")
    expect(issue(createDocumentInput.safeParse({ name: "Visa" }))?.path).toBe("expiresOn")
    expect(issue(createDocumentInput.safeParse({ name: "Visa", expiresOn: "2026-02-30" }))).toEqual({
      message: "Use a date like 2026-12-24.",
      path: "expiresOn",
    })
    expect(createDocumentInput.safeParse({ name: "x".repeat(81), expiresOn: "2030-05-01" }).success).toBe(false)
  })

  it("only knows the listed kinds", () => {
    expect(createDocumentInput.parse({ name: "Permit", kind: "residence_permit", expiresOn: "2030-05-01" }).kind).toBe("residence_permit")
    expect(createDocumentInput.safeParse({ name: "Card", kind: "credit_card", expiresOn: "2030-05-01" }).success).toBe(false)
  })

  it("refuses an issue date after the expiry date", () => {
    expect(issue(createDocumentInput.safeParse({ name: "ID", expiresOn: "2030-05-01", issuedOn: "2030-05-02" }))).toEqual({
      message: "The issue date can't be after the expiry date.",
      path: "issuedOn",
    })
    expect(createDocumentInput.safeParse({ name: "ID", expiresOn: "2030-05-01", issuedOn: "2030-05-01" }).success).toBe(true)
  })

  it("normalizes reminder days and keeps them in range", () => {
    const parsed = createDocumentInput.parse({ name: "ID", expiresOn: "2030-05-01", reminderDays: [7, 30, 7, 0] })
    expect(parsed.reminderDays).toEqual([30, 7, 0])
    expect(createDocumentInput.parse({ name: "ID", expiresOn: "2030-05-01", reminderDays: [] }).reminderDays).toEqual([])
    expect(createDocumentInput.safeParse({ name: "ID", expiresOn: "2030-05-01", reminderDays: [-1] }).success).toBe(false)
    expect(createDocumentInput.safeParse({ name: "ID", expiresOn: "2030-05-01", reminderDays: [731] }).success).toBe(false)
    expect(createDocumentInput.safeParse({ name: "ID", expiresOn: "2030-05-01", reminderDays: [1.5] }).success).toBe(false)
    expect(createDocumentInput.safeParse({ name: "ID", expiresOn: "2030-05-01", reminderDays: [1, 2, 3, 4, 5, 6, 7, 8, 9] }).success).toBe(false)
  })

  it("caps notes and attached files, and dedupes files", () => {
    expect(createDocumentInput.safeParse({ name: "ID", expiresOn: "2030-05-01", notes: "x".repeat(501) }).success).toBe(false)
    expect(createDocumentInput.parse({ name: "ID", expiresOn: "2030-05-01", fileIds: [FILE, FILE] }).fileIds).toEqual([FILE])
    expect(createDocumentInput.safeParse({ name: "ID", expiresOn: "2030-05-01", fileIds: ["not-a-uuid"] }).success).toBe(false)
  })

  it("has no field for a document number", () => {
    expect(createDocumentInput.parse({ name: "Passport", expiresOn: "2030-05-01", number: "AB123456" })).not.toHaveProperty("number")
  })
})

describe("updateDocumentInput", () => {
  it("takes only the fields that change", () => {
    expect(updateDocumentInput.parse({ id: ID, notes: "Kept in the drawer" })).toEqual({ id: ID, notes: "Kept in the drawer" })
    expect(updateDocumentInput.parse({ id: ID, issuedOn: null })).toEqual({ id: ID, issuedOn: null })
  })

  it("checks dates it can see together", () => {
    expect(updateDocumentInput.safeParse({ id: ID, expiresOn: "2030-01-01", issuedOn: "2031-01-01" }).success).toBe(false)
    expect(updateDocumentInput.safeParse({ id: "x", name: "A" }).success).toBe(false)
  })
})

describe("renewDocumentInput", () => {
  it("needs the new expiry date; the issue date and new files are optional", () => {
    expect(renewDocumentInput.parse({ id: ID, expiresOn: "2031-12-24" })).toEqual({ id: ID, expiresOn: "2031-12-24", issuedOn: null, addFileIds: [] })
    expect(renewDocumentInput.safeParse({ id: ID }).success).toBe(false)
    expect(renewDocumentInput.safeParse({ id: ID, expiresOn: "2031-12-24", issuedOn: "2032-01-01" }).success).toBe(false)
  })
})

describe("list and upcoming inputs", () => {
  it("default sensibly", () => {
    expect(listDocumentsInput.parse({})).toEqual({ limit: 100 })
    expect(upcomingInput.parse({})).toEqual({ days: 90, includeExpired: true })
    expect(upcomingInput.safeParse({ days: -1 }).success).toBe(false)
  })
})
