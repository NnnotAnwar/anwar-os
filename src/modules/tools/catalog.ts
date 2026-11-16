import { Calculator, Flame, Sigma, TrendingUp, type AppIcon } from "@/components/icons"

export type ToolInfo = {
  slug: string
  title: string
  description: string
  icon: AppIcon
}

/** Every calculator, in display order. Slugs are route segments under /tools and /app/tools. */
export const TOOLS = [
  {
    slug: "calories",
    title: "Calories",
    description: "Daily calories and macros from your age, size and activity, using Mifflin–St Jeor.",
    icon: Flame,
  },
  {
    slug: "calculator",
    title: "Calculator",
    description: "Arithmetic with parentheses and percent. Type it or tap it.",
    icon: Calculator,
  },
  {
    slug: "statistics",
    title: "Statistics",
    description: "Paste a list of numbers for mean, median, standard deviation, percentiles and a histogram.",
    icon: Sigma,
  },
  {
    slug: "compound",
    title: "Compound growth",
    description: "See what a starting amount and monthly savings grow into, year by year.",
    icon: TrendingUp,
  },
] as const satisfies readonly ToolInfo[]

export type ToolSlug = (typeof TOOLS)[number]["slug"]

export function toolInfo(slug: ToolSlug): ToolInfo {
  return TOOLS.find((t) => t.slug === slug)!
}

/** Page metadata for a calculator route. */
export function toolMetadata(slug: ToolSlug) {
  const { title, description } = toolInfo(slug)
  return { title, description }
}
