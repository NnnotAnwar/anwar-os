import { Suspense } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { Briefcase } from "@/components/icons"
import { NAV_FORWARD, Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ProjectCard } from "../components/project-card"
import { getPublishedProjects } from "../public"

export default function PublicProjectsPage() {
  return (
    <Page>
      <div className="grid gap-6">
        <PageHeader
          eyebrow="Projects"
          title="Things I've built"
          description="Products, experiments and coursework — each with a short case study and, where it exists, a live demo."
        />
        <Suspense
          fallback={
            <SkeletonExit>
              <GridSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Grid />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

async function Grid() {
  // Request time only: the build has no database. The read itself is cached.
  await connection()
  const projects = await getPublishedProjects()
  if (projects.length === 0) {
    return (
      <div className="glass grid justify-items-start gap-2 rounded-xl p-6">
        <Briefcase className="size-6 text-text-accent" />
        <p className="text-card-title">Case studies are on their way</p>
        <p className="text-meta text-muted-foreground">Check back soon, or read the CV in the meantime.</p>
        <Link href="/cv" transitionTypes={NAV_FORWARD} className={buttonVariants({ size: "lg" })}>
          Read the CV
        </Link>
      </div>
    )
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <li key={project.id}>
          <ProjectCard project={project} />
        </li>
      ))}
    </ul>
  )
}

export function GridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="glass grid gap-3 rounded-xl p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ))}
    </div>
  )
}
