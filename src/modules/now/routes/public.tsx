import { Suspense, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { ArrowRight, Clock, Compass, Flame, MapPin } from "@/components/icons"
import { NAV_FORWARD, Page, Reveal, SkeletonExit } from "@/components/motion"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ProgressBar, ProgressLine } from "@/modules/goals/components/goal-progress"
import { formatPublished } from "@/modules/notes/lib/dates"
import { summaryOf } from "@/modules/notes/schema"
import { StatusPill } from "@/modules/projects/components/status-pill"
import { getNowPage, type NowPage } from "../public"

const rise = (i: number) => ({ "--i": i }) as CSSProperties

/**
 * /now, after nownownow.com: what the owner is focused on, generated from his
 * own data so it never goes stale. The heading is static; everything else
 * streams from cached reads.
 */
export default function PublicNowPage() {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-6 md:gap-8">
        <header className="glass grid gap-4 rounded-xl p-5 [--glass-shadow:var(--shadow-glass-lg)] sm:p-8">
          <p style={rise(0)} className="enter-rise text-eyebrow flex items-center gap-1.5 text-text-accent">
            <Compass className="size-3.5" />
            Now
          </p>
          <h1
            style={rise(1)}
            className="enter-rise font-display text-[34px] leading-[1.05] font-bold tracking-[-0.035em] text-balance sm:text-5xl"
          >
            What I&apos;m doing now
          </h1>
          <Suspense fallback={<IntroSkeleton />}>
            <Intro />
          </Suspense>
        </header>

        <Suspense
          fallback={
            <SkeletonExit>
              <SectionsSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Sections />
          </Reveal>
        </Suspense>

        <aside className="text-meta grid gap-1 px-1 text-muted-foreground">
          <p>
            This is a{" "}
            <a
              href="https://nownownow.com/about"
              target="_blank"
              rel="noreferrer"
              className="text-text-accent underline-offset-4 hover:underline"
            >
              now page
            </a>
            . It fills itself from the goals, projects and notes I keep in anwar.os, so it&apos;s as current as they are.
          </p>
          <p>
            Want to work on something together?{" "}
            <Link href="/contact" transitionTypes={NAV_FORWARD} className="text-text-accent underline-offset-4 hover:underline">
              Write to me
            </Link>
            .
          </p>
        </aside>
      </div>
    </Page>
  )
}

async function load(): Promise<NowPage> {
  // Request time only (no database at build); the reads themselves are cached.
  await connection()
  return getNowPage()
}

async function Intro() {
  const now = await load()
  return (
    <div style={rise(2)} className="enter-rise grid gap-3">
      {now.intro && (
        <p className="max-w-2xl text-base whitespace-pre-line text-pretty text-muted-foreground md:text-lg">{now.intro}</p>
      )}
      {(now.location || now.updatedAt) && (
        <p className="text-meta flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground tabular-nums">
          {now.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4 text-text-accent" />
              Based in {now.location}
            </span>
          )}
          {now.updatedAt && (
            <span className="flex items-center gap-1.5">
              <Clock className="size-4 text-text-accent" />
              Updated <time dateTime={now.updatedAt}>{formatPublished(now.updatedAt)}</time>
            </span>
          )}
        </p>
      )}
    </div>
  )
}

async function Sections() {
  const now = await load()
  const empty = !now.goals.length && !now.projects.length && !now.notes.length && !now.habits
  if (empty) {
    return (
      <div className="glass grid justify-items-start gap-3 rounded-xl p-6">
        <p className="text-card-title">Quiet week on the record</p>
        <p className="text-meta text-muted-foreground">
          Nothing to list right now. The projects show what I&apos;ve built so far.
        </p>
        <Link href="/projects" transitionTypes={NAV_FORWARD} className={cn(buttonVariants({ size: "lg" }), "max-sm:h-11")}>
          See projects
          <ArrowRight />
        </Link>
      </div>
    )
  }
  const building = now.projects.some((p) => p.status === "building")
  return (
    <div className="grid gap-8">
      {now.goals.length > 0 && (
        <Section id="now-focus" title="Current focus" hint="This year's goals, and how far along they are.">
          <ul className="grid gap-3 sm:grid-cols-2">
            {now.goals.map((goal) => (
              <li key={goal.id} className="glass grid content-start gap-3 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-body-strong text-pretty">{goal.title}</h3>
                  {goal.status === "done" && (
                    <span className="text-micro shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                      Achieved
                    </span>
                  )}
                </div>
                <ProgressBar goal={goal} className="h-2" />
                <ProgressLine goal={goal} locale="en-GB" className="text-meta" />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {now.projects.length > 0 && (
        <Section
          id="now-projects"
          title={building ? "Building" : "Projects"}
          hint={building ? "What I'm working on, and what I'm proud of." : "Work I'm proud of."}
          more={{ href: "/projects", label: "All projects" }}
        >
          <ul className="grid gap-3">
            {now.projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.slug}`}
                  transitionTypes={NAV_FORWARD}
                  className="press group glass grid gap-1.5 rounded-xl p-4 outline-none transition-shadow hover:[--glass-shadow:var(--shadow-glass-lg)] focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-card-title group-hover:text-text-accent">{project.title}</span>
                    <StatusPill status={project.status} />
                  </span>
                  {project.summary && <span className="text-meta text-pretty text-muted-foreground">{project.summary}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {now.notes.length > 0 && (
        <Section id="now-writing" title="Latest writing" more={{ href: "/writing", label: "All writing" }}>
          <ol className="grid gap-3">
            {now.notes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/writing/${note.slug}`}
                  transitionTypes={NAV_FORWARD}
                  className="press group glass grid gap-1 rounded-xl p-4 outline-none transition-shadow hover:[--glass-shadow:var(--shadow-glass-lg)] focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <time dateTime={note.publishedAt} className="text-meta text-muted-foreground tabular-nums">
                    {formatPublished(note.publishedAt)}
                  </time>
                  <span className="text-card-title text-balance group-hover:text-text-accent">{note.title}</span>
                  {summaryOf(note) && (
                    <span className="text-meta line-clamp-2 text-pretty text-muted-foreground">{summaryOf(note)}</span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {now.habits && (
        <section aria-labelledby="now-habits" className="glass flex items-center gap-3 rounded-xl p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Flame className="size-5" />
          </span>
          <div className="grid gap-0.5">
            <h2 id="now-habits" className="text-eyebrow text-text-accent">
              Habits
            </h2>
            <p className="text-body-strong tabular-nums">{now.habits}</p>
          </div>
        </section>
      )}
    </div>
  )
}

function Section({
  id,
  title,
  hint,
  more,
  children,
}: {
  id: string
  title: string
  hint?: string
  more?: { href: string; label: string }
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 id={id} className="text-heading">
            {title}
          </h2>
          {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
        </div>
        {more && (
          <Link
            href={more.href}
            transitionTypes={NAV_FORWARD}
            className="text-meta -my-3 -mr-2 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {more.label}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function IntroSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-5 w-full max-w-xl" />
      <Skeleton className="h-4 w-56" />
    </div>
  )
}

function SectionsSkeleton() {
  return (
    <div className="grid gap-8" aria-hidden>
      <div className="grid gap-3">
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      </div>
      <div className="grid gap-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    </div>
  )
}
