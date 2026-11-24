import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { modulesFor, type ActionDef, type AppRole } from "@/core/module"
import { modules } from "@/modules/_registry"
import type { EngineTools } from "./engine"
import { actionInput, buildCatalog, inputJsonSchema, type ToolInfo } from "./lib/catalog"
import { cardDetails, cardTitle, truncate } from "./lib/describe"
import type { ConfirmCard } from "./lib/protocol"

// The live tool set for one viewer: every module they may use (modulesFor),
// its actions turned into tools (lib/catalog.ts), plus one cross-module search
// over the manifests' ⌘K providers. Handlers run inside the request's actAs()
// scope, so each action's own asViewer() applies RLS exactly as in the UI.

const SEARCH: ToolInfo = {
  name: "search_everything",
  module: "search",
  action: "everything",
  kind: "read",
  confirm: false,
  destructive: false,
  description:
    "[search] Search all of anwar.os at once (tasks, notes, events, budget, files, links, ideas, inbox...) like the ⌘K palette: matching titles with a short snippet and the app link, grouped by module. Use it when you don't know where something lives; then use that module's tools for details.",
  inputSchema: { type: "object" },
  wrapped: false,
}
const searchInput = z.object({
  query: z.string().trim().min(1).max(100).describe("Words to look for."),
  limit: z.number().int().min(1).max(10).default(5).describe("Hits per module."),
})
SEARCH.inputSchema = inputJsonSchema(searchInput).schema

/** Which action loads the item an id points at, for the confirm card ("Complete task: Pay rent"). */
const LOOKUP: Record<string, { action: string; label: string; pick: (row: Record<string, unknown>) => unknown }> = {
  tasks: { action: "get", label: "Task", pick: (r) => r.title },
  notes: { action: "get", label: "Note", pick: (r) => r.title },
  calendar: { action: "get", label: "Event", pick: (r) => r.title },
  ideas: { action: "get", label: "Idea", pick: (r) => r.title },
  inbox: { action: "get", label: "Item", pick: (r) => r.text },
  budget: { action: "getTransaction", label: "Transaction", pick: (r) => [r.note, r.categoryName].filter(Boolean).join(" · ") || null },
}

function issues(error: z.ZodError) {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ")
}

export async function loadTools(role: AppRole): Promise<EngineTools> {
  const usable = modulesFor(modules, role).filter((m) => m.id !== "assistant")
  const loaded = await Promise.all(
    usable.map(async (m) => ({ moduleId: m.id, actions: m.actions ? await m.actions() : {}, search: m.search })),
  )
  const actionsOf = new Map<string, Record<string, ActionDef>>(loaded.map((l) => [l.moduleId, l.actions]))
  const catalog = [...buildCatalog(loaded), SEARCH].sort((a, b) => a.name.localeCompare(b.name))
  const byName = new Map(catalog.map((t) => [t.name, t]))
  const actionOf = (tool: ToolInfo) => actionsOf.get(tool.module)?.[tool.action]

  async function lookup(module: string, id: string): Promise<string | null> {
    const how = LOOKUP[module]
    const get = how && actionsOf.get(module)?.[how.action]
    if (!how || !get) return null
    try {
      const row = await get.handler(get.input.parse({ id }))
      const value = row && typeof row === "object" ? how.pick(row as Record<string, unknown>) : null
      return typeof value === "string" && value.trim() ? truncate(value.trim(), 80) : null
    } catch {
      return null
    }
  }

  async function budgetName(kind: "listCategories" | "listAccounts", id: unknown) {
    const list = actionsOf.get("budget")?.[kind]
    if (!list || typeof id !== "string") return null
    try {
      const rows = (await list.handler(list.input.parse({ includeArchived: true }))) as { id: string; name: string }[]
      return rows.find((r) => r.id === id)?.name ?? null
    } catch {
      return null
    }
  }

  return {
    definitions: catalog.map(
      (t): Anthropic.Beta.Messages.BetaTool => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
        // Streamed requests: inputs arrive as generated; validate() checks them before anything runs.
        eager_input_streaming: true,
      }),
    ),

    info: (name) => byName.get(name),

    validate(tool, input) {
      const schema = tool === SEARCH ? searchInput : actionOf(tool)?.input
      if (!schema) return { ok: false, error: `${tool.name} is not available.` }
      const parsed = schema.safeParse(actionInput(tool, input))
      return parsed.success ? { ok: true, input: parsed.data } : { ok: false, error: issues(parsed.error) }
    },

    async execute(tool, input) {
      if (tool === SEARCH) {
        const { query, limit } = input as z.infer<typeof searchInput>
        const groups = await Promise.all(
          loaded
            .filter((l) => l.search)
            .map(async (l) => {
              try {
                const provider = await l.search!()
                const hits = await provider(query, limit)
                return hits.length ? { module: l.moduleId, hits } : null
              } catch {
                return null
              }
            }),
        )
        return { results: groups.filter(Boolean) }
      }
      const action = actionOf(tool)
      if (!action) throw new Error(`${tool.name} is not available.`)
      return action.handler(input)
    },

    async card(tool, raw, id): Promise<ConfirmCard> {
      const input = actionInput(tool, raw)
      const details = cardDetails(input)
      const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
      const extra: { label: string; value: string }[] = []
      if (typeof fields.id === "string") {
        const name = await lookup(tool.module, fields.id)
        if (name) extra.push({ label: LOOKUP[tool.module]!.label, value: name })
      }
      if (Array.isArray(fields.ids)) {
        const names = await Promise.all(fields.ids.slice(0, 3).map((x) => (typeof x === "string" ? lookup(tool.module, x) : null)))
        const shown = names.filter(Boolean).join("; ")
        extra.push({ label: fields.ids.length === 1 ? "Item" : `${fields.ids.length} items`, value: shown || `${fields.ids.length} selected` })
      }
      if (tool.module === "budget") {
        const category = await budgetName("listCategories", fields.categoryId)
        if (category) extra.push({ label: "Category", value: category })
        const account = await budgetName("listAccounts", fields.accountId)
        if (account) extra.push({ label: "Account", value: account })
      }
      return { id, name: tool.name, title: cardTitle(tool.module, tool.action), details: [...extra, ...details], destructive: tool.destructive }
    },
  }
}
