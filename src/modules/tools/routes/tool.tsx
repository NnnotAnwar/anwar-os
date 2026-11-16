import type { ComponentType } from "react"
import Link from "next/link"
import { ArrowLeft } from "@/components/icons"
import { PageHeader } from "@/components/shell/page-header"
import { toolInfo, type ToolSlug } from "../catalog"
import { BasicCalculator } from "../components/basic-calculator"
import { CaloriesCalculator } from "../components/calories-calculator"
import { CompoundCalculator } from "../components/compound-calculator"
import { StatisticsCalculator } from "../components/statistics-calculator"
import type { ToolsBase } from "./index"

const CALCULATORS: Record<ToolSlug, ComponentType> = {
  calories: CaloriesCalculator,
  calculator: BasicCalculator,
  statistics: StatisticsCalculator,
  compound: CompoundCalculator,
}

/** One calculator page. The calculator itself is a client component; the frame is static. */
export function ToolPage({ slug, base }: { slug: ToolSlug; base: ToolsBase }) {
  const { title, description } = toolInfo(slug)
  const Calculator = CALCULATORS[slug]
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 md:gap-8">
      <div className="grid gap-3">
        <Link
          href={base}
          className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All tools
        </Link>
        <PageHeader title={title} />
        <p className="max-w-prose text-pretty text-muted-foreground">{description}</p>
      </div>
      <Calculator />
    </div>
  )
}
