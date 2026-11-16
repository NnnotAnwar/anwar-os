// Browser side of the proof of work (see pow.ts). Uses Web Crypto, which also
// exists in Node, so the same code is unit-tested against the server.

const BATCH = 200

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Finds n with SHA-256(salt + n) = challenge. Hashes in parallel batches, which
 * keeps the page responsive (each digest resolves as its own task) and finishes
 * 50 000 candidates in well under a second on a phone. Null if not found or aborted.
 */
export async function solveChallenge(
  { challenge, salt, maxNumber }: { challenge: string; salt: string; maxNumber: number },
  signal?: AbortSignal,
): Promise<number | null> {
  const encoder = new TextEncoder()
  for (let start = 0; start <= maxNumber; start += BATCH) {
    if (signal?.aborted) return null
    const end = Math.min(start + BATCH - 1, maxNumber)
    const candidates = Array.from({ length: end - start + 1 }, (_, i) => start + i)
    const digests = await Promise.all(
      candidates.map((n) => crypto.subtle.digest("SHA-256", encoder.encode(salt + n))),
    )
    const hit = digests.findIndex((d) => toHex(d) === challenge)
    if (hit !== -1) return candidates[hit]!
  }
  return null
}
