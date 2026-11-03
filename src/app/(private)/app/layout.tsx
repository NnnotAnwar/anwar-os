import { Suspense } from "react"
import Link from "next/link"
import { CalendarDays, Plus, Settings } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CommandPalette } from "@/components/shell/command-palette"
import { NavLink, TabLink } from "@/components/shell/nav-link"
import { SearchIconTrigger, SearchTrigger } from "@/components/shell/search-trigger"
import { UserMenu } from "@/components/shell/user-menu"
import { Wordmark } from "@/components/shell/wordmark"
import { requireViewer, type Viewer } from "@/core/auth"
import { modulesFor } from "@/core/module"
import { cn } from "@/lib/utils"
import { modules } from "@/modules/_registry"

export const metadata = { title: { absolute: "Today · anwar.os", template: "%s · anwar.os" } }

// The frame is static and prerenders instantly. Everything that depends on the
// viewer (their modules, identity) streams in behind small Suspense boundaries.
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="min-h-svh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-svh flex-col border-r bg-sidebar px-3 py-4 md:flex">
        <div className="px-2.5 pb-6">
          <Wordmark />
        </div>
        <nav aria-label="Main" className="grid gap-0.5">
          <NavLink href="/app" exact icon={<CalendarDays />}>
            Today
          </NavLink>
          <Suspense fallback={<NavSkeleton />}>
            <ModuleNav />
          </Suspense>
        </nav>
        <div className="mt-auto grid gap-0.5 border-t pt-3">
          <NavLink href="/app/settings" icon={<Settings />}>
            Settings
          </NavLink>
          <Suspense fallback={<Skeleton className="mt-1 h-10 w-full" />}>
            <ViewerMenu variant="full" />
          </Suspense>
        </div>
      </aside>

      <div className="flex min-h-svh min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md md:px-8">
          <div className="md:hidden">
            <Wordmark />
          </div>
          <SearchTrigger className="hidden w-full max-w-sm md:flex" />
          <div className="ml-auto flex items-center gap-1.5">
            <div className="md:hidden">
              <SearchIconTrigger />
            </div>
            <Suspense fallback={null}>
              <CreateButton />
            </Suspense>
            <div className="md:hidden">
              <Suspense fallback={<Skeleton className="size-9 rounded-full" />}>
                <ViewerMenu variant="compact" />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-12">{children}</main>
      </div>

      <Suspense fallback={null}>
        <MobileTabs />
      </Suspense>
      <Suspense fallback={null}>
        <Palette />
      </Suspense>
    </div>
  )
}

async function visibleModules() {
  const viewer = await requireViewer()
  return { viewer, mods: modulesFor(modules, viewer.role) }
}

async function ModuleNav() {
  const { mods } = await visibleModules()
  return mods.flatMap((m) =>
    m.nav.map((item) => (
      <NavLink key={item.href} href={item.href} icon={<m.icon />}>
        {item.label}
      </NavLink>
    )),
  )
}

function NavSkeleton() {
  return <Skeleton className="mx-2.5 my-1.5 h-4 w-24" />
}

function displayName(viewer: Viewer) {
  return viewer.displayName ?? viewer.email?.split("@")[0] ?? "You"
}

async function ViewerMenu({ variant }: { variant: "full" | "compact" }) {
  const viewer = await requireViewer()
  return <UserMenu variant={variant} name={displayName(viewer)} email={viewer.email} role={viewer.role} />
}

async function CreateButton() {
  const { mods } = await visibleModules()
  const create = mods.find((m) => m.create)?.create
  if (!create) return null
  return (
    <Link href={create.href} className={cn(buttonVariants({ size: "lg" }), "gap-1.5")}>
      <Plus />
      <span className="hidden sm:inline">{create.label}</span>
      <span className="sr-only sm:hidden">{create.label}</span>
    </Link>
  )
}

async function MobileTabs() {
  const { mods } = await visibleModules()
  const tabs = mods.flatMap((m) => m.nav.slice(0, 1).map((item) => ({ ...item, Icon: m.icon }))).slice(0, 3)
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <TabLink href="/app" exact icon={<CalendarDays />}>
        Today
      </TabLink>
      {tabs.map(({ href, label, Icon }) => (
        <TabLink key={href} href={href} icon={<Icon />}>
          {label}
        </TabLink>
      ))}
      <TabLink href="/app/settings" icon={<Settings />}>
        Settings
      </TabLink>
    </nav>
  )
}

async function Palette() {
  const { mods } = await visibleModules()
  const nav = [
    { label: "Today", href: "/app", icon: <CalendarDays /> },
    ...mods.flatMap((m) => m.nav.map((item) => ({ ...item, icon: <m.icon /> }))),
    { label: "Settings", href: "/app/settings", icon: <Settings /> },
  ]
  const creates = mods.flatMap((m) => (m.create ? [{ ...m.create, icon: <Plus /> }] : []))
  return <CommandPalette nav={nav} creates={creates} />
}
