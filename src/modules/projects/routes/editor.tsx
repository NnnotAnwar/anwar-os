import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { ProjectEditor } from "../components/project-editor"

const getProject = cache(async (id: string) =>
  z.uuid().safeParse(id).success ? actions.get.handler({ id }) : null,
)

export async function generateMetadata({ params }: PageProps<"/app/projects/[id]">): Promise<Metadata> {
  const project = await getProject((await params).id)
  return { title: project?.title ?? "Project not found" }
}

export default function ProjectDetailPage({ params }: PageProps<"/app/projects/[id]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Loader params={params} />
    </Suspense>
  )
}

async function Loader({ params }: Pick<PageProps<"/app/projects/[id]">, "params">) {
  const { id } = await params
  const [viewer, project] = await Promise.all([requireViewer(), getProject(id)])
  if (!project) notFound()
  return <ProjectEditor key={project.id} project={project} timezone={viewer.timezone} locale={viewer.locale} />
}

export function NewProjectPage() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <NewProject />
    </Suspense>
  )
}

async function NewProject() {
  const viewer = await requireViewer()
  return <ProjectEditor project={null} timezone={viewer.timezone} locale={viewer.locale} />
}

function EditorSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4" aria-hidden>
      <Skeleton className="h-8 w-40" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  )
}
