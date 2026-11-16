// Passkeys end to end through the real Better Auth configuration, with a
// software authenticator standing in for the browser + device.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { BASE, Browser, createUser, json, openDatabases, testAuth } from "./support/auth-harness"
import { SoftAuthenticator } from "./support/soft-authenticator"

const { admin, app, db } = openDatabases()
const auth = testAuth(db, { googleClientId: undefined, googleClientSecret: undefined })
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

const users: string[] = []
let owner: Awaited<ReturnType<typeof createUser>>

beforeEach(async () => {
  owner = await createUser(admin, "passkey-owner")
  users.push(owner.id)
})

afterAll(async () => {
  await admin`delete from auth."user" where id in ${admin(users)}`
  await Promise.all([admin.end(), app.end()])
})

async function signedIn() {
  const browser = new Browser()
  const response = await browser.request(auth, "/sign-in/email", { body: { email: owner.email, password: owner.password } })
  expect(response.status).toBe(200)
  return browser
}

async function register(browser: Browser, device: SoftAuthenticator, opts?: { userVerified?: boolean }) {
  const options = await browser.request(auth, "/passkey/generate-register-options", { userAgent: MAC_SAFARI })
  if (options.status !== 200) return options
  const body = await json<{ challenge: string; rp: { id: string }; authenticatorSelection: Record<string, string> }>(options)
  expect(body.rp.id).toBe("127.0.0.1")
  expect(body.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" })
  return browser.request(auth, "/passkey/verify-registration", {
    body: { response: device.register(body, opts) },
    userAgent: MAC_SAFARI,
  })
}

async function passkeySignIn(browser: Browser, device: SoftAuthenticator, opts?: { userVerified?: boolean; origin?: string }) {
  const options = await json<{ challenge: string; allowCredentials?: unknown[] }>(
    await browser.request(auth, "/passkey/generate-authenticate-options"),
  )
  // Discoverable credentials: no email typed, no credential list sent.
  expect(options.allowCredentials ?? []).toHaveLength(0)
  return browser.request(auth, "/passkey/verify-authentication", {
    body: { response: device.authenticate(options, opts) },
  })
}

async function sessionUser(browser: Browser) {
  const body = await (await browser.request(auth, "/get-session")).json()
  return (body as { user?: { id: string } } | null)?.user?.id ?? null
}

describe("adding a passkey", () => {
  it("needs a session", async () => {
    const response = await new Browser().request(auth, "/passkey/generate-register-options")
    expect(response.status).toBe(401)
  })

  it("needs a recent sign-in", async () => {
    const browser = await signedIn()
    await admin`update auth.session set created_at = now() - interval '2 hours' where user_id = ${owner.id}`
    const response = await browser.request(auth, "/passkey/generate-register-options")
    expect(response.status).toBe(403)
  })

  it("stores the credential with a readable default name", async () => {
    const browser = await signedIn()
    const device = new SoftAuthenticator("127.0.0.1", BASE)
    const response = await register(browser, device)
    expect(response.status).toBe(200)

    const rows = await admin`select name, credential_id, user_id from auth.passkey where user_id = ${owner.id}`
    expect(rows).toEqual([{ name: "Mac", credential_id: device.credentialId.toString("base64url"), user_id: owner.id }])
  })

  it("refuses an authenticator that skipped user verification", async () => {
    const browser = await signedIn()
    const response = await register(browser, new SoftAuthenticator("127.0.0.1", BASE), { userVerified: false })
    expect(response.status).toBe(400)
    expect(await admin`select id from auth.passkey where user_id = ${owner.id}`).toHaveLength(0)
  })

  it("refuses a credential made for another site", async () => {
    const browser = await signedIn()
    const response = await register(browser, new SoftAuthenticator("evil.example", "https://evil.example"))
    expect(response.status).toBe(400)
  })
})

describe("signing in with a passkey", () => {
  it("signs the owner in without an email or password", async () => {
    const device = new SoftAuthenticator("127.0.0.1", BASE)
    await register(await signedIn(), device)

    const browser = new Browser()
    const response = await passkeySignIn(browser, device)
    expect(response.status).toBe(200)
    expect(await sessionUser(browser)).toBe(owner.id)
  })

  it("counts as two factors: no TOTP step even with 2FA on", async () => {
    const device = new SoftAuthenticator("127.0.0.1", BASE)
    await register(await signedIn(), device)
    await admin`update auth."user" set two_factor_enabled = true where id = ${owner.id}`

    const browser = new Browser()
    expect((await passkeySignIn(browser, device)).status).toBe(200)
    expect(await sessionUser(browser)).toBe(owner.id)
  })

  it("refuses an assertion without user verification", async () => {
    const device = new SoftAuthenticator("127.0.0.1", BASE)
    await register(await signedIn(), device)

    const browser = new Browser()
    const response = await passkeySignIn(browser, device, { userVerified: false })
    expect(response.status).toBe(400)
    expect(await sessionUser(browser)).toBeNull()
  })

  it("refuses an assertion from another origin", async () => {
    const device = new SoftAuthenticator("127.0.0.1", BASE)
    await register(await signedIn(), device)

    const browser = new Browser()
    const response = await passkeySignIn(browser, device, { origin: "https://phish.example" })
    expect(response.status).toBe(400)
    expect(await sessionUser(browser)).toBeNull()
  })

  it("stops working once the passkey is deleted", async () => {
    const device = new SoftAuthenticator("127.0.0.1", BASE)
    const browser = await signedIn()
    await register(browser, device)
    const [row] = await admin`select id from auth.passkey where user_id = ${owner.id}`
    expect((await browser.request(auth, "/passkey/delete-passkey", { body: { id: row!.id } })).status).toBe(200)

    const response = await passkeySignIn(new Browser(), device)
    expect(response.status).toBe(401)
  })
})

describe("managing passkeys", () => {
  it("renames and lists only the viewer's own passkeys", async () => {
    const browser = await signedIn()
    await register(browser, new SoftAuthenticator("127.0.0.1", BASE))
    const [row] = await admin`select id from auth.passkey where user_id = ${owner.id}`

    const renamed = await browser.request(auth, "/passkey/update-passkey", { body: { id: row!.id, name: "Work laptop" } })
    expect(renamed.status).toBe(200)
    const list = await json<{ id: string; name: string }[]>(await browser.request(auth, "/passkey/list-user-passkeys"))
    expect(list.map((p) => p.name)).toEqual(["Work laptop"])

    // Someone else can neither see nor touch it.
    const other = await createUser(admin, "other")
    users.push(other.id)
    const intruder = new Browser()
    await intruder.request(auth, "/sign-in/email", { body: { email: other.email, password: other.password } })
    expect(await json<unknown[]>(await intruder.request(auth, "/passkey/list-user-passkeys"))).toEqual([])
    const stolen = await intruder.request(auth, "/passkey/delete-passkey", { body: { id: row!.id } })
    expect(stolen.status).toBe(401)
    expect(await admin`select id from auth.passkey where id = ${row!.id}`).toHaveLength(1)
  })
})
