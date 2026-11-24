import { describe, expect, it } from "vitest"
import * as db from "@/db/schema/feedback"
import { contactFormInput, contactStatuses, contactTopics, replyHref } from "./schema"

describe("constants", () => {
  it("match the database schema", () => {
    expect(contactTopics).toEqual(db.contactTopics)
    expect(contactStatuses).toEqual(db.contactStatuses)
  })
})

const valid = { topic: "job", name: " Jana ", email: " Jana@Example.COM ", message: "We are hiring a developer." }

describe("contactFormInput", () => {
  it("trims, lower-cases the email and defaults the optional fields", () => {
    expect(contactFormInput.parse(valid)).toEqual({
      topic: "job",
      name: "Jana",
      email: "jana@example.com",
      company: "",
      message: "We are hiring a developer.",
      website: "",
      token: "",
    })
  })

  it.each([
    [{ topic: "spam" }, "topic"],
    [{ topic: "" }, "topic"],
    [{ name: "  " }, "name"],
    [{ email: "jana" }, "email"],
    [{ email: "" }, "email"],
    [{ message: "short" }, "message"],
    [{ message: "x".repeat(5001) }, "message"],
    [{ company: "x".repeat(121) }, "company"],
  ])("refuses %j", (patch, field) => {
    const result = contactFormInput.safeParse({ ...valid, ...patch })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path[0]).toBe(field)
  })
})

describe("replyHref", () => {
  it("answers by email with the topic as subject and the message quoted", () => {
    const href = replyHref({ email: "jana+jobs@example.com", name: "Jana Nováková", topic: "freelance", message: "Line 1\nLine 2" })
    const url = new URL(href)
    expect(url.protocol).toBe("mailto:")
    expect(decodeURIComponent(url.pathname)).toBe("jana+jobs@example.com")
    expect(url.searchParams.get("subject")).toBe("Re: Freelance project — anwar-os.com")
    expect(url.searchParams.get("body")).toBe("Hi Jana,\n\n\n\n> Line 1\n> Line 2")
  })
})
