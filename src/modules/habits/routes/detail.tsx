import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Page } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { HabitDetailView } from "../components/habit-detail"

const MONTH = /^\d{4}-\d{2}$/
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)

const getHabit = cache(async (id: string, month?: string) =>
  z.uuid().safeParse(id).success ? actions.get.handler({ id, month: month && MONTH.test(month) ? month : undefined }) : null,
)

export async function generateMetadata({ params }: PageProps<"/app/habits/[id]">): Promise<Metadata> {
  const detail = await getHabit((await params).id)
  return { title: detail?.habit.name ?? "Habit not found" }
}

export default function HabitPage({ params, searchParams }: PageProps<"/app/habits/[id]">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <Suspense fallback={<DetailSkeleton />}>
          <Loader params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </Page>
  )
}

async function Loader({ params, searchParams }: Pick<PageProps<"/app/habits/[id]">, "params" | "searchParams">) {
  const [{ id }, query, viewer] = await Promise.all([params, searchParams, requireViewer()])
  const detail = await getHabit(id, one(query.month))
  if (!detail) notFound()
  return <HabitDetailView key={`${detail.habit.id}:${detail.month}`} detail={detail} locale={viewer.locale} />
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-64 max-w-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}
