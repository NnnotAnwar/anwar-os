import { Suspense, type ReactNode } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { ArrowRight, ChatText } from "@/components/icons"
import { Meridian } from "@/components/site/meridian"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getLatestPublishedIdeas } from "@/modules/ideas/public"
import { IdeaCard } from "@/modules/ideas/components/idea-card"
import { ProjectCard } from "@/modules/projects/components/project-card"
import { getFeaturedProjects } from "@/modules/projects/public"
import { GridSkeleton } from "@/modules/projects/routes/public-index"

export const metadata = {
  title: { absolute: "Anwar — economics student and web developer in Prague" },
}

const facts = [
  { label: "Based in", value: "Prague, Czech Republic" },
  { label: "From", value: "Kazakhstan" },
  { label: "Studying", value: "Economics and Management, UCT Prague" },
  { label: "Speaks", value: "Russian · Kazakh · Czech · English" },
]

// Static except the two content rows, which stream from the (cached) database.
export default function HomePage() {
  return (
    <div className="grid gap-10 md:gap-14">
      <section
        aria-labelledby="hero-title"
        className="glass grid gap-8 rounded-xl p-5 [--glass-shadow:var(--shadow-glass-lg)] sm:p-8 md:p-10"
      >
        <div className="grid gap-4">
          <p className="text-eyebrow text-text-accent">Economics × web development</p>
          <h1
            id="hero-title"
            className="max-w-3xl font-display text-[34px] leading-[1.05] font-bold tracking-[-0.035em] text-balance sm:text-5xl md:text-6xl"
          >
            Hi, I&apos;m Anwar. I build where business strategy meets code.
          </h1>
          <p className="max-w-2xl text-base text-pretty text-muted-foreground md:text-lg">
            I study Economics and Management at UCT Prague and build web products with TypeScript and React —
            things like a shift planner for restaurants and shops. The goal: lead teams that turn a business problem
            into software people actually use.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/cv" className={buttonVariants({ size: "lg" })}>
              Read the CV
              <ArrowRight />
            </Link>
            <Link href="/projects" className={buttonVariants({ variant: "outline", size: "lg" })}>
              See projects
            </Link>
          </div>
        </div>
        <Meridian />
      </section>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="glass grid content-start gap-1.5 rounded-xl p-4">
            <dt className="text-eyebrow text-text-accent">{f.label}</dt>
            <dd className="text-body-strong text-pretty">{f.value}</dd>
          </div>
        ))}
      </dl>

      <Row title="Featured projects" href="/projects" more="All projects">
        <Suspense fallback={<GridSkeleton />}>
          <Featured />
        </Suspense>
      </Row>

      <Row title="Latest ideas" href="/ideas" more="All ideas">
        <Suspense fallback={<IdeasSkeleton />}>
          <LatestIdeas />
        </Suspense>
      </Row>

      <section
        aria-labelledby="feedback-title"
        className="glass grid gap-4 rounded-xl p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-6"
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <ChatText className="size-5" />
        </span>
        <div className="grid gap-1">
          <h2 id="feedback-title" className="text-card-title">
            Something to say?
          </h2>
          <p className="text-meta text-muted-foreground">
            An idea, a bug, a job, a complaint — send it. Anonymous is fine.
          </p>
        </div>
        <Link href="/feedback" className={buttonVariants({ size: "lg" })}>
          Send feedback
        </Link>
      </section>
    </div>
  )
}

function Row({ title, href, more, children }: { title: string; href: string; more: string; children: ReactNode }) {
  const id = title.toLowerCase().replace(/\s+/g, "-")
  return (
    <section aria-labelledby={id} className="grid gap-4">
      <div className="flex items-end justify-between gap-3">
        <h2 id={id} className="text-greeting">
          {title}
        </h2>
        <Link
          href={href}
          className="text-meta flex items-center gap-1 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {more}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  )
}

async function Featured() {
  await connection()
  const projects = await getFeaturedProjects(3)
  if (projects.length === 0) {
    return <p className="text-meta glass rounded-xl p-4 text-muted-foreground">Case studies are on their way.</p>
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <li key={project.id}>
          <ProjectCard project={project} headingLevel="h3" />
        </li>
      ))}
    </ul>
  )
}

async function LatestIdeas() {
  await connection()
  const ideas = await getLatestPublishedIdeas(4)
  if (ideas.length === 0) {
    return <p className="text-meta glass rounded-xl p-4 text-muted-foreground">No public ideas yet — soon.</p>
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {ideas.map((idea) => (
        <li key={idea.id}>
          <IdeaCard idea={idea} compact />
        </li>
      ))}
    </ul>
  )
}

function IdeasSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="glass grid gap-3 rounded-xl p-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ))}
    </div>
  )
}
