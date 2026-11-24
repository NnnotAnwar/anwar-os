"use client"

import { startTransition, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CloudSlash, Refresh } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { capturedLabel } from "./outbox-status"
import { useOnline } from "./use-outbox"

type Served = { fromCache: boolean; savedAt: string | null }

/** Asks the service worker (public/sw.js) whether this page came from its saved copies. */
function askWorker(): Promise<Served | null> {
  const worker = navigator.serviceWorker?.controller
  if (!worker) return Promise.resolve(null)
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 1000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data as Served)
    }
    worker.postMessage({ type: "page-info", path: location.pathname.replace(/\/+$/, "") || "/" }, [channel.port2])
  })
}

/** When the worker can't say: a page that loaded while offline came from the saved copy. */
async function fromCacheHeader(): Promise<Served | null> {
  if (navigator.onLine || typeof caches === "undefined") return null
  const saved = await caches.match(location.pathname.replace(/\/+$/, "") || "/").catch(() => undefined)
  return saved ? { fromCache: true, savedAt: saved.headers.get("x-anwar-saved-at") } : null
}

/**
 * "Offline · showing saved copy from 14:02" above a page the service worker
 * served from its saved copy (refreshed in place, and the banner gone, when
 * the connection returns; "Back online" with Refresh if that didn't happen);
 * a plain offline note on a live page when the connection drops.
 */
export function OfflineBanner() {
  const router = useRouter()
  const online = useOnline()
  const [served, setServed] = useState<Served | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const answer = (await askWorker()) ?? (await fromCacheHeader())
      if (!cancelled && answer?.fromCache) setServed(answer)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The banner lives in the shell; a client-side navigation brings a live page.
  // (usePathname would make the static shell dynamic, so watch the address.)
  useEffect(() => {
    if (!served) return
    const path = location.pathname
    const timer = setInterval(() => {
      if (location.pathname !== path) setServed(null)
    }, 1000)
    // Back online: fetch this page's live data in place (what's typed in a field stays).
    const onOnline = () => startTransition(() => {
      router.refresh()
      setServed(null)
    })
    window.addEventListener("online", onOnline)
    return () => {
      clearInterval(timer)
      window.removeEventListener("online", onOnline)
    }
  }, [served, router])

  const saved = served?.fromCache ? (served.savedAt ? capturedLabel(served.savedAt) : null) : undefined
  if (saved === undefined && online) return null

  let text: string
  if (saved !== undefined) {
    const copy = saved ? `saved copy from ${saved}` : "saved copy"
    text = online ? `Back online · this is a ${copy}` : `Offline · showing ${copy}`
  } else {
    text = "Offline · what you capture stays on this device until you're back"
  }

  return (
    <div
      role="status"
      className="glass mb-4 flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 md:mb-6 [&_svg]:size-4 [&_svg]:shrink-0"
      data-offline-banner={saved !== undefined ? "saved-copy" : "offline"}
    >
      <CloudSlash className="text-muted-foreground" />
      <p className="text-meta min-w-0 flex-1">{text}</p>
      {saved !== undefined && online && (
        <Button size="lg" variant="ghost" onClick={() => location.reload()} className="text-text-accent">
          <Refresh />
          Refresh
        </Button>
      )}
    </div>
  )
}
