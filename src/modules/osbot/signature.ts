// HMAC request signing for the internal osbot API (/api/internal/osbot/*): the
// shared scheme in src/lib/signed-request.ts with osbot's own headers. The
// Python bot builds the same canonical string in bots/osbot/osbot/signing.py.
//
// Headers: x-osbot-timestamp (unix seconds), x-osbot-nonce (16–64 url-safe
// chars), x-osbot-signature.

import {
  signatureHeaderNames,
  signedHeaders as signedHeadersWith,
  verifyRequest as verifyRequestWith,
  type SignInput,
  type VerifyInput,
} from "@/lib/signed-request"

export {
  canonicalString,
  MIN_SECRET_LENGTH,
  ReplayCache,
  sign,
  SIGNATURE_WINDOW_SECONDS,
  type SignedParts,
  type VerifyFailure,
  type VerifyResult,
} from "@/lib/signed-request"

export const OSBOT_SIGNATURE_HEADERS = signatureHeaderNames("x-osbot")
export const HEADER_TIMESTAMP = OSBOT_SIGNATURE_HEADERS.timestamp
export const HEADER_NONCE = OSBOT_SIGNATURE_HEADERS.nonce
export const HEADER_SIGNATURE = OSBOT_SIGNATURE_HEADERS.signature

export function verifyRequest(input: Omit<VerifyInput, "names">) {
  return verifyRequestWith({ ...input, names: OSBOT_SIGNATURE_HEADERS })
}

/** Headers for a signed request (used by tests and by any future TS caller). */
export function signedHeaders(secret: string, parts: SignInput) {
  return signedHeadersWith(secret, parts, OSBOT_SIGNATURE_HEADERS)
}
