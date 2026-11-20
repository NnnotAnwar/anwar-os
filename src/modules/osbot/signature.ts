// HMAC request signing for the internal osbot API (/api/internal/osbot/*).
// The Python bot signs every request with the shared OSBOT_API_SECRET; the
// same canonical string is built in bots/osbot/osbot/signing.py. Pure module:
// no server-only imports, so it is unit-tested directly.
//
//   canonical = `${timestamp}\n${nonce}\n${METHOD}\n${path + query}\n${body}`
//   signature = hex(HMAC-SHA256(secret, canonical))
//
// Headers: x-osbot-timestamp (unix seconds), x-osbot-nonce (16–64 url-safe
// chars), x-osbot-signature. Requests older or newer than 60 s are refused,
// and a signature is accepted once per process (replay within the window).

import { createHmac, timingSafeEqual } from "node:crypto"

export const SIGNATURE_WINDOW_SECONDS = 60
export const MIN_SECRET_LENGTH = 32

export const HEADER_TIMESTAMP = "x-osbot-timestamp"
export const HEADER_NONCE = "x-osbot-nonce"
export const HEADER_SIGNATURE = "x-osbot-signature"

const NONCE = /^[A-Za-z0-9_-]{16,64}$/
const HEX_SHA256 = /^[0-9a-f]{64}$/

export type SignedParts = {
  timestamp: string
  nonce: string
  method: string
  /** Path plus query string exactly as sent, e.g. "/api/internal/osbot/today?x=1". */
  path: string
  body: string
}

export function canonicalString(p: SignedParts) {
  return `${p.timestamp}\n${p.nonce}\n${p.method.toUpperCase()}\n${p.path}\n${p.body}`
}

export function sign(secret: string, parts: SignedParts): string {
  return createHmac("sha256", secret).update(canonicalString(parts), "utf8").digest("hex")
}

export type VerifyFailure = "not_configured" | "missing" | "malformed" | "expired" | "bad_signature" | "replayed"
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure }

/** Remembers accepted signatures until they fall out of the time window. */
export class ReplayCache {
  private seen = new Map<string, number>()
  constructor(private readonly maxEntries = 10_000) {}

  /** False if `key` was already used and has not expired yet. */
  claim(key: string, expiresAtMs: number, nowMs: number): boolean {
    const until = this.seen.get(key)
    if (until !== undefined && until > nowMs) return false
    if (this.seen.size >= this.maxEntries) {
      for (const [k, exp] of this.seen) if (exp <= nowMs) this.seen.delete(k)
      // Still full of live entries: drop the oldest instead of growing forever.
      while (this.seen.size >= this.maxEntries) this.seen.delete(this.seen.keys().next().value!)
    }
    this.seen.set(key, expiresAtMs)
    return true
  }
}

export type VerifyInput = {
  secret: string | undefined
  method: string
  path: string
  body: string
  headers: Pick<Headers, "get">
  nowMs?: number
  replay?: ReplayCache
}

export function verifyRequest(input: VerifyInput): VerifyResult {
  const { secret, method, path, body, headers, nowMs = Date.now(), replay } = input
  if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: "not_configured" }

  const timestamp = headers.get(HEADER_TIMESTAMP)
  const nonce = headers.get(HEADER_NONCE)
  const signature = headers.get(HEADER_SIGNATURE)
  if (!timestamp || !nonce || !signature) return { ok: false, reason: "missing" }
  if (!/^\d{1,12}$/.test(timestamp) || !NONCE.test(nonce) || !HEX_SHA256.test(signature)) {
    return { ok: false, reason: "malformed" }
  }

  const ts = Number(timestamp)
  if (Math.abs(nowMs / 1000 - ts) > SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: "expired" }

  const expected = Buffer.from(sign(secret, { timestamp, nonce, method, path, body }), "hex")
  const given = Buffer.from(signature, "hex")
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" }
  }

  if (replay && !replay.claim(signature, (ts + SIGNATURE_WINDOW_SECONDS + 1) * 1000, nowMs)) {
    return { ok: false, reason: "replayed" }
  }
  return { ok: true }
}

/** Headers for a signed request (used by tests and by any future TS caller). */
export function signedHeaders(secret: string, parts: Omit<SignedParts, "timestamp" | "nonce"> & { timestamp?: string; nonce?: string }) {
  const timestamp = parts.timestamp ?? String(Math.floor(Date.now() / 1000))
  const nonce = parts.nonce ?? crypto.randomUUID().replaceAll("-", "")
  const signature = sign(secret, { ...parts, timestamp, nonce })
  return { [HEADER_TIMESTAMP]: timestamp, [HEADER_NONCE]: nonce, [HEADER_SIGNATURE]: signature }
}
