import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Page } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { calendarDate } from "@/lib/time"
import { actions } from "../actions"
import { GoalEditor } from "../components/goal-editor"
import { yearElapsed } from "../lib/progress"

const getGoal = cache(async (id: string) => (z.uuid().safeParse(id).success ? actions.get.handler({ id }) : null))

export async function generateMetadata({ params }: PageProps<"/app/goals/[id]">): Promise<Metadata> {
  const goal = await getGoal((await params).id)
  return { title: goal?.title ?? "Goal not found" }
}

export default function GoalDetailPage({ params }: PageProps<"/app/goals/[id]">) {
  return (
    <Page>
      <Suspense fallback={<EditorSkeleton />}>
        <Loader params={params} />
      </Suspense>
    </Page>
  )
}

async function Loader({ params }: Pick<PageProps<"/app/goals/[id]">, "params">) {
  const { id } = await params
  const [viewer, goal] = await Promise.all([requireViewer(), getGoal(id)])
  if (!goal) notFound()
  const today = calendarDate(new Date(), viewer.timezone)
  return (
    <GoalEditor
      key={goal.id}
      goal={goal}
      thisYear={today.year}
      elapsed={yearElapsed(today)}
      timezone={viewer.timezone}
      locale={viewer.locale}
    />
  )
}

export function NewGoalPage({ searchParams }: PageProps<"/app/goals/new">) {
  return (
    <Page>
      <Suspense fallback={<EditorSkeleton />}>
        <NewGoal searchParams={searchParams} />
      </Suspense>
    </Page>
  )
}

async function NewGoal({ searchParams }: Pick<PageProps<"/app/goals/new">, "searchParams">) {
  const [viewer, params] = await Promise.all([requireViewer(), searchParams])
  const today = calendarDate(new Date(), viewer.timezone)
  const asked = Number(params.year)
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : today.year
  return (
    <GoalEditor
      goal={null}
      thisYear={today.year}
      defaultYear={year}
      elapsed={yearElapsed(today)}
      timezone={viewer.timezone}
      locale={viewer.locale}
    />
  )
}

function EditorSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" aria-hidden>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
    </div>
  )
}
