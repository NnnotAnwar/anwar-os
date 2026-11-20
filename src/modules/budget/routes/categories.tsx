import { Suspense } from "react"
import { Reveal, SkeletonExit } from "@/components/motion"
import { actions } from "../actions"
import { CategoriesBoard } from "../components/categories"
import { BudgetPage, ensureSetup, ListSkeleton } from "./shell"

export default function CategoriesPage() {
  return (
    <BudgetPage
      title="Categories"
      description="One level of subcategories; spending rolls up into the parent on the overview. Deleting one leaves its transactions uncategorised."
    >
      <Suspense
        fallback={
          <SkeletonExit>
            <ListSkeleton rows={8} />
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
  await ensureSetup()
  const categories = await actions.listCategories.handler({ includeArchived: true })
  return <CategoriesBoard categories={categories} />
}
