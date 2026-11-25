"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowRight, House, MenuIcon } from "@/components/icons"
import { NAV_TAB } from "@/components/motion"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isActive, siteLinks } from "./site-links"

function NavItems({ pathname }: { pathname: string | null }) {
  return siteLinks.map(({ href, label }) => {
    const active = isActive(pathname, href)
    return (
      <li key={href}>
        <Link
          href={href}
          transitionTypes={NAV_TAB}
          aria-current={active ? "page" : undefined}
          className={cn(
            "text-meta flex h-8 items-center rounded-lg px-2 text-muted-foreground outline-none transition-colors hover:bg-muted lg:px-2.5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
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
 * The site's main navigation from 768px. Links prerender as inactive and the
 * active one streams in, so the header stays part of the static shell.
 */
export function SiteNav({ className }: { className?: string }) {
  return (
    <nav aria-label="Main" className={className}>
      <ul className="flex items-center gap-0.5">
        <Suspense fallback={<NavItems pathname={null} />}>
          <ActiveItems />
        </Suspense>
      </ul>
    </nav>
  )
}

/**
 * Phones: one Menu button opens a bottom sheet with every section as a large
 * row (icon, name, one-line promise). Thumb-reachable, 56px targets, the
 * current page marked, swipe the grip down or tap outside to close.
 */
export function SiteMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="size-11"
      >
        <MenuIcon className="size-5" />
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Where to?"
        description="Everything on anwar.os, one tap away."
        className="sm:max-w-sm"
      >
        <Suspense fallback={<MenuItems pathname={null} onNavigate={() => setOpen(false)} />}>
          <ActiveMenuItems onNavigate={() => setOpen(false)} />
        </Suspense>
      </Sheet>
    </div>
  )
}

function ActiveMenuItems({ onNavigate }: { onNavigate: () => void }) {
  return <MenuItems pathname={usePathname()} onNavigate={onNavigate} />
}

function MenuItems({ pathname, onNavigate }: { pathname: string | null; onNavigate: () => void }) {
  const items = [{ href: "/", label: "Home", hint: "Who I am, in one screen", icon: House }, ...siteLinks]
  return (
    <nav aria-label="Main" className="mt-3 border-t border-hairline px-2 py-2">
      <ul className="grid gap-0.5">
        {items.map(({ href, label, hint, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : isActive(pathname, href)
          return (
            <li key={href}>
              <Link
                href={href}
                transitionTypes={NAV_TAB}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press group flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 outline-none hover:bg-track focus-visible:bg-track focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "bg-secondary",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg bg-track text-muted-foreground [&_svg]:size-5",
                    active && "bg-primary text-primary-foreground",
                  )}
                >
                  <Icon />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className={cn("text-body-strong", active && "text-text-accent")}>{label}</span>
                  <span className="text-meta truncate text-muted-foreground">{hint}</span>
                </span>
                {active ? (
                  <span className="text-micro text-text-accent">Here</span>
                ) : (
                  <ArrowRight className="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
