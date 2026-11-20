import { Suspense } from "react"
import { Reveal, SkeletonExit } from "@/components/motion"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { AccountsBoard } from "../components/accounts"
import { todayIn } from "../lib/dates"
import { BudgetPage, ensureSetup, ListSkeleton, one } from "./shell"

type Props = PageProps<"/app/budget/accounts">

export default function AccountsPage({ searchParams }: Props) {
  return (
    <BudgetPage title="Accounts" description="Cash, bank, savings, investments. Balance = opening balance + every transaction.">
      <Suspense
        fallback={
          <SkeletonExit>
            <ListSkeleton rows={3} />
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

async function Body({ searchParams }: Pick<Props, "searchParams">) {
  const params = await searchParams
  const viewer = await requireViewer()
  await ensureSetup()
  const accounts = await actions.listAccounts.handler({ includeArchived: true })
  return <AccountsBoard accounts={accounts} locale={viewer.locale} today={todayIn(viewer.timezone)} openNew={one(params.new) === "1"} />
}
