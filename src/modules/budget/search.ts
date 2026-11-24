import "server-only"
import type { SearchProvider } from "@/core/module"
import { requireViewer } from "@/core/auth"
import { searchDateFormat } from "@/core/search-context"
import { actions } from "./actions"
import { formatMoney } from "./lib/money"

/**
 * Transactions whose note, category or tag matches, or whose amount does
 * ("250" finds 250.00–250.99 either way, "-250" only spending, "250,50" exactly).
 */
export const search: SearchProvider = async (query, limit) => {
  const [viewer, date, rows] = await Promise.all([
    requireViewer(),
    searchDateFormat(),
    actions.listTransactions.handler({ query, limit }),
  ])
  return rows.map((tx) => ({
    id: tx.id,
    title: tx.note || tx.categoryName || (tx.transferId ? "Transfer" : "Transaction"),
    aside: formatMoney(tx.amountMinor, tx.currency, viewer.locale, { signed: true }),
    meta: [date(tx.occurredOn), tx.note ? tx.categoryName : null, tx.accountName, ...tx.tags.map((t) => `#${t}`)].filter(
      (m): m is string => Boolean(m),
    ),
    href: `/app/budget/transactions?month=${tx.occurredOn.slice(0, 7)}&edit=${tx.id}`,
  }))
}
