import { z } from "zod"
import type { ActionDef } from "@/core/module"

// MCP tools generated from the modules' typed actions (pure: unit-tested in
// tools.test.ts; served by src/core/mcp/server.ts).
//
//   <module>_<action>, e.g. notes_create, tasks_quickAdd. The description is
//   the action's own (written for an LLM), the input schema its zod schema as
//   JSON Schema. Read actions are always offered; write actions only to a
//   token with the write scope.
//
// Some modules and actions are never offered, whatever the token:
//   - ops, bots: the server control panel and bot registry (container
//     control, deploys, logs). A leaked token must not reach the server.
//   - secrets and plumbing: the private calendar feed URL (a credential of
//     its own), browser-only upload steps, the expense bot's import.

export const EXCLUDED_MODULES: ReadonlySet<string> = new Set(["ops", "bots"])

export const EXCLUDED_ACTIONS: ReadonlySet<string> = new Set([
  "calendar.getFeed",
  "calendar.rotateFeed",
  "calendar.disableFeed",
  "files.prepareUpload",
  "files.confirmUpload",
  "budget.existingKeys",
  "budget.importTransactions",
])

export type ToolSource = { moduleId: string; moduleName: string; actions: Record<string, ActionDef> }

export type JsonSchemaObject = { type: "object"; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown }

export type ToolSpec = {
  name: string
  title: string
  description: string
  kind: "read" | "write"
  moduleId: string
  action: string
  /** Input JSON Schema, always `type: "object"` as MCP requires. */
  inputSchema: JsonSchemaObject
  /** Arguments as sent → the action's input (validated). */
  parse: (args: unknown) => { success: true; data: unknown } | { success: false; error: string }
  run: (input: unknown) => Promise<unknown>
  destructive: boolean
}

/** MCP clients accept [A-Za-z0-9_-]{1,64} everywhere. */
export function toolName(moduleId: string, action: string): string {
  return `${moduleId}_${action}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as Record<string, unknown>
  delete json.$schema
  return json
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "Invalid input."
  const path = issue.path.join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}

/**
 * One tool for an action. Inputs that are objects are the arguments as they
 * are; anything else (a bare string, an array) is wrapped as `{ input: … }`.
 */
export function toolFor(source: ToolSource, action: string, def: ActionDef): ToolSpec {
  const schema = jsonSchema(def.input)
  const isObject = schema.type === "object"
  const inputSchema: JsonSchemaObject = isObject
    ? ({ ...schema, type: "object" } as JsonSchemaObject)
    : { type: "object", properties: { input: schema }, required: ["input"], additionalProperties: false }

  return {
    name: toolName(source.moduleId, action),
    title: `${source.moduleName}: ${action}`,
    description: `${def.description} (${source.moduleName}, ${def.kind === "read" ? "read-only" : "changes data"})`,
    kind: def.kind,
    moduleId: source.moduleId,
    action,
    inputSchema,
    destructive: def.kind === "write" && /^(delete|remove|archive|revoke|disable)/i.test(action),
    parse(args) {
      const raw = isObject ? (args ?? {}) : (args as { input?: unknown } | undefined)?.input
      const parsed = def.input.safeParse(raw)
      return parsed.success ? { success: true, data: parsed.data } : { success: false, error: firstIssue(parsed.error) }
    },
    run: (input) => def.handler(input),
  }
}

/**
 * Every tool a token may see: read actions always, write actions only with
 * `write`. Modules come already filtered to the ones the owner may use.
 * Actions whose schema can't be described as JSON Schema are skipped (and
 * reported through `onSkip`) rather than breaking the whole list.
 */
export function generateTools(sources: ToolSource[], { write }: { write: boolean }, onSkip?: (name: string, error: unknown) => void): ToolSpec[] {
  const tools: ToolSpec[] = []
  for (const source of sources) {
    if (EXCLUDED_MODULES.has(source.moduleId)) continue
    for (const [action, def] of Object.entries(source.actions)) {
      if (EXCLUDED_ACTIONS.has(`${source.moduleId}.${action}`)) continue
      if (def.kind === "write" && !write) continue
      try {
        tools.push(toolFor(source, action, def))
      } catch (error) {
        onSkip?.(toolName(source.moduleId, action), error)
      }
    }
  }
  return tools
}

const MAX_RESULT_CHARS = 60_000

/** A handler's result as tool text: JSON, cut to a size a model can use. */
export function resultText(result: unknown): string {
  if (result === undefined) return "Done."
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2)
  if (text.length <= MAX_RESULT_CHARS) return text
  return `${text.slice(0, MAX_RESULT_CHARS)}\n… (cut: ${text.length - MAX_RESULT_CHARS} more characters; ask for less, e.g. with a limit or a filter)`
}
