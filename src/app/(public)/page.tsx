import { Suspense, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { ArrowRight, ChatText, Compass, Envelope } from "@/components/icons"
import { NAV_FORWARD, Page, Reveal, SkeletonExit } from "@/components/motion"
import { Meridian } from "@/components/site/meridian"
import { ScrollReveal } from "@/components/site/scroll-reveal"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { JsonLd } from "@/components/site/json-ld"
import { websiteJsonLd } from "@/lib/json-ld"
import { getSiteUrl, pageMetadata, siteDescription, siteName } from "@/lib/site"
import { cn } from "@/lib/utils"
import { getPublicCv } from "@/modules/cv/public"
import { cvPerson } from "@/modules/cv/seo"
import { getLatestPublishedIdeas } from "@/modules/ideas/public"
import { IdeaCard } from "@/modules/ideas/components/idea-card"
import { ProjectCard } from "@/modules/projects/components/project-card"
import { getFeaturedProjects } from "@/modules/projects/public"
import { GridSkeleton } from "@/modules/projects/routes/public-index"

export const metadata = pageMetadata({ title: null, description: siteDescription, path: "/", type: "profile" })

const facts = [
  { label: "Based in", value: "Prague, Czech Republic" },
  { label: "From", value: "Kazakhstan" },
  { label: "Studying", value: "Economics and Management, UCT Prague" },
  { label: "Speaks", value: "Russian · Kazakh · Czech · English" },
]

/** Staggered entrance: the n-th line of the hero rises after the one before it. */
const rise = (i: number) => ({ "--i": i }) as CSSProperties

// Static except the two content rows, which stream from the (cached) database.
export default function HomePage() {
  return (
    <Page>
      <div className="grid gap-10 md:gap-14">
        <Suspense fallback={null}>
          <HomeJsonLd />
        </Suspense>
        <section
          aria-labelledby="hero-title"
          className="glass grid gap-8 rounded-xl p-5 [--glass-shadow:var(--shadow-glass-lg)] sm:p-8 md:p-10"
        >
          <div className="grid gap-4">
            <p style={rise(0)} className="enter-rise text-eyebrow text-text-accent">
              Economics × web development
            </p>
            <h1
              id="hero-title"
              style={rise(1)}
              className="enter-rise max-w-3xl font-display text-[34px] leading-[1.05] font-bold tracking-[-0.035em] text-balance sm:text-5xl md:text-6xl"
            >
              Hi, I&apos;m Anwar. I build where business strategy meets code.
            </h1>
            <p
              style={rise(2)}
              className="enter-rise max-w-2xl text-base text-pretty text-muted-foreground md:text-lg"
            >
              I study Economics and Management at UCT Prague and build web products with TypeScript and React —
              things like a shift planner for restaurants and shops. The goal: lead teams that turn a business problem
              into software people actually use.
            </p>
            {/* The one path: read the CV, then the work, then say something. */}
            <div style={rise(3)} className="enter-rise grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-wrap">
              <Link
                href="/cv"
                transitionTypes={NAV_FORWARD}
                className={cn(buttonVariants({ size: "lg" }), "col-span-2 max-sm:h-11")}
              >
                Read the CV
                <ArrowRight />
              </Link>
              <Link
                href="/projects"
                transitionTypes={NAV_FORWARD}
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "max-sm:h-11")}
              >
                See projects
              </Link>
              <Link
                href="/contact"
                transitionTypes={NAV_FORWARD}
                className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "text-text-accent max-sm:h-11")}
              >
                <Envelope />
                Get in touch
              </Link>
            </div>
          </div>
          <div style={rise(4)} className="enter-rise">
            <Meridian />
          </div>
        </section>

        <ScrollReveal>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="glass grid content-start gap-1.5 rounded-xl p-4">
                <dt className="text-eyebrow text-text-accent">{f.label}</dt>
                <dd className="text-body-strong text-pretty">{f.value}</dd>
              </div>
            ))}
          </dl>
        </ScrollReveal>

        <ScrollReveal>
          <Link
            href="/now"
            transitionTypes={NAV_FORWARD}
            className="press group glass grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-xl p-4 outline-none transition-shadow hover:[--glass-shadow:var(--shadow-glass-lg)] focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Compass className="size-5" />
            </span>
            <span className="grid gap-0.5">
              <span className="text-card-title group-hover:text-text-accent">What I&apos;m doing now</span>
              <span className="text-meta text-pretty text-muted-foreground">
                This year&apos;s goals, what I&apos;m building and writing — kept current from my own data.
              </span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </ScrollReveal>

        <ScrollReveal>
          <Row title="Featured projects" href="/projects" more="All projects">
            <Suspense
              fallback={
                <SkeletonExit>
                  <GridSkeleton />
                </SkeletonExit>
              }
            >
              <Reveal>
                <Featured />
              </Reveal>
            </Suspense>
          </Row>
        </ScrollReveal>

        <ScrollReveal>
          <Row title="Latest ideas" href="/ideas" more="All ideas">
            <Suspense
              fallback={
                <SkeletonExit>
                  <IdeasSkeleton />
                </SkeletonExit>
              }
            >
              <Reveal>
                <LatestIdeas />
              </Reveal>
            </Suspense>
          </Row>
        </ScrollReveal>

        <ScrollReveal>
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
                An idea, a bug, a complaint — send it. Anonymous is fine. For a job or a project, use the{" "}
                <Link href="/contact" className="text-text-accent underline-offset-4 hover:underline">
                  contact form
                </Link>
                .
              </p>
            </div>
            <Link
              href="/feedback"
              transitionTypes={NAV_FORWARD}
              className={cn(buttonVariants({ size: "lg" }), "max-sm:h-11")}
            >
              Send feedback
            </Link>
          </section>
        </ScrollReveal>
      </div>
    </Page>
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
          transitionTypes={NAV_FORWARD}
          className="text-meta -my-3 -mr-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {more}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  )
}

/** WebSite + the owner as a Person (from the published CV), for search engines. */
async function HomeJsonLd() {
  await connection()
  const cv = await getPublicCv()
  const site = getSiteUrl().toString()
  return (
    <JsonLd
      nodes={[
        websiteJsonLd({ siteUrl: site, name: siteName, description: siteDescription }),
        cvPerson(cv, site, siteDescription),
      ]}
    />
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
