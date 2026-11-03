"use client"

import { Suspense, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
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

/** Sidebar entry. The active one gets a sky rule on its left edge. */
export const NavLink = withActiveState(function NavLinkView({ href, icon, active, children }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
        active &&
          "bg-sidebar-accent font-medium text-foreground before:absolute before:inset-y-1.5 before:-left-3 before:w-0.5 before:rounded-full before:bg-sky",
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground outline-none focus-visible:text-foreground [&_svg]:size-5",
        active && "text-sky",
      )}
    >
      {icon}
      {children}
    </Link>
  )
})
