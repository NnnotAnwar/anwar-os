"use client"

import { Suspense, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { NAV_TAB } from "@/components/motion"
import { cn } from "@/lib/utils"

type LinkProps = {
  href: string
  icon: ReactNode
  exact?: boolean
  children: ReactNode
}

function isActive(pathname: string, href: string, exact: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
}

// usePathname() is request data on dynamic routes (e.g. /app/notes/[id]). Each link
// prerenders as inactive and the active state streams in, so the shell stays static.
function withActiveState(View: (props: LinkProps & { active: boolean }) => ReactNode) {
  function Active(props: LinkProps) {
    const pathname = usePathname()
    return <View {...props} active={isActive(pathname, props.href, props.exact ?? false)} />
  }
  return function ActiveLink(props: LinkProps) {
    return (
      <Suspense fallback={<View {...props} active={false} />}>
        <Active {...props} />
      </Suspense>
    )
  }
}

/** Sidebar entry. The active one is tinted with the accent. */
export const NavLink = withActiveState(function NavLinkView({ href, icon, active, children }) {
  return (
    <Link
      href={href}
      transitionTypes={NAV_TAB}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-meta flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-muted-foreground transition-colors duration-150 outline-none hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
        active && "bg-sidebar-accent font-semibold text-text-accent hover:bg-sidebar-accent hover:text-text-accent",
      )}
    >
      {icon}
      {children}
    </Link>
  )
})

/** Bottom tab on phones: icon over a short label. */
export const TabLink = withActiveState(function TabLinkView({ href, icon, active, children }) {
  return (
    <Link
      href={href}
      transitionTypes={NAV_TAB}
      aria-current={active ? "page" : undefined}
      className={cn(
        // The icon dips under the finger (like a pressed card) and the colour eases over.
        "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground transition-colors duration-150 outline-none focus-visible:text-foreground [&_svg]:size-5 [&_svg]:transition-transform [&_svg]:duration-150 [&_svg]:ease-(--ease-out) active:[&_svg]:scale-90",
        active && "font-semibold text-text-accent",
      )}
    >
      {icon}
      {children}
    </Link>
  )
})
