import { describe, expect, it } from "vitest"
import { defaultPasskeyName, isGoogleConfigured, privateNext, readAuthEnv } from "./auth-config"
import { safeNext } from "./safe-next"

describe("safeNext", () => {
  it("keeps private paths", () => {
    expect(safeNext("/app")).toBe("/app")
    expect(safeNext("/app/settings")).toBe("/app/settings")
  })

  it("falls back to /app for anything else", () => {
    for (const next of [undefined, "", "/", "/login", "https://evil.example/app", "//evil.example/app", "/app?x=1", "/application"]) {
      expect(safeNext(next)).toBe("/app")
    }
  })
})

describe("privateNext (where a Google sign-in goes after the 2FA step)", () => {
  const base = "https://anwarnnnot.com"
  it("turns a same-origin callback URL into its private path", () => {
    expect(privateNext("https://anwarnnnot.com/app/calendar", base)).toBe("/app/calendar")
    expect(privateNext("/app/notes", base)).toBe("/app/notes")
  })
  it("never points elsewhere", () => {
    expect(privateNext("https://evil.example/app", base)).toBe("/app")
    expect(privateNext("/login", base)).toBe("/app")
    expect(privateNext(null, base)).toBe("/app")
  })
})

describe("Google configuration", () => {
  it("needs both the client ID and the secret", () => {
    expect(isGoogleConfigured(readAuthEnv({}))).toBe(false)
    expect(isGoogleConfigured(readAuthEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "" }))).toBe(false)
    expect(isGoogleConfigured(readAuthEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }))).toBe(true)
  })
})

describe("defaultPasskeyName", () => {
  it("prefers the authenticator's provider", () => {
    expect(defaultPasskeyName("bada5566-a7aa-401f-bd96-45619a55120d", "Macintosh")).toBe("1Password")
  })
  it("falls back to the device, then to 'Passkey'", () => {
    const zero = "00000000-0000-0000-0000-000000000000"
    expect(defaultPasskeyName(zero, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone")
    expect(defaultPasskeyName(zero, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac")
    expect(defaultPasskeyName(undefined, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows")
    expect(defaultPasskeyName(undefined, null)).toBe("Passkey")
  })
})
