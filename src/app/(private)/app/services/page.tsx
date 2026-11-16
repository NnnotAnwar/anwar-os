import { Suspense } from "react"
import Link from "next/link"
import { ChevronRightIcon, Settings } from "@/components/icons"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { ServiceGrid } from "@/components/services/service-grid"

export const metadata = { title: "Services" }

// The "More" tab: every service as a card (Kaspi-style). Tap one for its options;
// star it to keep it in My services on Today and in the sidebar.
export default function ServicesPage() {
  return (
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

      <Link
        href="/app/settings"
        className="glass flex items-center gap-3 rounded-xl p-3.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-track text-muted-foreground [&_svg]:size-5">
          <Settings />
        </span>
        <span className="grid flex-1">
          <span className="text-body-strong">Settings</span>
          <span className="text-caption text-muted-foreground">Two-factor sign-in, appearance</span>
        </span>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>
    </div>
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
