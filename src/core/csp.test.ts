import { describe, expect, it } from "vitest"
import { contentSecurityPolicy, createNonce, storageOrigins } from "./csp"

function directives(policy: string) {
  return Object.fromEntries(
    policy.split("; ").map((d) => {
      const [name, ...values] = d.split(" ")
      return [name, values]
    }),
  )
}

describe("contentSecurityPolicy", () => {
  it("allows only nonce-bearing scripts in production", () => {
    const d = directives(contentSecurityPolicy("abc", { nodeEnv: "production" }))
    expect(d["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"])
    expect(d["script-src"]).not.toContain("'unsafe-inline'")
    expect(d["object-src"]).toEqual(["'none'"])
    expect(d["frame-ancestors"]).toEqual(["'none'"])
    expect(d["base-uri"]).toEqual(["'self'"])
  })

  it("adds eval and HMR websockets only in development", () => {
    const d = directives(contentSecurityPolicy("abc", { nodeEnv: "development" }))
    expect(d["script-src"]).toContain("'unsafe-eval'")
    expect(d["connect-src"]).toContain("ws:")
    const prod = directives(contentSecurityPolicy("abc", { nodeEnv: "production" }))
    expect(prod["connect-src"]).toEqual(["'self'"])
  })

  it("allows the Fontshare stylesheet and fonts", () => {
    const d = directives(contentSecurityPolicy("abc", {}))
    expect(d["style-src"]).toContain("https://api.fontshare.com")
    expect(d["font-src"]).toContain("https://cdn.fontshare.com")
  })

  it("upgrades insecure requests only on https sites", () => {
    expect(contentSecurityPolicy("n", { siteUrl: "https://anwarnnnot.com" })).toContain("upgrade-insecure-requests")
    expect(contentSecurityPolicy("n", { siteUrl: "http://127.0.0.1:3304" })).not.toContain("upgrade-insecure-requests")
  })

  it("lets the browser reach object storage for uploads and previews", () => {
    const d = directives(
      contentSecurityPolicy("n", { s3Endpoint: "https://fsn1.your-objectstorage.com", s3Bucket: "os", s3ForcePathStyle: "false" }),
    )
    for (const name of ["connect-src", "img-src", "frame-src", "media-src"]) {
      expect(d[name]).toContain("https://fsn1.your-objectstorage.com")
      expect(d[name]).toContain("https://os.fsn1.your-objectstorage.com")
    }
  })
})

describe("storageOrigins", () => {
  it("uses only the endpoint with path-style addressing", () => {
    expect(storageOrigins({ s3Endpoint: "http://127.0.0.1:55434/", s3Bucket: "b", s3ForcePathStyle: "true" })).toEqual([
      "http://127.0.0.1:55434",
    ])
  })

  it("ignores a missing or malformed endpoint", () => {
    expect(storageOrigins({})).toEqual([])
    expect(storageOrigins({ s3Endpoint: "not a url" })).toEqual([])
  })
})

describe("createNonce", () => {
  it("is random base64 of 16 bytes", () => {
    const a = createNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(createNonce()).not.toBe(a)
  })
})
