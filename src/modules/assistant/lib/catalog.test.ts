import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineAction } from "@/core/module"
import { actionInput, buildCatalog, inputJsonSchema } from "./catalog"
import { cardDetails, cardTitle, chipLabel, chipSummary } from "./describe"

const noop = async () => null

const fake = {
  tasks: {
    search: defineAction({
      description: "Find tasks.",
      kind: "read",
      input: z.object({ query: z.string().min(1), limit: z.number().int().default(20) }),
      handler: noop,
    }),
    create: defineAction({
      description: "Create a task.",
      kind: "write",
      input: z.object({ title: z.string(), dueDate: z.string().optional() }),
      handler: noop,
    }),
    delete: defineAction({ description: "Delete a task.", kind: "write", input: z.object({ id: z.uuid() }), handler: noop }),
    reorder: defineAction({ description: "Reorder tasks.", kind: "write", input: z.object({ ids: z.array(z.uuid()) }), handler: noop }),
  },
  files: {
    downloadUrl: defineAction({ description: "Presigned URL.", kind: "read", input: z.object({ id: z.uuid() }), handler: noop }),
    odd: defineAction({ description: "Not an object.", kind: "read", input: z.string(), handler: noop }),
  },
  assistant: {
    secret: defineAction({ description: "Never a tool.", kind: "read", input: z.object({}), handler: noop }),
  },
}

const catalog = buildCatalog(
  Object.entries(fake).map(([moduleId, actions]) => ({ moduleId, actions })),
  ["assistant"],
)
const byName = Object.fromEntries(catalog.map((t) => [t.name, t]))

describe("buildCatalog", () => {
  it("offers reads, allow-listed writes and deletions; skips denied reads, other writes and excluded modules", () => {
    expect(catalog.map((t) => t.name)).toEqual(["files_odd", "tasks_create", "tasks_delete", "tasks_search"])
  })

  it("gates every write behind a confirm card, reads run directly", () => {
    expect(byName.tasks_search).toMatchObject({ kind: "read", confirm: false, destructive: false })
    expect(byName.tasks_create).toMatchObject({ kind: "write", confirm: true, destructive: false })
    expect(byName.tasks_delete).toMatchObject({ kind: "write", confirm: true, destructive: true })
    expect(byName.tasks_create!.description).toMatch(/^\[tasks\] Create a task\. Runs only after the user taps Confirm/)
    expect(byName.tasks_search!.description).toBe("[tasks] Find tasks.")
  })

  it("generates JSON Schema from the zod input (input side: defaults are optional)", () => {
    const schema = byName.tasks_search!.inputSchema
    expect(schema.type).toBe("object")
    expect(schema).not.toHaveProperty("$schema")
    expect(schema.properties).toMatchObject({ query: { type: "string", minLength: 1 }, limit: { type: "integer" } })
    expect(schema.required).toEqual(["query"])
    expect(byName.tasks_delete!.inputSchema.properties).toMatchObject({ id: { type: "string", format: "uuid" } })
  })

  it("wraps non-object inputs and unwraps them for the action", () => {
    const odd = byName.files_odd!
    expect(odd.wrapped).toBe(true)
    expect(odd.inputSchema).toMatchObject({ type: "object", required: ["input"], properties: { input: { type: "string" } } })
    expect(actionInput(odd, { input: "x" })).toBe("x")
    expect(actionInput(byName.tasks_search!, { query: "x" })).toEqual({ query: "x" })
  })

  it("is sorted by name so the cached prompt prefix never changes order", () => {
    const names = catalog.map((t) => t.name)
    expect(names).toEqual([...names].sort())
  })

  it("keeps an empty object schema valid", () => {
    expect(inputJsonSchema(z.object({})).schema).toMatchObject({ type: "object", properties: {} })
  })
})

describe("chips and cards", () => {
  it("labels reads and writes", () => {
    expect(chipLabel("tasks", "search", "read")).toBe("Searched tasks")
    expect(chipLabel("notes", "get", "read")).toBe("Opened note")
    expect(chipLabel("budget", "overview", "read")).toBe("Checked budget")
    expect(chipLabel("tasks", "create", "write")).toBe("Created task")
    expect(chipLabel("tasks", "schedule", "write")).toBe("Rescheduled task")
    expect(cardTitle("tasks", "create")).toBe("Create task")
    expect(cardTitle("notes", "delete")).toBe("Delete note")
    expect(cardTitle("budget", "quickAdd")).toBe("Add transaction")
    expect(cardTitle("inbox", "capture")).toBe("Capture to inbox")
  })

  it("summarises results", () => {
    expect(chipSummary("read", [1, 2, 3])).toBe("3 found")
    expect(chipSummary("read", { tasks: [], total: 0 })).toBe("none found")
    expect(chipSummary("read", null)).toBe("not found")
    expect(chipSummary("write", { id: "x", title: "Buy milk" })).toBe("Buy milk")
    expect(chipSummary("write", undefined)).toBeNull()
  })

  it("lists a write's fields for its card, without ids", () => {
    expect(cardDetails({ id: "a", title: "Call the bank", dueDate: "2026-11-25", dueTime: "10:00", amountMinor: -25000, pinned: false, tags: [] })).toEqual([
      { label: "Title", value: "Call the bank" },
      { label: "Due", value: "2026-11-25" },
      { label: "Time", value: "10:00" },
      { label: "Amount", value: "-250" },
      { label: "Pinned", value: "No" },
    ])
    expect(cardDetails("nope")).toEqual([])
  })
})
