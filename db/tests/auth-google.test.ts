// Sign in with Google, end to end through the real Better Auth configuration.
// Only Google's token endpoint is faked: it answers with an ID token for
// whichever Google profile the test sets. No network, no real Google account.
import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { BASE, Browser, createUser, json, openDatabases, testAuth, totp } from "./support/auth-harness"

const { admin, app, db } = openDatabases()
const auth = testAuth(db)

type GoogleProfile = { sub: string; email: string; email_verified: boolean; name?: string }
let profile: GoogleProfile
const tokenRequests: URLSearchParams[] = []

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
function fakeIdToken(p: GoogleProfile) {
  const now = Math.floor(Date.now() / 1000)
  const claims = { iss: "https://accounts.google.com", aud: "test-client-id.apps.googleusercontent.com", iat: now, exp: now + 3600, ...p }
  return `${b64url({ alg: "RS256", kid: "test" })}.${b64url(claims)}.signature`
}

const realFetch = globalThis.fetch
beforeAll(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      tokenRequests.push(new URLSearchParams(String(init?.body ?? "")))
      return Response.json({
        access_token: `ya29.${randomBytes(8).toString("hex")}`,
        expires_in: 3599,
        token_type: "Bearer",
        scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        id_token: fakeIdToken(profile),
      })
    }
    if (url.startsWith(BASE)) return realFetch(input, init)
    throw new Error(`Unexpected network call in test: ${url}`)
  })
})

const users: string[] = []
let owner: Awaited<ReturnType<typeof createUser>>

beforeEach(async () => {
  owner = await createUser(admin, "owner")
  users.push(owner.id)
  profile = { sub: `google-${randomBytes(6).toString("hex")}`, email: owner.email, email_verified: true, name: "Owner" }
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await admin`delete from auth."user" where id in ${admin(users)}`
  await admin`delete from auth.verification where identifier like '2fa-%' and value in ${admin(users)}`
  await Promise.all([admin.end(), app.end()])
})

async function signInWithPassword(browser: Browser) {
  const response = await browser.request(auth, "/sign-in/email", { body: { email: owner.email, password: owner.password } })
  expect(response.status).toBe(200)
}

/** Start a Google sign-in, then come back from "Google" with a code. */
async function googleSignIn(browser: Browser, callbackURL = "/app") {
  const start = await browser.request(auth, "/sign-in/social", {
    body: { provider: "google", callbackURL, errorCallbackURL: "/login", disableRedirect: true },
  })
  expect(start.status).toBe(200)
  const { url } = await json<{ url: string }>(start)
  return completeAtGoogle(browser, url)
}

async function completeAtGoogle(browser: Browser, authorizationURL: string) {
  const authorize = new URL(authorizationURL)
  expect(authorize.origin).toBe("https://accounts.google.com")
  const state = authorize.searchParams.get("state")!
  const response = await browser.request(auth, `/callback/google?code=fake-code&state=${encodeURIComponent(state)}`)
  expect(response.status).toBe(302)
  return new URL(response.headers.get("location")!, BASE)
}

async function linkGoogle(browser: Browser) {
  const start = await browser.request(auth, "/link-social", {
    body: { provider: "google", callbackURL: "/app/settings", errorCallbackURL: "/app/settings", disableRedirect: true },
  })
  return start
}

async function sessionUser(browser: Browser) {
  const response = await browser.request(auth, "/get-session")
  const body = await response.json()
  return (body as { user?: { id: string } } | null)?.user?.id ?? null
}

async function googleAccounts(userId: string) {
  return admin`select account_id, access_token from auth.account where user_id = ${userId} and provider_id = 'google'`
}

describe("Google sign-in without a linked account", () => {
  it("is refused for the owner's own (verified) email: no implicit linking", async () => {
    const browser = new Browser()
    const landing = await googleSignIn(browser)

    expect(landing.pathname).toBe("/login")
    expect(landing.searchParams.get("error")).toBe("account_not_linked")
    expect(await sessionUser(browser)).toBeNull()
    expect(await googleAccounts(owner.id)).toHaveLength(0)
  })

  it("never creates a user for an unknown Google account", async () => {
    profile = { sub: `google-${randomBytes(6).toString("hex")}`, email: `stranger-${randomBytes(4).toString("hex")}@gmail.com`, email_verified: true }
    const browser = new Browser()
    const landing = await googleSignIn(browser)

    expect(landing.pathname).toBe("/login")
    expect(landing.searchParams.get("error")).toBe("signup_disabled")
    expect(await sessionUser(browser)).toBeNull()
    const created = await admin`select id from auth."user" where email = ${profile.email}`
    expect(created).toHaveLength(0)
  })

  it("can't be talked into a sign-up with requestSignUp", async () => {
    profile = { sub: `google-${randomBytes(6).toString("hex")}`, email: `stranger-${randomBytes(4).toString("hex")}@gmail.com`, email_verified: true }
    const browser = new Browser()
    const start = await browser.request(auth, "/sign-in/social", {
      body: { provider: "google", callbackURL: "/app", errorCallbackURL: "/login", disableRedirect: true, requestSignUp: true },
    })
    const landing = await completeAtGoogle(browser, (await json<{ url: string }>(start)).url)

    expect(landing.searchParams.get("error")).toBe("signup_disabled")
    expect(await admin`select id from auth."user" where email = ${profile.email}`).toHaveLength(0)
  })

  it("refuses ID-token (One Tap) sign-in outright", async () => {
    const browser = new Browser()
    const response = await browser.request(auth, "/sign-in/social", {
      body: { provider: "google", idToken: { token: fakeIdToken(profile) } },
    })
    expect(response.status).toBe(400)
    expect(await sessionUser(browser)).toBeNull()
  })
})

describe("connecting Google from Settings", () => {
  it("needs a session", async () => {
    const response = await linkGoogle(new Browser())
    expect(response.status).toBe(401)
  })

  it("needs a recent sign-in", async () => {
    const browser = new Browser()
    await signInWithPassword(browser)
    await admin`update auth.session set created_at = now() - interval '2 hours' where user_id = ${owner.id}`

    const response = await linkGoogle(browser)
    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({ code: "SESSION_NOT_FRESH" })
  })

  it("refuses a Google account whose email isn't verified", async () => {
    profile.email_verified = false
    const browser = new Browser()
    await signInWithPassword(browser)

    const start = await linkGoogle(browser)
    const landing = await completeAtGoogle(browser, (await json<{ url: string }>(start)).url)

    expect(landing.pathname).toBe("/app/settings")
    expect(landing.searchParams.get("error")).toBeTruthy()
    expect(await googleAccounts(owner.id)).toHaveLength(0)
  })

  it("links the account, after which Google signs the owner in", async () => {
    profile.email = `owner-${randomBytes(4).toString("hex")}@gmail.com` // a different address is fine
    const browser = new Browser()
    await signInWithPassword(browser)

    const start = await linkGoogle(browser)
    expect(start.status).toBe(200)
    const linked = await completeAtGoogle(browser, (await json<{ url: string }>(start)).url)
    expect(linked.pathname).toBe("/app/settings")
    expect(linked.searchParams.get("error")).toBeNull()

    const [account] = await googleAccounts(owner.id)
    expect(account?.account_id).toBe(profile.sub)
    // Provider tokens are encrypted at rest.
    expect(account?.access_token).not.toMatch(/^ya29\./)
    // The code exchange went to Google with PKCE.
    expect(tokenRequests.at(-1)?.get("code_verifier")).toBeTruthy()

    const fresh = new Browser()
    const landing = await googleSignIn(fresh, "/app/notes")
    expect(landing.pathname).toBe("/app/notes")
    expect(await sessionUser(fresh)).toBe(owner.id)
  })

  it("keeps 2FA: a Google sign-in stops at the code step", async () => {
    const browser = new Browser()
    await signInWithPassword(browser)
    const start = await linkGoogle(browser)
    await completeAtGoogle(browser, (await json<{ url: string }>(start)).url)

    // Turn on TOTP the way Settings does.
    const enable = await browser.request(auth, "/two-factor/enable", { body: { password: owner.password } })
    const { totpURI } = await json<{ totpURI: string }>(enable)
    const secret = new URL(totpURI).searchParams.get("secret")!
    const verify = await browser.request(auth, "/two-factor/verify-totp", { body: { code: totp(secret) } })
    expect(verify.status).toBe(200)

    const phone = new Browser()
    const landing = await googleSignIn(phone, "/app/calendar")
    expect(landing.pathname).toBe("/login/mfa")
    expect(landing.searchParams.get("next")).toBe("/app/calendar")
    expect(await sessionUser(phone)).toBeNull()
    expect(phone.has("two_factor")).toBe(true)

    const second = await phone.request(auth, "/two-factor/verify-totp", { body: { code: totp(secret) } })
    expect(second.status).toBe(200)
    expect(await sessionUser(phone)).toBe(owner.id)
  })

  it("unlinks only with a recent sign-in, and then Google can't sign in", async () => {
    const browser = new Browser()
    await signInWithPassword(browser)
    const start = await linkGoogle(browser)
    await completeAtGoogle(browser, (await json<{ url: string }>(start)).url)
    const [row] = await admin`select id from auth.account where user_id = ${owner.id} and provider_id = 'google'`

    await admin`update auth.session set created_at = now() - interval '2 hours' where user_id = ${owner.id}`
    const stale = await browser.request(auth, "/unlink-account", { body: { accountId: row!.id } })
    expect(stale.status).toBe(403)

    await admin`update auth.session set created_at = now() where user_id = ${owner.id}`
    const unlink = await browser.request(auth, "/unlink-account", { body: { accountId: row!.id } })
    expect(unlink.status).toBe(200)

    const landing = await googleSignIn(new Browser())
    expect(landing.searchParams.get("error")).toBe("account_not_linked")
  })
})
