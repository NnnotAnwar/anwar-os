import { describe, expect, it, vi } from "vitest"
import { notifyOwner } from "./notify"

const env = { OSBOT_TOKEN: "123:fake-token-for-tests", OSBOT_OWNER_CHAT_ID: "42" }

describe("notifyOwner", () => {
  it("does nothing without a token or chat id", async () => {
    const fetchImpl = vi.fn()
    expect(await notifyOwner("hi", { env: {}, fetchImpl })).toBe(false)
    expect(await notifyOwner("hi", { env: { OSBOT_TOKEN: env.OSBOT_TOKEN }, fetchImpl })).toBe(false)
    expect(await notifyOwner("hi", { env: { OSBOT_OWNER_CHAT_ID: "42" }, fetchImpl })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts plain text to the Bot API sendMessage", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }))
    expect(await notifyOwner("New feedback", { env, fetchImpl })).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.telegram.org/bot123%3Afake-token-for-tests/sendMessage")
    expect(init.method).toBe("POST")
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ chat_id: "42", text: "New feedback" })
    expect(body.parse_mode).toBeUndefined()
  })

  it("caps the text at Telegram's 4096 characters", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"))
    await notifyOwner("x".repeat(5000), { env, fetchImpl })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).text).toHaveLength(4096)
  })

  it("reports failure instead of throwing", async () => {
    expect(await notifyOwner("hi", { env, fetchImpl: async () => new Response("no", { status: 401 }) })).toBe(false)
    expect(
      await notifyOwner("hi", {
        env,
        fetchImpl: async () => {
          throw new Error("network down")
        },
      }),
    ).toBe(false)
  })

  it("gives up when Telegram doesn't answer in time", async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))
    const started = Date.now()
    expect(await notifyOwner("hi", { env, fetchImpl: hanging, timeoutMs: 100 })).toBe(false)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
