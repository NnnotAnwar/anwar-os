import { Suspense } from "react"
import { Reveal, SkeletonExit } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { ImportWizard } from "../components/import"
import { BudgetPage, ensureSetup } from "./shell"

export default function ImportPage() {
  return (
    <BudgetPage
      title="Import CSV"
      description="Bring in a bank export. Rows already in the account (same date, amount and note) are skipped, so importing twice is safe."
    >
      <Suspense
        fallback={
          <SkeletonExit>
            <Skeleton className="h-64 rounded-xl" aria-hidden />
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
  const accounts = await actions.listAccounts.handler({ includeArchived: false })
  return <ImportWizard accounts={accounts} locale={viewer.locale} />
}
