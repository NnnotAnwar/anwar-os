import { Suspense } from "react"
import { Reveal, SkeletonExit } from "@/components/motion"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { SubscriptionsBoard } from "../components/subscriptions"
import { BudgetPage, ensureSetup, ListSkeleton } from "./shell"

export default function SubscriptionsPage() {
  return (
    <BudgetPage
      title="Subscriptions"
      description="Every recurring expense, soonest charge first, with what it costs a month and a year."
    >
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
  const [data, accounts, categories] = await Promise.all([
    actions.subscriptions.handler({}),
    actions.listAccounts.handler({ includeArchived: false }),
    actions.listCategories.handler({ includeArchived: false }),
  ])
  return <SubscriptionsBoard data={data} accounts={accounts} categories={categories} locale={viewer.locale} />
}
