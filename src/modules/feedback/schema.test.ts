import { describe, expect, it } from "vitest"
import * as db from "@/db/schema/feedback"
import { contactHref, feedbackKinds, feedbackStatuses, formatWait, normalizeContact, preview, submitFeedbackInput } from "./schema"

describe("constants", () => {
  it("match the database schema", () => {
    expect(feedbackKinds).toEqual(db.feedbackKinds)
    expect(feedbackStatuses).toEqual(db.feedbackStatuses)
  })
})

const solution = {
  algorithm: "SHA-256" as const,
  challenge: "a".repeat(64),
  salt: "0123456789abcdef.1.2",
  signature: "b".repeat(64),
  number: 1,
}

describe("normalizeContact", () => {
  it.each([
    ["", ""],
    ["  ", ""],
    ["jana@example.com", "jana@example.com"],
    ["@jana_k", "@jana_k"],
    ["jana_k", "@jana_k"],
    ["https://t.me/jana_k", "@jana_k"],
    ["t.me/jana_k", "@jana_k"],
  ])("accepts %j", (raw, expected) => expect(normalizeContact(raw)).toBe(expected))

  it.each(["@abc", "not an email", "@1jana", "jana@", "+420 123 456"])("rejects %j", (raw) =>
    expect(normalizeContact(raw)).toBeNull(),
  )
})

describe("contactHref", () => {
  it("links emails and Telegram handles", () => {
    expect(contactHref("jana@example.com")).toBe("mailto:jana@example.com")
    expect(contactHref("@jana_k")).toBe("https://t.me/jana_k")
    expect(contactHref("whatever")).toBeNull()
  })
})

describe("submitFeedbackInput", () => {
  const base = { kind: "suggestion", message: "Please add a dark mode toggle.", solution }

  it("accepts an anonymous message", () => {
    expect(submitFeedbackInput.parse(base)).toMatchObject({ name: "", contact: "", website: "" })
  })

  it("explains how to fix each field", () => {
    const issues = (input: object) => submitFeedbackInput.safeParse({ ...base, ...input }).error?.issues[0]?.message
    expect(issues({ message: "short" })).toMatch(/at least 10/)
    expect(issues({ message: " ".repeat(20) })).toMatch(/at least 10/)
    expect(issues({ message: "x".repeat(5001) })).toMatch(/under 5000/)
    expect(issues({ kind: "rant" })).toMatch(/Pick what kind/)
    expect(issues({ contact: "call me" })).toMatch(/e\.g\. jana@example\.com/)
  })
})

describe("preview", () => {
  it("flattens and shortens", () => {
    expect(preview("a\n\nb   c")).toBe("a b c")
    expect(preview("x".repeat(200), 10)).toBe("xxxxxxxxx…")
  })
})

describe("formatWait", () => {
  it("counts minutes and seconds under an hour, hours and minutes above", () => {
    expect(formatWait(0)).toBe("0:00")
    expect(formatWait(45)).toBe("0:45")
    expect(formatWait(272.2)).toBe("4:33")
    expect(formatWait(600)).toBe("10:00")
    expect(formatWait(3600)).toBe("1 h")
    expect(formatWait(3600 * 3 + 12 * 60 - 5)).toBe("3 h 12 min")
    expect(formatWait(3600 * 2 - 10)).toBe("2 h")
  })
})
