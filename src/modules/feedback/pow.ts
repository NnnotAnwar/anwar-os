import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto"

// ALTCHA-style proof of work, implemented here instead of pulling in a package:
// it is ~60 lines, needs only node:crypto and Web Crypto, and keeps the public
// form free of third-party code.
//
// The server picks a random salt and a secret number n ≤ maxNumber, and sends
// challenge = SHA-256(salt + n) with an HMAC signature over it. The browser
// finds n by brute force (tens of thousands of hashes, about a second), then
// sends it back. The server checks the signature (so the challenge is ours),
// the expiry and minimum age embedded in the salt, and the hash. The salt is
// covered by the challenge hash, and the challenge by the signature, so no
// part can be altered. Reuse is refused by the database (feedback_submissions
// keeps every solved challenge for a day; challenges live for two hours).

export const POW = {
  algorithm: "SHA-256",
  maxNumber: 50_000,
  /** Faster than this from page load to submit is a script, not a person. */
  minAgeMs: 3_000,
  ttlMs: 2 * 60 * 60 * 1000,
} as const

export type Challenge = {
  algorithm: typeof POW.algorithm
  challenge: string
  salt: string
  signature: string
  maxNumber: number
}

export type Solution = Omit<Challenge, "maxNumber"> & { number: number }

export type Verdict = { ok: true } | { ok: false; reason: "invalid" | "expired" | "too_fast" }

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")
const sign = (key: Buffer, challenge: string) => createHmac("sha256", key).update(challenge).digest("hex")

export function createChallenge(key: Buffer, now = Date.now(), maxNumber: number = POW.maxNumber): Challenge {
  const salt = `${randomBytes(12).toString("hex")}.${now}.${now + POW.ttlMs}`
  const challenge = sha256(salt + randomInt(0, maxNumber + 1))
  return { algorithm: POW.algorithm, challenge, salt, signature: sign(key, challenge), maxNumber }
}

function safeEqualHex(a: string, b: string) {
  if (a.length !== b.length || !/^[0-9a-f]+$/.test(a)) return false
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
}

export function verifySolution(solution: Solution, key: Buffer, now = Date.now()): Verdict {
  const { algorithm, challenge, salt, signature, number } = solution
  if (algorithm !== POW.algorithm) return { ok: false, reason: "invalid" }
  if (!Number.isSafeInteger(number) || number < 0 || number > POW.maxNumber) return { ok: false, reason: "invalid" }
  if (!/^[0-9a-f]{64}$/.test(challenge) || !safeEqualHex(signature, sign(key, challenge))) {
    return { ok: false, reason: "invalid" }
  }
  if (!safeEqualHex(sha256(salt + number), challenge)) return { ok: false, reason: "invalid" }

  const [, issuedText, expiresText] = salt.split(".")
  const issued = Number(issuedText)
  const expires = Number(expiresText)
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return { ok: false, reason: "invalid" }
  if (now > expires) return { ok: false, reason: "expired" }
  if (now - issued < POW.minAgeMs) return { ok: false, reason: "too_fast" }
  return { ok: true }
}

/** Purpose-bound keys from one server secret, so the PoW and IP hashing never share a key. */
export function deriveKey(secret: string, purpose: "pow" | "ip") {
  return createHmac("sha256", secret).update(`anwar.os/feedback/${purpose}/v1`).digest()
}

/**
 * The client address as the reverse proxy (Caddy) saw it: the right-most
 * X-Forwarded-For entry is the one our proxy appended; anything to its left
 * was supplied by the client and can be forged.
 */
export function clientIp(headers: Pick<Headers, "get">) {
  const forwarded = headers.get("x-forwarded-for")
  const last = forwarded?.split(",").map((s) => s.trim()).filter(Boolean).at(-1)
  return last || headers.get("x-real-ip")?.trim() || "unknown"
}

/** Keyed SHA-256 (HMAC) of the IP: stable for rate limits, useless without the server secret. */
export function hashIp(ip: string, key: Buffer) {
  return createHmac("sha256", key).update(ip.toLowerCase()).digest("hex")
}
