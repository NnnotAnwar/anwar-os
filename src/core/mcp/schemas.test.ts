import { describe, expect, it, vi } from "vitest"
import { modules } from "@/modules/_registry"
import { generateTools, type ToolSource } from "./tools"

vi.mock("server-only", () => ({}))

// Every MCP tool and HTTP API call arrives as JSON. A zod type JSON can't carry
// (z.date(), a Map, a bigint…) becomes `{}` in the tool's JSON Schema, and the
// tool then rejects every real call (calendar_range did, until 52a5e91). This
// walks every module action's input schema and fails on such a hole, unless a
// JSON-friendly alternative sits next to it in the same anyOf.

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test"

function holes(schema: unknown, path: string, out: string[]) {
  if (!schema || typeof schema !== "object") return
  const node = schema as Record<string, unknown>
  if (Object.keys(node).length === 0) {
    out.push(path || "(root)")
    return
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const options = node[key]
    if (!Array.isArray(options)) continue
    const typed = options.filter((o) => o && typeof o === "object" && Object.keys(o).length > 0)
    if (typed.length === 0) out.push(`${path}.${key}`)
    typed.forEach((o, i) => holes(o, `${path}.${key}[${i}]`, out))
  }
  for (const key of ["properties", "$defs", "definitions"] as const) {
    const map = node[key]
    if (map && typeof map === "object")
      for (const [name, child] of Object.entries(map)) holes(child, `${path}.${name}`, out)
  }
  for (const key of ["items", "additionalProperties", "not"] as const) {
    if (node[key] && typeof node[key] === "object") holes(node[key], `${path}.${key}`, out)
  }
  if (Array.isArray(node.allOf)) node.allOf.forEach((o, i) => holes(o, `${path}.allOf[${i}]`, out))
  if (Array.isArray(node.prefixItems)) node.prefixItems.forEach((o, i) => holes(o, `${path}[${i}]`, out))
}

describe("every action's input survives JSON", () => {
  it("has no schema hole a JSON caller can't fill", async () => {
    const sources: ToolSource[] = []
    for (const m of modules) {
      if (!m.actions) continue
      sources.push({ moduleId: m.id, moduleName: m.name, actions: await m.actions() })
    }
    const skipped: string[] = []
    const tools = generateTools(sources, { write: true }, (name) => skipped.push(name))
    expect(tools.length).toBeGreaterThan(100)
    expect(skipped).toEqual([])

    const broken: string[] = []
    for (const tool of tools) {
      const found: string[] = []
      holes(tool.inputSchema, "", found)
      if (found.length) broken.push(`${tool.name}: ${found.join(", ")}`)
    }
    expect(broken).toEqual([])
  }, 30_000)
})
