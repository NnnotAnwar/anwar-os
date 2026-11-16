"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { siteLinks } from "./site-links"

function NavItems({ pathname }: { pathname: string | null }) {
  return siteLinks.map(({ href, label }) => {
    const active = pathname !== null && (pathname === href || pathname.startsWith(`${href}/`))
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "text-meta flex h-8 items-center rounded-lg px-2 text-muted-foreground sm:px-2.5 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            active && "segment-active text-foreground",
          )}
        >
          {label}
        </Link>
      </li>
    )
  })
}

function ActiveItems() {
  return <NavItems pathname={usePathname()} />
}

/**
 * The site's main navigation. Links prerender as inactive and the active one
 * streams in, so the header stays part of the static shell on every route.
 */
export function SiteNav({ className }: { className?: string }) {
  return (
    <nav aria-label="Main" className={className}>
      <ul className="flex flex-wrap items-center gap-0.5">
        <Suspense fallback={<NavItems pathname={null} />}>
          <ActiveItems />
        </Suspense>
      </ul>
    </nav>
  )
}
