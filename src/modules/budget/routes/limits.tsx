import { Suspense } from "react"
import { Reveal, SkeletonExit } from "@/components/motion"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { LimitsBoard } from "../components/limits"
import { monthOf, todayIn } from "../lib/dates"
import { BudgetPage, ensureSetup, ListSkeleton, monthParam, MonthSwitcher } from "./shell"

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function LimitsPage({ searchParams }: Props) {
  return (
    <BudgetPage
      title="Limits"
      description="A monthly ceiling per category, subcategories included. Telegram tells you at 90 % and when it's used up."
    >
      <Suspense
        fallback={
          <SkeletonExit>
            <ListSkeleton rows={4} />
          </SkeletonExit>
        }
      >
        <Reveal>
          <Body searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </BudgetPage>
  )
}

async function Body({ searchParams }: Props) {
  const [viewer, params] = await Promise.all([requireViewer(), searchParams])
  await ensureSetup()
  const current = monthOf(todayIn(viewer.timezone))
  const month = monthParam(params.month, current)
  const data = await actions.limits.handler({ month })
  return (
    <div className="grid gap-4">
      <MonthSwitcher month={month} current={current} locale={viewer.locale} basePath="/app/budget/limits" />
      <LimitsBoard key={month} data={data} current={month === current} locale={viewer.locale} />
    </div>
  )
}
