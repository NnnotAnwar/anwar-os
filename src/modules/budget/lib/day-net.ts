import type { Transaction } from "../schema"

// The net of one day in the transactions list (transfers left out). Amounts
// in different currencies are never added together as they are: a day in one
// currency gets its exact net; a day mixing currencies gets one approximate
// total in the base currency when every row has its ČNB conversion, and
// otherwise one net per currency.

export type DayNet =
  | { kind: "exact"; minor: number; currency: string }
  | { kind: "converted"; minor: number; currency: string }
  | { kind: "per-currency"; nets: { minor: number; currency: string }[] }

type Row = Pick<Transaction, "amountMinor" | "currency" | "transferId" | "baseAmount">

export function dayNet(rows: Row[]): DayNet | null {
  const counted = rows.filter((r) => !r.transferId)
  if (counted.length === 0) return null

  const currencies = [...new Set(counted.map((r) => r.currency))]
  if (currencies.length === 1) {
    return { kind: "exact", minor: counted.reduce((s, r) => s + r.amountMinor, 0), currency: currencies[0]! }
  }

  // The base currency is the one conversions point at; rows already in it count as they are.
  const base = counted.find((r) => r.baseAmount)?.baseAmount?.currency
  if (base && counted.every((r) => r.currency === base || r.baseAmount?.currency === base)) {
    const minor = counted.reduce((s, r) => s + (r.currency === base ? r.amountMinor : r.baseAmount!.minor), 0)
    return { kind: "converted", minor, currency: base }
  }

  const nets = new Map<string, number>()
  for (const r of counted) nets.set(r.currency, (nets.get(r.currency) ?? 0) + r.amountMinor)
  return { kind: "per-currency", nets: [...nets].map(([currency, minor]) => ({ currency, minor })) }
}
