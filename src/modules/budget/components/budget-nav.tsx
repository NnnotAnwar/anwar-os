"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { NAV_TAB } from "@/components/motion"
import { cn } from "@/lib/utils"

const sections = [
  { href: "/app/budget", label: "Overview" },
  { href: "/app/budget/transactions", label: "Transactions" },
  { href: "/app/budget/accounts", label: "Accounts" },
  { href: "/app/budget/categories", label: "Categories" },
  { href: "/app/budget/limits", label: "Limits" },
  { href: "/app/budget/recurring", label: "Recurring" },
  { href: "/app/budget/subscriptions", label: "Subscriptions" },
  { href: "/app/budget/goals", label: "Goals" },
  { href: "/app/budget/plan", label: "Plan" },
  { href: "/app/budget/import", label: "Import" },
] as const

/** Sections of the budget as one scrollable segmented row. */
export function BudgetNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Budget sections" className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      <ul className="segmented">
        {sections.map((s) => {
          const active = s.href === "/app/budget" ? pathname === s.href : pathname.startsWith(s.href)
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                transitionTypes={NAV_TAB}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-small flex h-8 items-center rounded-lg px-3 whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "segment-active text-foreground",
                )}
              >
                {s.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
