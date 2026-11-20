import { Suspense } from "react"
import { connection } from "next/server"
import { Lightbulb } from "@/components/icons"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { IdeaCard } from "../components/idea-card"
import { getPublishedIdeas } from "../public"
import type { IdeaStatus } from "../schema"

export default function PublicIdeasPage() {
  return (
    <Page>
      <div className="grid gap-6">
        <PageHeader
          eyebrow="Ideas"
          title="Thinking out loud"
          description="Ideas I'm exploring, building or have shipped — published on purpose, so you can tell me which ones are worth it."
        />
        <Suspense
          fallback={
            <SkeletonExit>
              <IdeasSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Ideas />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

const groups: { title: string; statuses: IdeaStatus[] }[] = [
  { title: "In progress", statuses: ["building", "exploring"] },
  { title: "On the list", statuses: ["raw"] },
  { title: "Done", statuses: ["shipped", "dropped"] },
]

async function Ideas() {
  await connection()
  const ideas = await getPublishedIdeas()
  if (ideas.length === 0) {
    return (
      <div className="glass grid justify-items-start gap-2 rounded-xl p-6">
        <Lightbulb className="size-6 text-text-accent" />
        <p className="text-card-title">No public ideas yet</p>
        <p className="text-meta text-muted-foreground">The first ones will appear here soon.</p>
      </div>
    )
  }
  return (
    <div className="grid gap-6">
      {groups.map((group) => {
        const items = ideas.filter((idea) => group.statuses.includes(idea.status))
        if (items.length === 0) return null
        const id = `group-${group.title.toLowerCase().replace(/\s+/g, "-")}`
        return (
          <section key={group.title} aria-labelledby={id} className="grid gap-3">
            <h2 id={id} className="text-eyebrow text-text-accent">
              {group.title} <span className="tabular-nums text-muted-foreground">· {items.length}</span>
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {items.map((idea) => (
                <li key={idea.id}>
                  <IdeaCard idea={idea} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function IdeasSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="glass grid gap-3 rounded-xl p-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  )
}
