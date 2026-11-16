import "server-only"
import type { SearchProvider } from "@/core/module"
import { requireViewer } from "@/core/auth"
import { actions } from "./actions"
import { formatDay } from "./lib/dates"
import { formatMoney } from "./lib/money"

/** ⌘K: transactions whose note, category or tags match. */
export const search: SearchProvider = async (query, limit) => {
  const [viewer, rows] = await Promise.all([requireViewer(), actions.listTransactions.handler({ query, limit })])
  return rows.map((tx) => ({
    id: tx.id,
    title: tx.note || tx.categoryName || "Transaction",
    snippet: [
      formatMoney(tx.amountMinor, tx.currency, viewer.locale, { signed: true }),
      formatDay(tx.occurredOn, viewer.locale),
      tx.categoryName,
      tx.accountName,
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/app/budget/transactions?month=${tx.occurredOn.slice(0, 7)}&edit=${tx.id}`,
  }))
}
