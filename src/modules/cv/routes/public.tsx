import { Suspense, type ReactNode } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { IdCard } from "@/components/icons"
import { Skeleton } from "@/components/ui/skeleton"
import { Markdown, safeHref } from "@/lib/markdown"
import { PrintButton } from "../components/print-button"
import { getPublicCv } from "../public"
import { formatPeriod, type Cv, type Education, type Experience } from "../schema"
import "../print.css"

export default function PublicCvPage() {
  return (
    <Suspense fallback={<SheetSkeleton />}>
      <Resume />
    </Suspense>
  )
}

async function Resume() {
  // Request time only (no database at build); the read itself is cached.
  await connection()
  const cv = await getPublicCv()
  if (!cv) return <NotPublished />
  return <Sheet cv={cv} />
}

function Sheet({ cv }: { cv: Cv }) {
  const profile = cv.profile!
  const skillGroups = groupSkills(cv.skills)

  return (
    <article className="cv-sheet glass mx-auto grid w-full max-w-3xl gap-7 rounded-xl p-5 [--glass-shadow:var(--shadow-glass-lg)] sm:p-8 md:p-10">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <h1 className="font-display text-3xl leading-tight font-bold tracking-[-0.03em] md:text-4xl print:text-[22pt]">
              {profile.fullName || "Curriculum vitae"}
            </h1>
            {profile.headline && <p className="text-base text-pretty text-muted-foreground">{profile.headline}</p>}
          </div>
          <PrintButton />
        </div>
        {(profile.location || profile.contacts.length > 0) && (
          <ul className="text-meta flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {profile.location && <li>{profile.location}</li>}
            {profile.contacts.map((c) => {
              const href = c.url ? safeHref(c.url) : null
              return (
                <li key={`${c.label}-${c.value}`}>
                  {c.label && <span className="sr-only">{c.label}: </span>}
                  {href ? (
                    <a href={href} className="text-foreground underline-offset-4 hover:text-text-accent hover:underline">
                      {c.value}
                    </a>
                  ) : (
                    <span className="text-foreground">{c.value}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {profile.summary && <p className="max-w-prose text-[15px] leading-7 text-pretty print:text-[10pt] print:leading-normal">{profile.summary}</p>}
      </header>

      {cv.experience.length > 0 && (
        <Section title="Experience">
          {cv.experience.map((e) => (
            <Entry key={e.id} item={e} title={e.role} subtitle={e.organization} />
          ))}
        </Section>
      )}

      {cv.education.length > 0 && (
        <Section title="Education">
          {cv.education.map((e) => (
            <Entry key={e.id} item={e} title={e.degree || e.institution} subtitle={e.degree ? e.institution : ""} />
          ))}
        </Section>
      )}

      {(skillGroups.length > 0 || cv.languages.length > 0) && (
        <div className="grid gap-7 sm:grid-cols-2 print:grid-cols-2">
          {skillGroups.length > 0 && (
            <Section title="Skills" flat>
              <dl className="grid gap-2">
                {skillGroups.map(([group, names]) => (
                  <div key={group} className="cv-entry grid gap-0.5">
                    {group && <dt className="text-small text-muted-foreground">{group}</dt>}
                    <dd className="text-body">{names.join(" · ")}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          {cv.languages.length > 0 && (
            <Section title="Languages" flat>
              <ul className="grid gap-1.5">
                {cv.languages.map((l) => (
                  <li key={l.id} className="cv-entry flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5 last:border-0">
                    <span className="text-body-strong">{l.name}</span>
                    {l.level && <span className="text-meta text-muted-foreground">{l.level}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </article>
  )
}

function Section({ title, children, flat }: { title: string; children: ReactNode; flat?: boolean }) {
  const id = `cv-${title.toLowerCase()}`
  return (
    <section aria-labelledby={id} className="grid content-start gap-3">
      <h2 id={id} className="cv-section-head text-eyebrow flex items-center gap-3 text-text-accent">
        {title}
        <span aria-hidden className="h-px flex-1 bg-hairline" />
      </h2>
      {flat ? children : <ol className="grid gap-5">{children}</ol>}
    </section>
  )
}

function Entry({ item, title, subtitle }: { item: Experience | Education; title: string; subtitle: string }) {
  const period = formatPeriod(item.startOn, item.endOn)
  const current = Boolean(item.startOn && !item.endOn)
  return (
    <li className="cv-entry grid gap-1 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-4 print:grid-cols-[36mm_minmax(0,1fr)]">
      <p className="text-meta flex items-start gap-1.5 text-muted-foreground tabular-nums sm:pt-0.5">
        {current && (
          // The accent marks "now": this role is ongoing.
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary print:hidden" />
        )}
        {period}
      </p>
      <div className="grid gap-1">
        <h3 className="text-body-strong text-[15px] print:text-[10.5pt]">
          {title}
          {subtitle && <span className="font-medium text-muted-foreground"> · {subtitle}</span>}
        </h3>
        {item.location && <p className="text-caption text-muted-foreground">{item.location}</p>}
        {item.description && (
          <Markdown
            source={item.description}
            className="text-meta text-pretty [&_li]:leading-6 [&_p]:leading-6 [&_ul]:my-1.5 print:[&_li]:leading-snug print:[&_p]:leading-snug"
          />
        )}
      </div>
    </li>
  )
}

function groupSkills(skills: Cv["skills"]): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const s of skills) {
    const key = s.category.trim()
    groups.set(key, [...(groups.get(key) ?? []), s.name])
  }
  return [...groups]
}

function NotPublished() {
  return (
    <div className="glass mx-auto grid w-full max-w-3xl justify-items-start gap-2 rounded-xl p-6">
      <IdCard className="size-6 text-text-accent" />
      <h1 className="text-card-title">The CV isn’t public yet</h1>
      <p className="text-meta text-muted-foreground">
        In the meantime, look at the{" "}
        <Link href="/projects" className="text-text-accent underline-offset-4 hover:underline">
          projects
        </Link>{" "}
        or{" "}
        <Link href="/feedback" className="text-text-accent underline-offset-4 hover:underline">
          send a message
        </Link>
        .
      </p>
    </div>
  )
}

function SheetSkeleton() {
  return (
    <div className="glass mx-auto grid w-full max-w-3xl gap-6 rounded-xl p-8" aria-hidden>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
