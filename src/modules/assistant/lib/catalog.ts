import { z } from "zod"
import type { ActionDef } from "@/core/module"

// The assistant's tools are the modules' own typed actions (src/core/module.ts:
// defineAction): name `<module>_<action>`, the action's LLM-written description,
// and a JSON Schema generated from its zod input. Pure: unit-tested with fake
// actions (catalog.test.ts) and against every real action in db/tests.
//
// Policy:
// - read actions are offered unless listed in READ_DENY (secrets, internals);
// - write actions only when listed in WRITE_ALLOW, and every one of them needs
//   the owner's tap on a confirm card before it runs (engine.ts);
// - deletions are a separate, short list, shown as red "Delete" cards.

/** Reads that hand out secrets or internals, or are too noisy for a chat. */
export const READ_DENY = new Set([
  "files.downloadUrl", // presigned storage URL
  "calendar.getFeed", // private ICS feed URL with its token
  "budget.existingKeys", // CSV import internals
  "ops.logs", // raw container logs can carry secrets
  "ops.tags", // image registry listing
])

/** Writes the assistant may propose. Each one waits for a confirm card. */
export const WRITE_ALLOW = new Set([
  "tasks.create",
  "tasks.quickAdd",
  "tasks.update",
  "tasks.schedule",
  "tasks.complete",
  "tasks.reopen",
  "notes.create",
  "notes.update",
  "notes.setPinned",
  "calendar.create",
  "calendar.update",
  "budget.createTransaction",
  "budget.quickAdd",
  "budget.updateTransaction",
  "inbox.capture",
  "ideas.create",
  "ideas.setStatus",
  "links.create",
])

/** Deletions the assistant may propose: always confirmed, shown as destructive. */
export const DELETE_ALLOW = new Set(["tasks.delete", "notes.delete", "calendar.delete", "budget.deleteTransactions", "inbox.delete"])

export type ToolInfo = {
  /** API name: `<module>_<action>` (letters, digits, underscores). */
  name: string
  module: string
  action: string
  kind: "read" | "write"
  /** Writes: the owner confirms in the app before it runs. */
  confirm: boolean
  destructive: boolean
  description: string
  inputSchema: { type: "object"; [key: string]: unknown }
  /** The schema wasn't an object: the API sees { input: … } and we unwrap it. */
  wrapped: boolean
}

export type ModuleActions = { moduleId: string; actions: Record<string, ActionDef> }

const SUFFIX_CONFIRM = " Runs only after the user taps Confirm on a card in the app; the result says whether they confirmed or declined."

/** Zod input → JSON Schema the API accepts (an object at the top). */
export function inputJsonSchema(schema: z.ZodType): { schema: { type: "object"; [key: string]: unknown }; wrapped: boolean } {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>
  delete json.$schema
  if (json.type === "object") {
    if (!json.properties) json.properties = {}
    return { schema: json as { type: "object" }, wrapped: false }
  }
  return { schema: { type: "object", properties: { input: json }, required: ["input"], additionalProperties: false }, wrapped: true }
}

export function buildCatalog(modules: ModuleActions[], exclude: string[] = []): ToolInfo[] {
  const tools: ToolInfo[] = []
  for (const { moduleId, actions } of modules) {
    if (exclude.includes(moduleId)) continue
    for (const [action, def] of Object.entries(actions)) {
      const key = `${moduleId}.${action}`
      const isDelete = DELETE_ALLOW.has(key)
      if (def.kind === "read" ? READ_DENY.has(key) : !WRITE_ALLOW.has(key) && !isDelete) continue
      const name = `${moduleId}_${action}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64)
      const { schema, wrapped } = inputJsonSchema(def.input)
      const confirm = def.kind === "write"
      tools.push({
        name,
        module: moduleId,
        action,
        kind: def.kind,
        confirm,
        destructive: isDelete,
        description: `[${moduleId}] ${def.description}${confirm ? SUFFIX_CONFIRM : ""}`,
        inputSchema: schema,
        wrapped,
      })
    }
  }
  // Deterministic order: the tool list is the start of every prompt (and its cache key).
  return tools.sort((a, b) => a.name.localeCompare(b.name))
}

/** What the API's `input` becomes for the action (unwraps `{ input }` for non-object schemas). */
export function actionInput(tool: Pick<ToolInfo, "wrapped">, input: unknown): unknown {
  if (!tool.wrapped) return input
  return input && typeof input === "object" && "input" in input ? (input as { input: unknown }).input : undefined
}
