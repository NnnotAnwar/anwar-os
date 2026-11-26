import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

vi.mock("server-only", () => ({}))
const revalidateTag = vi.fn()
vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }))

const { defineAction } = await import("@/core/module")
const { droppingPublicCache } = await import("./public-cache")

const actions = droppingPublicCache(["projects:public"], {
  list: defineAction({ description: "", kind: "read", input: z.object({}), handler: async () => ["a"] }),
  update: defineAction({
    description: "",
    kind: "write",
    input: z.object({ title: z.string() }),
    handler: async ({ title }) => {
      if (!title) throw new Error("no title")
      return { title }
    },
  }),
})

describe("droppingPublicCache", () => {
  beforeEach(() => {
    revalidateTag.mockReset()
  })

  it("drops the public tags after a write, at once, whoever called it", async () => {
    expect(await actions.update.handler({ title: "Shiftella Game" })).toEqual({ title: "Shiftella Game" })
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith("projects:public", { expire: 0 })
  })

  it("leaves the cache alone for reads and failed writes", async () => {
    expect(await actions.list.handler({})).toEqual(["a"])
    await expect(actions.update.handler({ title: "" })).rejects.toThrow("no title")
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it("keeps the write's result when there's no request to drop the cache in", async () => {
    revalidateTag.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing")
    })
    expect(await actions.update.handler({ title: "Script" })).toEqual({ title: "Script" })
  })

  it("keeps each action's description, kind and input", () => {
    expect(actions.update.kind).toBe("write")
    expect(actions.list.kind).toBe("read")
    expect(actions.update.input.safeParse({ title: "x" }).success).toBe(true)
  })
})
