"use client"

import { Suspense, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

/**
 * Counts a view of each public page, without cookies or storage: one small
 * POST to /api/a with the path and, for the page someone arrived on, where
 * they came from. Visitors with Do Not Track or Global Privacy Control on are
 * never counted (checked here and again on the server).
 */
export function PageViewBeacon() {
  return (
    <Suspense fallback={null}>
      <Beacon />
    </Suspense>
  )
}

function Beacon() {
  const pathname = usePathname()
  const last = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || last.current === pathname) return
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl === true) return
    // Client-side navigation keeps the first page's referrer; only the landing page has a real one.
    const referrer = last.current === null ? document.referrer : ""
    last.current = pathname
    const body = JSON.stringify({ p: pathname, r: referrer })
    try {
      if (navigator.sendBeacon?.("/api/a", body)) return
    } catch {
      // Fall through to fetch.
    }
    void fetch("/api/a", { method: "POST", body, keepalive: true, credentials: "same-origin" }).catch(() => {})
  }, [pathname])

  return null
}
