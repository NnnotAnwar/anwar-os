import { Suspense } from "react"
import { Reveal, SkeletonExit } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { GoalsBoard } from "../components/goals"
import { todayIn } from "../lib/dates"
import { BudgetPage, ensureSetup } from "./shell"

export default function GoalsPage() {
  return (
    <BudgetPage title="Goals" description="Savings targets. Link an account and the progress is its balance.">
      <Suspense
        fallback={
          <SkeletonExit>
            <div className="grid gap-3 md:grid-cols-2" aria-hidden>
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
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
  const [goals, accounts] = await Promise.all([actions.listGoals.handler({}), actions.listAccounts.handler({ includeArchived: false })])
  return <GoalsBoard goals={goals} accounts={accounts} today={todayIn(viewer.timezone)} locale={viewer.locale} />
}
