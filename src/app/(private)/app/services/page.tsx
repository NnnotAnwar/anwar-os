import { Suspense } from "react"
import { Page } from "@/components/motion"
import Link from "next/link"
import type { ReactNode } from "react"
import { ChevronRightIcon, House, Settings } from "@/components/icons"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { ServiceGrid } from "@/components/services/service-grid"

export const metadata = { title: "Services" }

// The "More" tab: every service as a card (Kaspi-style). Tap one for its options;
// star it to keep it in My services on Today and in the sidebar.
export default function ServicesPage() {
  return (
    <Page>
      <div className="grid gap-6">
        <PageHeader eyebrow="Everything" title="Services" description="Tap a card for its options. Star the ones you use most." />

        <section aria-labelledby="mine-heading" className="grid gap-3">
          <h2 id="mine-heading" className="text-eyebrow text-text-accent">
            My services
          </h2>
          <Suspense fallback={<GridSkeleton count={4} />}>
            <ServiceGrid which="pinned" />
          </Suspense>
        </section>

        <section aria-labelledby="all-heading" className="grid gap-3">
          <h2 id="all-heading" className="text-eyebrow text-muted-foreground">
            All services
          </h2>
          <Suspense fallback={<GridSkeleton count={6} />}>
            <ServiceGrid which="rest" />
          </Suspense>
        </section>

        <ul className="glass grid divide-y divide-hairline overflow-hidden rounded-xl">
          <SystemRow href="/app/settings" icon={<Settings />} title="Settings" hint="Sign-in methods, two-factor, appearance" />
          <SystemRow href="/" icon={<House />} title="Public site" hint="What visitors see at anwar-os.com" />
        </ul>
      </div>
    </Page>
  )
}

function GridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  )
}

function SystemRow({ href, icon, title, hint }: { href: string; icon: ReactNode; title: string; hint: string }) {
  return (
    <li>
      <Link
        href={href}
        className="press flex min-h-14 items-center gap-3 p-3.5 outline-none hover:bg-track focus-visible:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-track text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
        <span className="grid flex-1">
          <span className="text-body-strong">{title}</span>
          <span className="text-caption text-muted-foreground">{hint}</span>
        </span>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>
    </li>
  )
}
