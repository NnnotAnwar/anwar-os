import { Suspense } from "react"
import Link from "next/link"
import { ArrowUpRight, Briefcase, Plus } from "@/components/icons"
import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions as opsActions } from "@/modules/ops/actions"
import { serviceStatus, shortTag, statusLabels } from "@/modules/ops/lib/status"
import { actions } from "../actions"
import { ProjectList, type DeployState } from "../components/project-list"

export default function ProjectsPage() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <PageHeader
        eyebrow="Showcase"
        title="Projects"
        description="Published projects appear on /projects in this order. Featured ones also show on the landing page."
        actions={
          <>
            <Link href="/projects" target="_blank" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Public page
              <ArrowUpRight />
            </Link>
            <Link href="/app/projects/new" className={buttonVariants({ size: "sm" })}>
              <Plus />
              New project
            </Link>
          </>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <Projects />
      </Suspense>
    </div>
  )
}

async function Projects() {
  const viewer = await requireViewer()
  const projects = await actions.list.handler({ limit: 200 })
  if (projects.length === 0) return <EmptyState />
  const published = projects.filter((p) => p.isPublic).length
  const deploys = projects.some((p) => p.serviceName) ? await deployStates() : undefined
  return (
    <div className="grid gap-2">
      <p className="text-meta text-muted-foreground tabular-nums">
        {published} of {projects.length} published
      </p>
      <ProjectList projects={projects} locale={viewer.locale} now={new Date().toISOString()} deploys={deploys} />
    </div>
  )
}

/** Deploy state per Ops service, for projects linked to one. Empty when the panel isn't connected. */
async function deployStates(): Promise<Record<string, DeployState>> {
  try {
    const res = await opsActions.services.handler({ stats: false })
    if (!res.connected) return {}
    return Object.fromEntries(
      res.services.map((s) => {
        const status = serviceStatus(s)
        return [s.name, { label: `${statusLabels[status]} · ${shortTag(s.tag)}`, ok: status === "ok", down: status === "down" || status === "attention" }]
      }),
    )
  } catch {
    return {}
  }
}

function EmptyState() {
  return (
    <div className="glass grid justify-items-start gap-4 rounded-xl p-6">
      <Briefcase className="size-6 text-text-accent" />
      <div className="grid gap-1">
        <p className="text-card-title">Show what you’ve built</p>
        <p className="text-meta max-w-prose text-muted-foreground">
          Add a project with a short summary and a case study. It stays a draft until you publish it; feature the best
          ones on the landing page.
        </p>
      </div>
      <Link href="/app/projects/new" className={buttonVariants()}>
        <Plus />
        Add the first project
      </Link>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="glass grid gap-px overflow-hidden rounded-xl" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="grid gap-2 px-4 py-3.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ))}
    </div>
  )
}
