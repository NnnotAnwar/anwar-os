"use client"

import { useEffect } from "react"

/**
 * Registers public/sw.js (offline fallback + immutable asset cache). Production
 * only: in development it would cache Turbopack's chunks across reloads.
 * updateViaCache "none" makes the browser re-check sw.js on every visit.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // No worker means no offline page; the app itself works the same.
    })
  }, [])
  return null
}
