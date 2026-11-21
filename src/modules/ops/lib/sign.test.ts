import { describe, expect, it } from "vitest"
import { HEADER_NONCE, HEADER_SIGNATURE, HEADER_TIMESTAMP, sign, signedHeaders } from "./sign"

// Same vector as services/ops-agent/internal/sign/sign_test.go (computed there
// independently with openssl), so web and agent can't drift apart.
const secret = "test-secret-0123456789abcdef0123456789abcdef"

describe("ops-agent request signing", () => {
  it("matches the agent's shared test vector", () => {
    expect(sign(secret, 1763290000, "n0nce-AAAAAAAAAAAAAAAA", "post", "/services/bot-expenses/deploy", '{"tag":"abc1234"}')).toBe(
      "v1=45630aa8395de1909629504bfe6e4df7fa4b48c0789afec9e2b8a3d80b3e311d",
    )
  })

  it("changes with the path, the method and the body", () => {
    const base = sign(secret, 1, "abcdefghijklmnop", "POST", "/services/a/stop", "")
    expect(sign(secret, 1, "abcdefghijklmnop", "POST", "/services/b/stop", "")).not.toBe(base)
    expect(sign(secret, 1, "abcdefghijklmnop", "GET", "/services/a/stop", "")).not.toBe(base)
    expect(sign(secret, 1, "abcdefghijklmnop", "POST", "/services/a/stop", "{}")).not.toBe(base)
  })

  it("makes headers with unix seconds and a fresh URL-safe nonce each time", () => {
    const a = signedHeaders(secret, "GET", "/services", "", 1763290000_999)
    const b = signedHeaders(secret, "GET", "/services", "", 1763290000_999)
    expect(a[HEADER_TIMESTAMP]).toBe("1763290000")
    expect(a[HEADER_NONCE]).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(a[HEADER_NONCE]).not.toBe(b[HEADER_NONCE])
    expect(a[HEADER_SIGNATURE]).toBe(sign(secret, 1763290000, a[HEADER_NONCE]!, "GET", "/services", ""))
  })
})
