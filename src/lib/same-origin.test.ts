import { describe, expect, it } from "vitest"
import { checkSameOrigin } from "./same-origin"

const site = "https://anwar.example"
const url = "http://web:3000/api/sync/inbox"

function headers(h: Record<string, string>) {
  return new Headers({ "content-type": "application/json", ...h })
}

describe("checkSameOrigin", () => {
  it("accepts JSON from the site itself", () => {
    expect(checkSameOrigin(headers({ origin: site, "sec-fetch-site": "same-origin" }), url, site)).toEqual({ ok: true })
    expect(checkSameOrigin(headers({ origin: site, "content-type": "application/json; charset=utf-8" }), url, site)).toEqual({ ok: true })
  })

  it("accepts the address the request was sent to behind a proxy", () => {
    const h = headers({ origin: "https://staging.example", "x-forwarded-host": "staging.example", "x-forwarded-proto": "https" })
    expect(checkSameOrigin(h, url, site).ok).toBe(true)
    expect(checkSameOrigin(headers({ origin: "http://localhost:3304", host: "localhost:3304" }), "http://localhost:3304/api/sync/note").ok).toBe(true)
  })

  it("refuses other sites", () => {
    expect(checkSameOrigin(headers({ origin: "https://evil.example" }), url, site)).toMatchObject({ ok: false })
    expect(checkSameOrigin(headers({ origin: site, "sec-fetch-site": "cross-site" }), url, site)).toMatchObject({ ok: false })
    expect(checkSameOrigin(headers({ origin: site, "sec-fetch-site": "same-site" }), url, site)).toMatchObject({ ok: false })
    expect(checkSameOrigin(headers({ origin: "null" }), url, site)).toMatchObject({ ok: false })
  })

  it("refuses requests without an Origin", () => {
    expect(checkSameOrigin(headers({}), url, site)).toEqual({ ok: false, reason: "no origin" })
  })

  it("refuses anything but JSON (a cross-site form can't send it without a preflight)", () => {
    const form = new Headers({ origin: site, "content-type": "application/x-www-form-urlencoded" })
    expect(checkSameOrigin(form, url, site)).toMatchObject({ ok: false })
    expect(checkSameOrigin(new Headers({ origin: site, "content-type": "text/plain" }), url, site)).toMatchObject({ ok: false })
  })
})
