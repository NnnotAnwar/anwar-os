import { describe, expect, it } from "vitest"
import { modulesFor } from "@/core/module"
import { modules } from "./_registry"

// Invariants every module must satisfy. A new module that breaks the contract
// fails here before it reaches the shell.
describe("module registry", () => {
  it("has unique, table-prefix-safe ids", () => {
    const ids = modules.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*$/)
  })

  it("mounts every nav item under the module's own route", () => {
    for (const m of modules) {
      expect(m.nav.length).toBeGreaterThan(0)
      for (const item of m.nav) expect(item.href.startsWith(`/app/${m.id}`)).toBe(true)
    }
  })
})

describe("modulesFor", () => {
  const sample = [
    { id: "private", access: { demoable: false, public: false } },
    { id: "demo", access: { demoable: true, public: false } },
    { id: "open", access: { demoable: true, public: true } },
  ]
  const ids = (role: Parameters<typeof modulesFor>[1]) => modulesFor(sample, role).map((m) => m.id)

  it("gives the owner every module", () => {
    expect(ids("owner")).toEqual(["private", "demo", "open"])
  })

  it("limits demo visitors to demoable modules", () => {
    expect(ids("demo")).toEqual(["demo", "open"])
  })

  it("limits registered users to public modules", () => {
    expect(ids("user")).toEqual(["open"])
  })
})
