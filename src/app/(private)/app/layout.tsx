import { Suspense } from "react"
import { Plus, Settings, SunHorizon } from "@/components/icons"
import { Skeleton } from "@/components/ui/skeleton"
import { CommandPalette } from "@/components/shell/command-palette"
import { CreateMenu } from "@/components/shell/create-menu"
import { MoreMenu } from "@/components/shell/more-menu"
import { NavLink, TabLink } from "@/components/shell/nav-link"
import { SearchIconTrigger, SearchTrigger } from "@/components/shell/search-trigger"
import { UserMenu } from "@/components/shell/user-menu"
import { Wordmark } from "@/components/shell/wordmark"
import { requireViewer, type Viewer } from "@/core/auth"
import { modulesFor } from "@/core/module"
import { modules } from "@/modules/_registry"

export const metadata = { title: { absolute: "Today · anwar.os", template: "%s · anwar.os" } }

// The frame is static and prerenders instantly. Everything that depends on the
// viewer (their modules, identity) streams in behind small Suspense boundaries.
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="min-h-svh md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="glass sticky top-3 m-3 mr-0 hidden h-[calc(100svh-1.5rem)] flex-col rounded-xl px-3 py-4 md:flex">
        <div className="px-2.5 pb-6">
          <Wordmark />
        </div>
        <nav aria-label="Main" className="grid gap-0.5">
          <NavLink href="/app" exact icon={<SunHorizon />}>
            Today
          </NavLink>
          <Suspense fallback={<NavSkeleton />}>
            <ModuleNav />
          </Suspense>
        </nav>
        <div className="mt-auto grid gap-0.5 border-t border-hairline pt-3">
          <NavLink href="/app/settings" icon={<Settings />}>
            Settings
          </NavLink>
          <Suspense fallback={<Skeleton className="mt-1 h-10 w-full" />}>
            <ViewerMenu variant="full" />
          </Suspense>
        </div>
      </aside>

      <div className="flex min-h-svh min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-background/70 px-3 backdrop-blur-xl md:static md:bg-transparent md:px-6 md:pt-3 md:backdrop-blur-none">
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
        <main className="mx-auto w-full max-w-6xl flex-1 px-3 pt-4 pb-28 md:px-6 md:pt-6 md:pb-12">{children}</main>
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
  const items = mods.flatMap((m) => (m.create ? [{ ...m.create, icon: <m.icon /> }] : []))
  return <CreateMenu items={items} />
}

async function MobileTabs() {
  const { mods } = await visibleModules()
  const entries = mods.flatMap((m) => m.nav.slice(0, 1).map((item) => ({ ...item, Icon: m.icon })))
  const tabs = entries.slice(0, 3)
  const more = [
    ...entries.slice(3).map(({ href, label, Icon }) => ({ href, label, icon: <Icon /> })),
    { href: "/app/settings", label: "Settings", icon: <Settings /> },
  ]
  return (
    <nav
      aria-label="Main"
      className="glass glass-menu fixed inset-x-0 bottom-0 z-30 flex rounded-none pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <TabLink href="/app" exact icon={<SunHorizon />}>
        Today
      </TabLink>
      {tabs.map(({ href, label, Icon }) => (
        <TabLink key={href} href={href} icon={<Icon />}>
          {label}
        </TabLink>
      ))}
      <MoreMenu items={more} />
    </nav>
  )
}

async function Palette() {
  const { mods } = await visibleModules()
  const nav = [
    { label: "Today", href: "/app", icon: <SunHorizon /> },
    ...mods.flatMap((m) => m.nav.map((item) => ({ ...item, icon: <m.icon /> }))),
    { label: "Settings", href: "/app/settings", icon: <Settings /> },
  ]
  const creates = mods.flatMap((m) => (m.create ? [{ ...m.create, icon: <Plus /> }] : []))
  return <CommandPalette nav={nav} creates={creates} />
}
