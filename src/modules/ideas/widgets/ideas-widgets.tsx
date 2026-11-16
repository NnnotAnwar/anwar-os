import Link from "next/link"
import { actions } from "../actions"
import { activeStatuses } from "../schema"
import { IdeaStatusPill } from "../components/idea-status"

const rowClass =
  "flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"

/** Today: what's being explored or built right now. */
export async function IdeasInProgress() {
  const ideas = await actions.list.handler({ status: activeStatuses, limit: 6 })
  if (ideas.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        Nothing in progress.{" "}
        <Link href="/app/ideas" className="text-text-accent underline-offset-4 hover:underline">
          Pick an idea to explore
        </Link>
      </p>
    )
  }
  return (
    <ul className="grid gap-0.5">
      {ideas.map((idea) => (
        <li key={idea.id}>
          <Link href={`/app/ideas/${idea.id}`} className={rowClass}>
            <span className="text-body min-w-0 flex-1 truncate">{idea.title}</span>
            <IdeaStatusPill status={idea.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
