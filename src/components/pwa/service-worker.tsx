"use client"

import { useEffect } from "react"

/** How often a resumed app checks for a new worker (a deploy). */
const UPDATE_CHECK_MS = 60 * 60_000

/**
 * Registers public/sw.js (saved app pages for offline mode, the offline page,
 * the asset cache, Background Sync). Production only: in development it would
 * cache Turbopack's chunks across reloads. updateViaCache "none" makes the
 * browser re-check sw.js on every visit; an installed iPhone app is resumed
 * rather than reloaded for days, so it also checks when it comes back to the
 * foreground (at most hourly).
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    let lastCheck = Date.now()
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // No worker means no offline mode; the app itself works the same.
    })
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || Date.now() - lastCheck < UPDATE_CHECK_MS) return
      lastCheck = Date.now()
      void navigator.serviceWorker.getRegistration().then((r) => r?.update().catch(() => undefined))
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])
  return null
}
