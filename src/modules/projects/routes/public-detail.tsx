import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { ArrowLeft, ArrowUpRight, Code, Globe, PlayCircle } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Markdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import { StatusPill } from "../components/status-pill"
import { getPublishedProject } from "../public"

type Props = PageProps<"/projects/[slug]">

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  await connection()
  const project = await getPublishedProject(slug)
  if (!project) return { title: "Project not found" }
  return { title: project.title, description: project.summary || undefined }
}

export default function PublicProjectPage({ params }: Props) {
  return (
    <div className="grid gap-4">
      <Link
        href="/projects"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 justify-self-start text-muted-foreground")}
      >
        <ArrowLeft />
        All projects
      </Link>
      <Suspense fallback={<CaseStudySkeleton />}>
        <CaseStudy params={params} />
      </Suspense>
    </div>
  )
}

async function CaseStudy({ params }: Pick<Props, "params">) {
  const { slug } = await params
  await connection()
  const project = await getPublishedProject(slug)
  if (!project) notFound()

  const links = [
    { href: project.liveUrl, label: "Visit the live site", icon: <Globe /> },
    { href: project.demoUrl, label: "Try the demo", icon: <PlayCircle /> },
    { href: project.repoUrl, label: "Read the code", icon: <Code /> },
  ].filter((l): l is typeof l & { href: string } => Boolean(l.href))

  return (
    <article className="grid gap-4">
      <header className="glass grid gap-4 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={project.status} />
          {project.role && <span className="text-meta text-muted-foreground">{project.role}</span>}
        </div>
        <h1 className="font-display text-3xl leading-tight font-bold tracking-[-0.03em] text-balance md:text-4xl">
          {project.title}
        </h1>
        {project.summary && <p className="max-w-prose text-base text-pretty text-muted-foreground">{project.summary}</p>}
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((link, i) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: i === 0 ? "default" : "outline", size: "lg" })}
              >
                {link.icon}
                {link.label}
                <ArrowUpRight className="size-3.5 opacity-70" />
              </a>
            ))}
          </div>
        )}
      </header>

      {project.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied hosts
        <img src={project.coverUrl} alt="" className="glass aspect-video w-full rounded-xl object-cover" />
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section className="glass rounded-xl p-4 text-[15px] md:p-6" aria-label="Case study">
          {project.body.trim() ? (
            <Markdown source={project.body} className="max-w-prose" />
          ) : (
            <p className="text-meta text-muted-foreground">The full write-up is coming soon.</p>
          )}
        </section>
        {project.stack.length > 0 && (
          <aside className="glass grid gap-2 rounded-xl p-4" aria-labelledby="stack-heading">
            <h2 id="stack-heading" className="text-eyebrow text-text-accent">
              Built with
            </h2>
            <ul className="flex flex-wrap gap-1.5">
              {project.stack.map((tag) => (
                <li key={tag} className="text-small rounded-md border border-hairline px-2 py-1">
                  {tag}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </article>
  )
}

function CaseStudySkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <div className="glass grid gap-4 rounded-xl p-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
