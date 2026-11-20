import { Bank, ChartLineUp, FileCsv, Plus, Receipt, Target, Wallet } from "@/components/icons"
import { defineModule } from "@/core/module"

// Private money tracking: accounts, transactions, recurring, goals and a
// capital-growth plan. Amounts are minor units; see src/db/schema/budget.ts.
export const budget = defineModule({
  id: "budget",
  name: "Budget",
  description: "Accounts, transactions, recurring payments, savings goals and a capital-growth plan.",
  tagline: "Money in, money out",
  icon: Wallet,
  nav: [{ label: "Budget", href: "/app/budget" }],
  shortcuts: [
    { label: "Add transaction", href: "/app/budget/transactions?new=1", icon: Plus, hint: "One line: 250 food lunch" },
    { label: "This month", href: "/app/budget/transactions", icon: Receipt },
    { label: "Accounts", href: "/app/budget/accounts", icon: Bank },
    { label: "Goals", href: "/app/budget/goals", icon: Target },
    { label: "Plan", href: "/app/budget/plan", icon: ChartLineUp, hint: "Projected vs actual net worth" },
    { label: "Import CSV", href: "/app/budget/import", icon: FileCsv },
  ],
  badge: () => import("./badge").then((b) => b.badge),
  access: { demoable: true, public: false },
  create: { label: "New transaction", href: "/app/budget/transactions?new=1" },
  widgets: [
    {
      id: "this-month",
      title: "This month",
      load: () => import("./widgets/budget-widgets").then((m) => m.ThisMonth),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
