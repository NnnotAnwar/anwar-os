import type { ReactNode } from "react"
import { Wordmark } from "@/components/shell/wordmark"
import { AccountLink } from "@/components/site/account-link"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteMenu, SiteNav } from "@/components/site/site-nav"
import type { Metadata } from "next"
import { connection } from "next/server"
import { feedAlternates, getSiteUrl, siteDescription, siteName, siteTitle, siteVerification } from "@/lib/site"
import { PageViewBeacon } from "@/modules/analytics/components/page-view-beacon"
import "@/components/site/site.css"

/**
 * metadataBase is the runtime origin (BETTER_AUTH_URL), so the head resolves
 * per request. As static `metadata` it was baked into the prerendered segments
 * that client-side navigation uses, with the build's http://localhost:3000.
 * Pages give relative canonical/og URLs (pageMetadata) that resolve against it.
 * The Search Console / Bing verification tags are runtime env for the same
 * reason; every public page carries them, which is what the consoles check.
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection()
  return {
    metadataBase: getSiteUrl(),
    title: { default: siteTitle, template: "%s · Anwar" },
    description: siteDescription,
    alternates: { types: feedAlternates },
    openGraph: { type: "website", siteName, locale: "en_US" },
    twitter: { card: "summary_large_image" },
    verification: siteVerification(),
  }
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
      {/* One row at every width. It stays put while pages slide under it (site-header in globals.css). */}
      <header className="site-header glass sticky top-[calc(0.5rem+env(safe-area-inset-top))] z-30 mx-2 mt-[calc(0.5rem+env(safe-area-inset-top))] flex items-center gap-1 rounded-xl py-1.5 pr-1.5 pl-3 md:top-3 md:mx-6 md:mt-3 md:gap-4 md:px-4 md:py-2 print:hidden">
        <Wordmark href="/" className="flex h-11 items-center md:h-8" />
        <SiteNav className="ml-auto max-md:hidden" />
        <AccountLink className="ml-auto md:ml-0" />
        <SiteMenu className="md:hidden" />
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-3 pt-6 pb-12 md:px-6 md:pt-10 print:p-0">
        {children}
      </main>
      <SiteFooter />
      <PageViewBeacon />
    </div>
  )
}
