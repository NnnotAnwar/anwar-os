import { afterEach, describe, expect, it, vi } from "vitest"

const connection = vi.fn(async () => {})
vi.mock("next/server", () => ({ connection }))

const { default: robots } = await import("./robots")

afterEach(() => vi.unstubAllEnvs())

describe("robots.txt", () => {
  it("opts out of prerendering and points at the runtime origin's sitemap", async () => {
    // Imported above with whatever the shell had; the value at request time wins.
    vi.stubEnv("BETTER_AUTH_URL", "https://anwar.example")
    const result = await robots()
    expect(connection).toHaveBeenCalled()
    expect(result.sitemap).toBe("https://anwar.example/sitemap.xml")
  })
})
