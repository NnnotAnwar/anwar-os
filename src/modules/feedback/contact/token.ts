import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

// The contact form's spam check. The form must also work without JavaScript,
// so instead of the feedback form's proof of work it carries a signed,
// short-lived token: `<nonce>.<issued ms>.<HMAC>`. The server refuses a token
// it didn't sign, one older than two hours, and one used within 3 s of being
// issued (people take longer than that to write a message; scripts don't).
// The database refuses a nonce it has seen before (contact_submissions), and
// rate-limits per IP hash on top. The page renders a fresh token into the form
// on every request (the whole document is rendered per request; see the root
// layout), so it works the same with and without JavaScript.

export const TOKEN = {
  minAgeMs: 3_000,
  ttlMs: 2 * 60 * 60 * 1000,
} as const

export type TokenVerdict = { ok: true; nonce: string } | { ok: false; reason: "invalid" | "expired" | "too_fast" }

/** A purpose-bound key, so the token never shares a key with the feedback proof of work or IP hashing. */
export function tokenKey(secret: string) {
  return createHmac("sha256", secret).update("anwar.os/contact/token/v1").digest()
}

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("hex")

export function createToken(key: Buffer, now = Date.now()) {
  const payload = `${randomBytes(16).toString("hex")}.${now}`
  return `${payload}.${sign(key, payload)}`
}

export function verifyToken(token: string, key: Buffer, now = Date.now()): TokenVerdict {
  const match = /^([0-9a-f]{32})\.(\d{1,15})\.([0-9a-f]{64})$/.exec(token)
  if (!match) return { ok: false, reason: "invalid" }
  const [, nonce, issuedText, signature] = match as unknown as [string, string, string, string]
  const expected = Buffer.from(sign(key, `${nonce}.${issuedText}`), "hex")
  if (!timingSafeEqual(Buffer.from(signature, "hex"), expected)) return { ok: false, reason: "invalid" }
  const issued = Number(issuedText)
  if (now - issued > TOKEN.ttlMs || issued - now > 60_000) return { ok: false, reason: "expired" }
  if (now - issued < TOKEN.minAgeMs) return { ok: false, reason: "too_fast" }
  return { ok: true, nonce }
}
