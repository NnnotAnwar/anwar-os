import { Suspense } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { safeHref } from "@/lib/markdown"
import { getPublicCv } from "@/modules/cv/public"
import { siteLinks } from "./site-links"

/** Footer: contacts come from the published CV profile, so there is one place to edit them. */
export function SiteFooter() {
  return (
    <footer className="glass mx-3 mb-[calc(0.75rem+env(safe-area-inset-bottom))] grid gap-4 rounded-xl p-4 md:mx-6 md:mb-6 md:grid-cols-[minmax(0,1fr)_auto] md:p-5 print:hidden">
      <div className="grid gap-2">
        <p className="text-heading">Get in touch</p>
        <Suspense fallback={<p className="text-meta text-muted-foreground">Loading contacts…</p>}>
          <Contacts />
        </Suspense>
      </div>
      <div className="grid content-start gap-2 md:justify-items-end">
        <ul className="text-meta -mx-2 flex flex-wrap gap-y-0 text-muted-foreground md:mx-0 md:gap-x-3 md:gap-y-1">
          {siteLinks.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex min-h-11 items-center rounded-lg px-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0 md:px-0">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-caption text-muted-foreground">
          anwar.os · made in Prague ·{" "}
          <Link href="/login" className="rounded underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            Sign in
          </Link>
        </p>
      </div>
    </footer>
  )
}

async function Contacts() {
  await connection()
  const cv = await getPublicCv()
  const contacts = cv?.profile?.contacts ?? []
  if (contacts.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        The quickest way to reach me is the{" "}
        <Link href="/feedback" className="text-text-accent underline-offset-4 hover:underline">
          feedback form
        </Link>
        .
      </p>
    )
  }
  return (
    <ul className="text-meta grid gap-x-4 sm:flex sm:flex-wrap sm:gap-y-1">
      {contacts.map((c) => {
        const href = c.url ? safeHref(c.url) : null
        return (
          <li key={`${c.label}-${c.value}`} className="flex min-h-11 items-center gap-1.5 sm:min-h-0">
            {c.label && <span className="text-muted-foreground">{c.label}</span>}
            {href ? (
              <a
                href={href}
                className="flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:text-text-accent hover:underline sm:min-h-0"
                {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                {c.value}
              </a>
            ) : (
              <span className="font-semibold">{c.value}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
