import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { defineAction, type ActionDef } from "@/core/module"
import { EXCLUDED_MODULES, generateTools, resultText, toolFor, toolName, type ToolSource } from "./tools"

const notes: ToolSource = {
  moduleId: "notes",
  moduleName: "Notes",
  actions: {
    list: defineAction({
      description: "List the viewer's notes.",
      kind: "read",
      input: z.object({ query: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }),
      handler: async (input) => ({ input }),
    }),
    create: defineAction({
      description: "Create a note.",
      kind: "write",
      input: z.object({ title: z.string().min(1), body: z.string().default("") }),
      handler: async ({ title }) => ({ id: "n1", title }),
    }),
    delete: defineAction({
      description: "Delete a note.",
      kind: "write",
      input: z.object({ id: z.uuid() }),
      handler: async () => ({ ok: true }),
    }),
  } as Record<string, ActionDef>,
}

const calendar: ToolSource = {
  moduleId: "calendar",
  moduleName: "Calendar",
  actions: {
    range: defineAction({
      description: "Events between two instants.",
      kind: "read",
      input: z.object({ from: z.coerce.date(), to: z.coerce.date() }),
      handler: async ({ from }) => from.toISOString(),
    }),
    getFeed: defineAction({ description: "The private ICS URL.", kind: "read", input: z.object({}), handler: async () => "secret" }),
  } as Record<string, ActionDef>,
}

const ops: ToolSource = {
  moduleId: "ops",
  moduleName: "Ops",
  actions: {
    services: defineAction({ description: "Containers.", kind: "read", input: z.object({}), handler: async () => [] }),
    deploy: defineAction({ description: "Deploy.", kind: "write", input: z.object({ tag: z.string() }), handler: async () => null }),
  } as Record<string, ActionDef>,
}

const names = (write: boolean) => generateTools([notes, calendar, ops], { write }).map((t) => t.name)

describe("MCP tools from module actions", () => {
  it("offers read actions to every token and write actions only with the write scope", () => {
    expect(names(false)).toEqual(["notes_list", "calendar_range"])
    expect(names(true)).toEqual(["notes_list", "notes_create", "notes_delete", "calendar_range"])
  })

  it("never offers the server control panel or secret-bearing actions", () => {
    expect(EXCLUDED_MODULES.has("ops")).toBe(true)
    expect(EXCLUDED_MODULES.has("bots")).toBe(true)
    for (const write of [false, true]) {
      expect(names(write).some((n) => n.startsWith("ops_"))).toBe(false)
      expect(names(write)).not.toContain("calendar_getFeed")
    }
  })

  it("names tools <module>_<action> within MCP's character set", () => {
    expect(toolName("budget", "quickAdd")).toBe("budget_quickAdd")
    expect(toolName("weird.mod", "a b")).toBe("weird_mod_a_b")
    expect(toolName("m", "x".repeat(100))).toHaveLength(64)
  })

  it("describes each tool with the action's own description and its JSON Schema", () => {
    const [list] = generateTools([notes], { write: false })
    expect(list!.description).toContain("List the viewer's notes.")
    expect(list!.description).toContain("read-only")
    expect(list!.inputSchema).toMatchObject({
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
    })
    // Input io: defaulted fields are optional for the caller.
    expect(list!.inputSchema.required ?? []).not.toContain("limit")
    expect(list!.inputSchema.$schema).toBeUndefined()
    const range = generateTools([calendar], { write: false })[0]!
    expect(range.inputSchema.type).toBe("object")
    // JSON can't carry a Date: the range takes ISO strings.
    const parsed = range.parse({ from: "2026-11-01", to: "2026-12-31T23:00:00Z" })
    expect(parsed).toEqual({
      success: true,
      data: { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-31T23:00:00Z") },
    })
  })

  it("marks deletes as destructive and reads as read-only", () => {
    const tools = generateTools([notes], { write: true })
    expect(tools.find((t) => t.name === "notes_delete")!.destructive).toBe(true)
    expect(tools.find((t) => t.name === "notes_create")!.destructive).toBe(false)
    expect(tools.find((t) => t.name === "notes_list")!.kind).toBe("read")
  })

  it("validates arguments with the action's zod schema (defaults applied, no args = {})", () => {
    const [list, create] = generateTools([notes], { write: true })
    expect(list!.parse(undefined)).toEqual({ success: true, data: { limit: 20 } })
    expect(create!.parse({ title: "Hi" })).toEqual({ success: true, data: { title: "Hi", body: "" } })
    const bad = create!.parse({ title: "" })
    expect(bad.success).toBe(false)
    expect(!bad.success && bad.error).toMatch(/^title: /)
    expect(list!.parse({ limit: 500 }).success).toBe(false)
  })

  it("runs the action's handler", async () => {
    const [, create] = generateTools([notes], { write: true })
    await expect(create!.run({ title: "Hi", body: "" })).resolves.toEqual({ id: "n1", title: "Hi" })
  })

  it("wraps inputs that aren't objects as { input }", () => {
    const tool = toolFor(
      { moduleId: "x", moduleName: "X", actions: {} },
      "echo",
      defineAction({ description: "Echo.", kind: "read", input: z.string().min(1), handler: async (s) => s }) as ActionDef,
    )
    expect(tool.inputSchema).toMatchObject({ type: "object", properties: { input: { type: "string" } }, required: ["input"] })
    expect(tool.parse({ input: "hi" })).toEqual({ success: true, data: "hi" })
    expect(tool.parse({}).success).toBe(false)
  })

  it("skips an action whose schema can't be described instead of failing the list", () => {
    const onSkip = vi.fn()
    const broken: ToolSource = {
      moduleId: "x",
      moduleName: "X",
      actions: {
        ok: defineAction({ description: "Fine.", kind: "read", input: z.object({}), handler: async () => 1 }),
        bad: { description: "Broken.", kind: "read", input: { safeParse: () => ({}) } as unknown as z.ZodType, handler: async () => 1 },
      },
    }
    expect(generateTools([broken], { write: false }, onSkip).map((t) => t.name)).toEqual(["x_ok"])
    expect(onSkip).toHaveBeenCalledWith("x_bad", expect.anything())
  })

  it("renders results as JSON text, cut when huge", () => {
    expect(resultText(undefined)).toBe("Done.")
    expect(resultText("plain")).toBe("plain")
    expect(JSON.parse(resultText({ a: 1 }))).toEqual({ a: 1 })
    const big = resultText({ text: "x".repeat(100_000) })
    expect(big.length).toBeLessThan(61_000)
    expect(big).toContain("(cut:")
  })
})
