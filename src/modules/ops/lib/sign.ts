import { createHash, createHmac, randomBytes } from "node:crypto"

// Web side of the ops-agent request signature. Must match
// services/ops-agent/internal/sign/sign.go byte for byte (shared test vector).
//
// payload = "v1\n" + ts + "\n" + nonce + "\n" + METHOD + "\n" + pathWithQuery + "\n" + hex(sha256(body))

export const HEADER_TIMESTAMP = "X-OS-Timestamp"
export const HEADER_NONCE = "X-OS-Nonce"
export const HEADER_SIGNATURE = "X-OS-Signature"

export function signaturePayload(ts: number, nonce: string, method: string, pathQuery: string, body: string) {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex")
  return `v1\n${ts}\n${nonce}\n${method.toUpperCase()}\n${pathQuery}\n${bodyHash}`
}

export function sign(secret: string, ts: number, nonce: string, method: string, pathQuery: string, body: string) {
  const mac = createHmac("sha256", secret).update(signaturePayload(ts, nonce, method, pathQuery, body), "utf8")
  return `v1=${mac.digest("hex")}`
}

/** Headers for one request. A fresh nonce every call: the agent accepts each once. */
export function signedHeaders(
  secret: string,
  method: string,
  pathQuery: string,
  body: string,
  now = Date.now(),
): Record<string, string> {
  const ts = Math.floor(now / 1000)
  const nonce = randomBytes(18).toString("base64url")
  return {
    [HEADER_TIMESTAMP]: String(ts),
    [HEADER_NONCE]: nonce,
    [HEADER_SIGNATURE]: sign(secret, ts, nonce, method, pathQuery, body),
  }
}
