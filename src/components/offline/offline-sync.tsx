"use client"

import { startTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import { onItemSynced, reload, requestSync, setOutboxUser } from "@/lib/offline/client"
import { SignOutGuard } from "./sign-out"

/** How often to try again while something waits and the app is open. */
const POLL_MS = 30_000
/** Let the first page settle before saving the other offline pages in the background. */
const WARM_DELAY_MS = 4000

/**
 * Mounted once in the app shell with the signed-in user's id. Runs the outbox
 * syncer (src/lib/offline/client.ts): on open, when the connection comes back,
 * when the app returns to the foreground (iOS has no Background Sync, and it
 * freezes standalone apps in the background, so these are what matter there),
 * on a slow timer, and when the service worker reports a background replay.
 * Re-renders the page once items land, so they show up in their lists.
 */
export function OfflineSync({ userId }: { userId: string }) {
  const router = useRouter()

  useEffect(() => {
    setOutboxUser(userId)
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refreshSoon = () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => startTransition(() => router.refresh()), 250)
    }
    const sync = () => void requestSync()
    const catchUp = () => void reload().then(sync)
    const onVisible = () => {
      if (document.visibilityState === "visible") catchUp()
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "outbox:changed") {
        void reload()
        refreshSoon()
      }
    }

    const offSynced = onItemSynced(refreshSoon)
    catchUp()
    window.addEventListener("online", sync)
    window.addEventListener("pageshow", onVisible)
    document.addEventListener("visibilitychange", onVisible)
    navigator.serviceWorker?.addEventListener("message", onMessage)
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) sync()
    }, POLL_MS)
    const warm = setTimeout(warmOfflinePages, WARM_DELAY_MS)

    return () => {
      offSynced()
      clearTimeout(refreshTimer)
      clearInterval(poll)
      clearTimeout(warm)
      window.removeEventListener("online", sync)
      window.removeEventListener("pageshow", onVisible)
      document.removeEventListener("visibilitychange", onVisible)
      navigator.serviceWorker?.removeEventListener("message", onMessage)
    }
  }, [router, userId])

  return <SignOutGuard />
}

/** Asks the service worker to save the offline pages this device hasn't opened yet (once each). */
function warmOfflinePages() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (!navigator.onLine || connection?.saveData) return
  navigator.serviceWorker?.controller?.postMessage({ type: "warm-pages" })
}
