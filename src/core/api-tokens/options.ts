// Token choices shared by Settings (client) and the server. No server imports.

/** Expiry choices in Settings. "never" keeps the token until it is revoked. */
export const tokenExpiryOptions = [
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "365", label: "1 year", days: 365 },
  { id: "never", label: "Never", days: null },
] as const satisfies readonly { id: string; label: string; days: number | null }[]

export type TokenExpiryId = (typeof tokenExpiryOptions)[number]["id"]

export function expiryDate(id: string, now = new Date()): Date | null {
  const option = tokenExpiryOptions.find((o) => o.id === id)
  if (!option) throw new Error(`Unknown expiry "${id}"`)
  return option.days === null ? null : new Date(now.getTime() + option.days * 86_400_000)
}
