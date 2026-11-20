import type { ReactNode } from "react"
import { Wordmark } from "@/components/shell/wordmark"
import { AccountLink } from "@/components/site/account-link"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteMenu, SiteNav } from "@/components/site/site-nav"
import type { Metadata } from "next"
import { siteDescription, siteName, siteTitle, siteUrl } from "@/lib/site"
import "@/components/site/site.css"

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: { default: siteTitle, template: "%s · Anwar" },
  description: siteDescription,
  openGraph: { type: "website", siteName, locale: "en_US" },
  twitter: { card: "summary_large_image" },
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
      <header className="site-header glass sticky top-2 z-30 mx-2 mt-2 flex items-center gap-1 rounded-xl py-1.5 pr-1.5 pl-3 md:top-3 md:mx-6 md:mt-3 md:gap-4 md:px-4 md:py-2 print:hidden">
        <Wordmark href="/" className="flex h-11 items-center md:h-8" />
        <SiteNav className="ml-auto max-md:hidden" />
        <AccountLink className="ml-auto md:ml-0" />
        <SiteMenu className="md:hidden" />
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-3 pt-6 pb-12 md:px-6 md:pt-10 print:p-0">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
