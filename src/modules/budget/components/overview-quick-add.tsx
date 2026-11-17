"use client"

import { useRouter } from "next/navigation"
import { NAV_FORWARD } from "@/components/motion"
import { QuickAdd } from "./transactions"
import type { AccountOption } from "./types"

/** Quick add on the overview; "Full form" goes to the transactions page. */
export function OverviewQuickAdd({ accounts, locale }: { accounts: AccountOption[]; locale: string }) {
  const router = useRouter()
  return (
    <QuickAdd
      accounts={accounts}
      locale={locale}
      onDetails={() => router.push("/app/budget/transactions?new=1", { transitionTypes: NAV_FORWARD })}
    />
  )
}
