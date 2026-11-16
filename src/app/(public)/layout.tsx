import type { ReactNode } from "react"
import { Wordmark } from "@/components/shell/wordmark"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteNav } from "@/components/site/site-nav"

export const metadata = {
  title: { default: "Anwar — economics student and web developer in Prague", template: "%s · Anwar" },
  description:
    "Anwar studies Economics and Management at UCT Prague and builds web products. CV, projects, ideas and small tools.",
}

// The public frame. Static: the header prerenders on every route; only the
// footer's contacts stream in (they come from the published CV).
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="text-meta sr-only z-50 rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="glass top-3 z-30 mx-3 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-2 py-2 sm:px-3 md:sticky md:mx-6 md:px-4 print:hidden">
        <div className="flex h-8 items-center px-1">
          <Wordmark href="/" />
        </div>
        <SiteNav className="-mx-1 md:ml-auto" />
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-3 pt-6 pb-12 md:px-6 md:pt-10 print:p-0">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
