import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ArrowRight, ArrowUpRight, Code, Globe, PlayCircle } from "@/components/icons"
import { Morph, NAV_BACK, NAV_FORWARD, Page } from "@/components/motion"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Markdown, markdownOutline } from "@/lib/markdown"
import { readingMinutes } from "@/lib/reading"
import { JsonLd } from "@/components/site/json-ld"
import { getSiteUrl } from "@/lib/site"
import { cn } from "@/lib/utils"
import { CaseStudyToc } from "../components/case-study-toc"
import { morphNames } from "../components/project-card"
import { StatusPill } from "../components/status-pill"
import { getPublishedProject, getPublishedProjects } from "../public"
import { statusLabels, type PublicProject } from "../schema"
import { projectJsonLd, projectMetadata } from "../seo"

type Props = PageProps<"/projects/[slug]">

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const project = await getPublishedProject(slug)
  if (!project) return { title: "Project not found", robots: { index: false } }
  return projectMetadata(project)
}

export default function PublicProjectPage({ params }: Props) {
  return (
    <Suspense fallback={<CaseStudySkeleton />}>
      <CaseStudy params={params} />
    </Suspense>
  )
}

async function CaseStudy({ params }: Pick<Props, "params">) {
  const { slug } = await params
  // No connection(): params already keep this out of the build, and both reads are
  // cached, so a <Link prefetch> resolves the whole case study before the click —
  // which is what lets the card morph into the hero in one commit.
  const [project, all] = await Promise.all([getPublishedProject(slug), getPublishedProjects()])
  if (!project) notFound()

  const names = morphNames(project.id)
  const outline = markdownOutline(project.body)
  // A table of contents earns its place only when there's something to skip between.
  const toc = outline.filter((h) => h.level === 2).length >= 3 ? outline.filter((h) => h.level <= 3) : []
  const minutes = readingMinutes(project.body)
  const index = all.findIndex((p) => p.id === project.id)
  const previous = index > 0 ? all[index - 1] : undefined
  const next = index >= 0 && index < all.length - 1 ? all[index + 1] : undefined

  const links = [
    { href: project.liveUrl, label: "Visit the live site", icon: <Globe /> },
    { href: project.demoUrl, label: "Try the demo", icon: <PlayCircle /> },
    { href: project.repoUrl, label: "Read the code", icon: <Code /> },
  ].filter((l): l is typeof l & { href: string } => Boolean(l.href))

  return (
    // Keyed by project so previous / next between case studies slides too.
    <Page key={project.id}>
      <article className="grid gap-4">
        <JsonLd nodes={projectJsonLd(project, getSiteUrl().toString())} />
        <Link
          href="/projects"
          transitionTypes={NAV_BACK}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 justify-self-start text-muted-foreground max-md:h-11 max-md:px-3",
          )}
        >
          <ArrowLeft />
          All projects
        </Link>

        <header className="glass grid gap-4 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-6">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={project.status} />
            {project.role && <span className="text-meta text-muted-foreground">{project.role}</span>}
            {minutes > 0 && (
              <span className="text-meta text-muted-foreground tabular-nums">· {minutes} min read</span>
            )}
          </div>
          <Morph name={names.title}>
            <h1 className="w-fit font-display text-3xl leading-tight font-bold tracking-[-0.03em] text-balance md:text-4xl">
              {project.title}
            </h1>
          </Morph>
          {project.summary && (
            <p className="max-w-prose text-base text-pretty text-muted-foreground md:text-lg">{project.summary}</p>
          )}
          {links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {links.map((link, i) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: i === 0 ? "default" : "outline", size: "lg" }),
                    "max-sm:h-11 max-sm:flex-1",
                  )}
                >
                  {link.icon}
                  {link.label}
                  <ArrowUpRight className="size-3.5 opacity-70" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ))}
            </div>
          )}
        </header>

        {project.coverUrl && (
          <Morph name={names.cover}>
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-supplied hosts */}
            <img
              src={project.coverUrl}
              alt={`${project.title}, screenshot`}
              fetchPriority="high"
              className="glass aspect-video w-full rounded-xl object-cover"
            />
          </Morph>
        )}

        {toc.length > 0 && <CaseStudyToc items={toc} variant="inline" />}

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <section className="glass rounded-xl p-4 text-[15px] md:p-8" aria-label="Case study">
            {project.body.trim() ? (
              <Markdown source={project.body} outline className="max-w-prose" />
            ) : (
              <p className="text-meta text-muted-foreground">The full write-up is coming soon.</p>
            )}
          </section>
          {(toc.length > 0 || project.stack.length > 0) && (
            <aside className="grid gap-4 lg:sticky lg:top-24">
              {toc.length > 0 && (
                <div className="glass rounded-xl p-3 max-lg:hidden">
                  <CaseStudyToc items={toc} variant="aside" />
                </div>
              )}
              {project.stack.length > 0 && (
                <section className="glass grid gap-2 rounded-xl p-4" aria-labelledby="stack-heading">
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
                </section>
              )}
            </aside>
          )}
        </div>

        {(previous || next) && (
          <nav aria-label="More projects" className="grid gap-3 pt-2 sm:grid-cols-2">
            {previous ? <Neighbour project={previous} direction="previous" /> : <span aria-hidden />}
            {next && <Neighbour project={next} direction="next" />}
          </nav>
        )}
      </article>
    </Page>
  )
}

function Neighbour({ project, direction }: { project: PublicProject; direction: "previous" | "next" }) {
  const isNext = direction === "next"
  return (
    <Link
      href={`/projects/${project.slug}`}
      transitionTypes={isNext ? NAV_FORWARD : NAV_BACK}
      className={cn(
        "press group glass grid min-h-20 content-center gap-1 rounded-xl p-4 outline-none transition-shadow hover:[--glass-shadow:var(--shadow-glass-lg)] focus-visible:ring-3 focus-visible:ring-ring/50",
        isNext && "text-right sm:col-start-2",
      )}
    >
      <span className={cn("text-eyebrow flex items-center gap-1.5 text-text-accent", isNext && "justify-end")}>
        {!isNext && <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />}
        {isNext ? "Next project" : "Previous project"}
        {isNext && <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />}
      </span>
      <span className="text-card-title">{project.title}</span>
      <span className="text-caption text-muted-foreground">{statusLabels[project.status]}</span>
    </Link>
  )
}

function CaseStudySkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-7 w-28" />
      <div className="glass grid gap-4 rounded-xl p-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <Skeleton className="aspect-video rounded-xl" />
    </div>
  )
}
