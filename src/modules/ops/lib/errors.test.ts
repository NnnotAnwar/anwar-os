import { describe, expect, it } from "vitest"
import {
  cleanPath,
  displayRoute,
  fingerprint,
  frameKey,
  isAppFrame,
  isIgnorable,
  normalizeMessage,
  parseFrames,
  scrub,
  stripQuery,
  toErrorRecord,
  topFrameKey,
  trimStack,
} from "./errors"

describe("scrub", () => {
  it("removes emails", () => {
    expect(scrub("no account for jane.doe+x@example.co.uk, sorry")).toBe("no account for <email>, sorry")
  })

  it("removes secrets named as such, in every common shape", () => {
    expect(scrub("OSBOT_API_SECRET=abc123def456")).toBe("OSBOT_API_SECRET=<redacted>")
    expect(scrub('{"password":"hunter2","name":"x"}')).toBe('{"password":"<redacted>","name":"x"}')
    expect(scrub("api_key: sk_live_abcdef")).toBe("api_key: <redacted>")
    expect(scrub("x-osbot-signature=deadbeef")).toBe("x-osbot-signature=<redacted>")
    expect(scrub("cookie=better-auth.session_token=abc; path=/")).toContain("cookie=<redacted>")
    expect(scrub("totp=123456")).toBe("totp=<redacted>")
  })

  it("removes bearer tokens, JWTs and well-known key shapes", () => {
    expect(scrub("Authorization: Bearer aos_abcdefghijklmnop")).not.toContain("aos_abc")
    expect(scrub("Bearer abcdefghijklmnop1234")).toBe("Bearer <redacted>")
    expect(scrub("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sflKxwRJSMeKKF2QT4fw")).not.toContain("eyJ")
    expect(scrub("used aos_0123456789abcdefABCDEF")).toBe("used <token>")
    expect(scrub("key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX")).toBe("key <token>")
    expect(scrub("gh ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123")).toBe("gh <token>")
    expect(scrub(`aws ${"AKIA"}ABCDEFGHIJKLMNOP`)).toBe("aws <token>")
    expect(scrub("bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1")).toBe("bot <token>")
    expect(scrub("AGE-SECRET-KEY-1QYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQS")).toBe("<private key>")
  })

  it("removes credentials and query strings from URLs", () => {
    expect(scrub("connect postgres://os_app:s3cret@db:5432/anwar_os failed")).toBe("connect postgres://<redacted>@db:5432/anwar_os failed")
    expect(scrub("GET https://api.example.com/v1/x?token=abc&b=2 failed")).toBe("GET https://api.example.com/v1/x?<redacted> failed")
  })

  it("removes long hex secrets and random base64, but keeps ids, words and paths", () => {
    expect(scrub(`secret ${"ab12".repeat(16)}`)).toBe("secret <hex>")
    expect(scrub(`got ${"Zx9kQ2mP8vL4tR7wY1nB"}6cF3hJ5sD0gA2eK8uI4o`)).toBe("got <token>")
    const id = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b"
    expect(scrub(`note ${id} not found`)).toBe(`note ${id} not found`)
    expect(scrub("at src_modules_ops_actions_ts_0a1b2c3d._.js")).toBe("at src_modules_ops_actions_ts_0a1b2c3d._.js")
  })

  it("hides drizzle's query parameters (user data)", () => {
    expect(scrub('Failed query: select * from "notes" where "title" = $1\nparams: My diary,jane@x.com')).toBe(
      'Failed query: select * from "notes" where "title" = $1\nparams: <redacted>',
    )
  })
})

describe("normalizeMessage", () => {
  it("replaces uuids, numbers, hex ids and quoted values", () => {
    expect(normalizeMessage('Note 3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b not found after 3 tries')).toBe(
      "Note <id> not found after <n> tries",
    )
    expect(normalizeMessage('invalid input syntax for type uuid: "abc"')).toBe('invalid input syntax for type uuid: "…"')
    expect(normalizeMessage("object 5f3a9c8e1b2d missing")).toBe("object <id> missing")
    expect(normalizeMessage("timeout of 30000ms")).toBe("timeout of 30000ms")
    expect(normalizeMessage("timeout after 30000 ms at 12:30:01")).toBe("timeout after <n> ms at <n>")
  })

  it("makes different secrets and emails equal", () => {
    expect(normalizeMessage("no user a@b.cz")).toBe(normalizeMessage("no user c@d.com"))
  })
})

describe("paths and routes", () => {
  it("strips query strings", () => {
    expect(stripQuery("/app/notes?q=secret#x")).toBe("/app/notes")
    expect(stripQuery("/app")).toBe("/app")
  })

  it("shows route patterns without groups", () => {
    expect(displayRoute("/(private)/app/notes/[id]")).toBe("/app/notes/[id]")
    expect(displayRoute("/(public)/page")).toBe("/")
    expect(displayRoute("/api/internal/osbot/today/route?x=1")).toBe("/api/internal/osbot/today")
  })

  it("cleans machine paths", () => {
    expect(cleanPath("file:///Users/anwar/code/app/src/a.ts", "/Users/anwar/code/app")).toBe("src/a.ts")
    expect(cleanPath("/home/deploy/x/y.js")).toBe("~/x/y.js")
    expect(cleanPath("webpack-internal:///(rsc)/./src/x.ts")).toBe("./src/x.ts")
  })
})

const devStack = `TypeError: Cannot read properties of undefined (reading 'title')
    at NotePage (/Users/anwar/code/app/.next/dev/server/chunks/ssr/[root-of-the-server]__4f3a9c8e._.js:120:15)
    at async Promise.all (index 0)
    at renderToStream (/Users/anwar/code/app/node_modules/next/dist/server/app-render/app-render.js:900:3)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)`

const prodStack = (hash: string, line: number) => `TypeError: Cannot read properties of undefined (reading 'title')
    at NotePage (/app/.next/server/chunks/ssr/[root-of-the-server]__${hash}._.js:${line}:15)
    at async Promise.all (index 0)
    at a (/app/.next/server/chunks/ssr/node_modules_next_dist_${hash}._.js:1:2)`

describe("stack frames", () => {
  it("parses V8 frames", () => {
    const frames = parseFrames(devStack)
    expect(frames).toHaveLength(4)
    expect(frames[0]).toMatchObject({ fn: "NotePage", line: 120 })
    expect(frames[1]).toMatchObject({ fn: "Promise.all", file: "index 0" })
  })

  it("tells our code from Node, Next and dependencies", () => {
    const [app, , next, node] = parseFrames(devStack)
    expect(isAppFrame(app!)).toBe(true)
    expect(isAppFrame(next!)).toBe(false)
    expect(isAppFrame(node!)).toBe(false)
    expect(isAppFrame(parseFrames(prodStack("abc123", 1))[2]!)).toBe(false)
  })

  it("keys the top app frame the same across builds and line shifts", () => {
    expect(topFrameKey(prodStack("4f3a9c8e", 120), "/app")).toBe(topFrameKey(prodStack("0d1e2f3a", 131), "/app"))
    expect(topFrameKey(prodStack("4f3a9c8e", 120), "/app")).toBe("NotePage@chunks/ssr/[root-of-the-server].js")
  })

  it("reads Python tracebacks innermost first, skipping libraries", () => {
    const tb = `Traceback (most recent call last):
  File "/app/osbot/loops.py", line 40, in every_minute
    await job()
  File "/app/osbot/ops_alerts.py", line 120, in ops_alerts_once
    result = await check(api)
  File "/app/.venv/lib/python3.13/site-packages/aiohttp/client.py", line 700, in _request
    raise ClientError()
aiohttp.ClientError: boom`
    const frames = parseFrames(tb)
    expect(frames.map((f) => f.fn)).toEqual(["_request", "ops_alerts_once", "every_minute"])
    expect(topFrameKey(tb, "/app")).toBe("ops_alerts_once@osbot/ops_alerts.py")
  })

  it("drops Turbopack's base-36 chunk hashes and pnpm's store paths", () => {
    const frame = (hash: string) => ({ fn: "GET", file: `/srv/.next/server/chunks/[root-of-the-server]__${hash}._.js`, line: 81, raw: "" })
    expect(frameKey(frame("0zn7f-gkx2cbj"), "/srv")).toBe(frameKey(frame("1abq3-9xk2ccz"), "/srv"))
    expect(frameKey(frame("0zn7f-gkx2cbj"), "/srv")).toBe("GET@chunks/[root-of-the-server].js")
    expect(cleanPath("/srv/node_modules/.pnpm/next@16.4.5_abc/node_modules/next/dist/x.js", "/srv")).toBe("node_modules/next/dist/x.js")
  })

  it("drops minified function names from the key", () => {
    expect(frameKey({ fn: "eQ", file: "/app/.next/server/chunks/x.js", line: 1, raw: "" }, "/app")).toBe("@chunks/x.js")
  })

  it("trims the stack: clean paths, no Node internals, header scrubbed", () => {
    const out = trimStack(devStack, "TypeError: token=abc", "/Users/anwar/code/app")
    expect(out.split("\n")[0]).toBe("TypeError: token=<redacted>")
    expect(out).toContain("at NotePage (.next/dev/server/chunks/ssr/[root-of-the-server]__4f3a9c8e._.js:120)")
    expect(out).not.toContain("node:internal")
    expect(out).not.toContain("/Users/anwar")
  })

  it("keeps at most 12 frames", () => {
    const deep = ["Error: x", ...Array.from({ length: 30 }, (_, i) => `    at f${i} (/srv/src/a.ts:${i}:1)`)].join("\n")
    const out = trimStack(deep, "Error: x", "/srv")
    expect(out.split("\n").filter((l) => l.includes(" at ")).length).toBe(12)
    expect(out).toContain("… 18 more")
  })
})

describe("toErrorRecord", () => {
  const ctx = { source: "web" as const, route: "/(private)/app/notes/[id]", method: "get", routeType: "render" as const, renderSource: "react-server-components", cwd: "/app" }

  it("builds a scrubbed record with a 32-hex fingerprint", () => {
    const err = Object.assign(new TypeError("no note for jane@x.com"), { digest: "1234567", stack: prodStack("aa11bb22", 5) })
    const r = toErrorRecord(err, ctx)!
    expect(r).toMatchObject({
      source: "web",
      name: "TypeError",
      message: "no note for <email>",
      route: "/app/notes/[id]",
      method: "GET",
      routeType: "render",
      digest: "1234567",
    })
    expect(r.fingerprint).toMatch(/^[0-9a-f]{32}$/)
    expect(r.stack).not.toContain("jane@x.com")
  })

  it("groups the same bug across ids and deploys, and splits different bugs", () => {
    const a = toErrorRecord(Object.assign(new Error("Note 3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b missing"), { stack: prodStack("aa11bb22", 5) }), ctx)!
    const b = toErrorRecord(Object.assign(new Error("Note 9f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0c missing"), { stack: prodStack("cc33dd44", 9) }), ctx)!
    const c = toErrorRecord(Object.assign(new Error("Note list empty"), { stack: prodStack("aa11bb22", 5) }), ctx)!
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).not.toBe(c.fingerprint)
    expect(toErrorRecord(new Error("x"), { ...ctx, source: "osbot" })!.fingerprint).not.toBe(toErrorRecord(new Error("x"), ctx)!.fingerprint)
  })

  it("leaves Next's control flow and aborted requests out", () => {
    expect(toErrorRecord(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" }), ctx)).toBeNull()
    expect(toErrorRecord(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), ctx)).toBeNull()
    expect(isIgnorable(Object.assign(new Error("aborted"), { name: "ResponseAborted" }))).toBe(true)
    expect(isIgnorable(new Error("real"))).toBe(false)
  })

  it("handles thrown non-errors and causes", () => {
    expect(toErrorRecord("plain string password=1", ctx)).toMatchObject({ name: "NonError", message: "plain string password=<redacted>" })
    const wrapped = new Error("Failed query: select 1\nparams: a@b.cz", { cause: new Error("connect ECONNREFUSED 10.0.0.2:5432") })
    const r = toErrorRecord(wrapped, ctx)!
    expect(r.message).toBe("Failed query: select 1\nparams: <redacted>")
    expect(r.stack).toContain("Caused by Error: connect ECONNREFUSED")
  })

  it("is stable: same input, same fingerprint", () => {
    expect(fingerprint({ source: "web", name: "E", message: "m 1", frame: "f@x" })).toBe(
      fingerprint({ source: "web", name: "E", message: "m 2", frame: "f@x" }),
    )
  })
})
