import { Suspense } from "react"
import { Reveal, SkeletonExit } from "@/components/motion"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { RecurringBoard } from "../components/recurring"
import { todayIn } from "../lib/dates"
import { BudgetPage, ensureSetup, ListSkeleton } from "./shell"

export default function RecurringPage() {
  return (
    <BudgetPage title="Recurring" description="Templates for what repeats. “Generate due” turns them into transactions up to today, never twice.">
      <Suspense
        fallback={
          <SkeletonExit>
            <ListSkeleton rows={4} />
          </SkeletonExit>
        }
      >
        <Reveal>
          <Body />
        </Reveal>
      </Suspense>
    </BudgetPage>
  )
}

async function Body() {
  const viewer = await requireViewer()
  await ensureSetup()
  const [items, accounts, categories] = await Promise.all([
    actions.listRecurring.handler({}),
    actions.listAccounts.handler({ includeArchived: false }),
    actions.listCategories.handler({ includeArchived: false }),
  ])
  return <RecurringBoard items={items} accounts={accounts} categories={categories} today={todayIn(viewer.timezone)} locale={viewer.locale} />
}
