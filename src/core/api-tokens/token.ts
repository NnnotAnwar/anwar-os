import { createHash, randomBytes } from "node:crypto"
import type { ApiTokenScope } from "@/db/schema/api-tokens"

// Personal API tokens, the pure part (unit-tested in token.test.ts).
//
//   aos_ + 8 characters (the prefix: stored in clear, finds the row, shown in
//   Settings) + 40 characters of secret, all base62: 48 random characters,
//   ~285 bits. Only SHA-256(token) is stored, as hex.
//
// The format is fixed so a leaked token is easy to recognise (and to search
// for in logs or repositories) and a typo fails before any database lookup.

export const TOKEN_PREFIX = "aos_"
const PREFIX_CHARS = 8
const SECRET_CHARS = 40
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const TOKEN_FORMAT = /^aos_[A-Za-z0-9]{48}$/

export type { ApiTokenScope }

/** `count` uniformly random base62 characters (rejection sampling: no modulo bias). */
function randomBase62(count: number): string {
  let out = ""
  while (out.length < count) {
    for (const byte of randomBytes(count * 2)) {
      // 248 = 4 × 62: bytes at or above it would favour the first characters.
      if (byte < 248) out += ALPHABET[byte % 62]
      if (out.length === count) break
    }
  }
  return out
}

/** A new token: shown to the owner once, never stored. */
export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBase62(PREFIX_CHARS + SECRET_CHARS)}`
}

export function isTokenFormat(value: string): boolean {
  return TOKEN_FORMAT.test(value)
}

/** "aos_" + the first 8 random characters: the lookup key, safe to show. */
export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + PREFIX_CHARS)
}

/** What the database keeps: SHA-256 of the whole token, lowercase hex. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

/**
 * The token from an `Authorization: Bearer aos_…` header, or null when the
 * header is missing, uses another scheme or doesn't look like one of ours.
 */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? "")
  const token = match?.[1]
  return token && isTokenFormat(token) ? token : null
}

/** Stored scopes: read always, write only when asked for. */
export function scopesFor(write: boolean): ApiTokenScope[] {
  return write ? ["read", "write"] : ["read"]
}

export function canWrite(scopes: readonly string[]): boolean {
  return scopes.includes("write")
}
