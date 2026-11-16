"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowRight, House, MenuIcon } from "@/components/icons"
import { NAV_TAB } from "@/components/motion"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
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
            "text-meta flex h-8 items-center rounded-lg px-2.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            "glass glass-menu sheet gap-0 p-0 sm:max-w-sm",
            "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[max(env(safe-area-inset-bottom),0.5rem)]",
          )}
        >
          <Grip onDismiss={() => setOpen(false)} />
          <div className="grid gap-0.5 px-4 pt-1 pb-2 max-sm:pt-0 sm:pt-4">
            <DialogTitle className="text-card-title">Where to?</DialogTitle>
            <DialogDescription className="text-meta text-muted-foreground">
              Everything on anwar.os, one tap away.
            </DialogDescription>
          </div>
          <Suspense fallback={<MenuItems pathname={null} onNavigate={() => setOpen(false)} />}>
            <ActiveMenuItems onNavigate={() => setOpen(false)} />
          </Suspense>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ActiveMenuItems({ onNavigate }: { onNavigate: () => void }) {
  return <MenuItems pathname={usePathname()} onNavigate={onNavigate} />
}

function MenuItems({ pathname, onNavigate }: { pathname: string | null; onNavigate: () => void }) {
  const items = [{ href: "/", label: "Home", hint: "Who I am, in one screen", icon: House }, ...siteLinks]
  return (
    <nav aria-label="Main" className="border-t border-hairline px-2 py-2">
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

/** The grab handle on phones: drag down past 80px (or flick) to close. */
function Grip({ onDismiss }: { onDismiss: () => void }) {
  const [start, setStart] = useState<{ y: number; t: number } | null>(null)
  const sheetOf = (el: HTMLElement) => el.closest<HTMLElement>("[data-slot=dialog-content]")
  return (
    <div
      aria-hidden
      className="flex touch-none justify-center pt-2 pb-2 sm:hidden"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setStart({ y: e.clientY, t: e.timeStamp })
      }}
      onPointerMove={(e) => {
        if (!start) return
        const sheet = sheetOf(e.currentTarget)
        if (sheet) sheet.style.transform = `translateY(${Math.max(0, e.clientY - start.y)}px)`
      }}
      onPointerUp={(e) => {
        if (!start) return
        const dy = e.clientY - start.y
        const sheet = sheetOf(e.currentTarget)
        setStart(null)
        if (dy > 80 || dy / Math.max(1, e.timeStamp - start.t) > 0.6) return onDismiss()
        if (!sheet) return
        sheet.style.transition = "transform 220ms var(--ease-out)"
        sheet.style.transform = ""
        setTimeout(() => (sheet.style.transition = ""), 240)
      }}
    >
      <span className="h-1.5 w-10 rounded-full bg-muted-foreground/35" />
    </div>
  )
}
