import "server-only"
import type { SearchProvider } from "@/core/module"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"
import { percent, progressLabel } from "./lib/progress"
import { goalStatusLabels } from "./schema"

/** The viewer's goals of any year by title or why. */
export const search: SearchProvider = async (query, limit) => {
  const goals = await actions.search.handler({ query, limit })
  return goals.map((goal) => {
    const pct = percent(goal.progress)
    return {
      id: goal.id,
      title: goal.title,
      snippet: excerptAround(goal.why, query, 80) || undefined,
      meta: [String(goal.year), goalStatusLabels[goal.status], progressLabel(goal.progress, "en-US")],
      aside: pct === null ? undefined : `${pct}%`,
      href: `/app/goals/${goal.id}`,
    }
  })
}
