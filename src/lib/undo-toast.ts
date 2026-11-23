"use client"

import { toast } from "sonner"

/**
 * One-tap removal with Undo (Planuj Glass): the item disappears at once, a
 * toast offers Undo, and the real write runs once the Undo window is over.
 *
 * The write must not depend on the toast closing by itself: Sonner pauses its
 * timer while the toast is touched or hovered (on a phone a tap can leave it
 * paused) and while the page is hidden, so on the iPhone PWA the write often
 * never ran and the item came back on the next load. So the window has its own
 * timer, and leaving the page (app switched away, tab closed, reload) commits
 * at once. A write that fails or throws (e.g. a stale action right after a
 * deploy) puts the item back and says so.
 */
export function removeWithUndo({
  message,
  hide,
  restore,
  commit,
  duration = 5000,
}: {
  message: string
  hide: () => void
  restore: () => void
  commit: () => Promise<{ ok: boolean; error?: string } | void>
  duration?: number
}) {
  let settled = false

  const onPageHide = () => void finish()
  const onVisibility = () => {
    if (document.visibilityState === "hidden") void finish()
  }
  const timer = setTimeout(() => {
    toast.dismiss(id)
    void finish()
  }, duration)
  window.addEventListener("pagehide", onPageHide)
  document.addEventListener("visibilitychange", onVisibility)

  function settle() {
    if (settled) return false
    settled = true
    clearTimeout(timer)
    window.removeEventListener("pagehide", onPageHide)
    document.removeEventListener("visibilitychange", onVisibility)
    return true
  }

  async function finish() {
    if (!settle()) return
    let result: { ok: boolean; error?: string } | void
    try {
      result = await commit()
    } catch {
      result = { ok: false, error: "That didn't go through. Reload the page and try again." }
    }
    if (result && !result.ok) {
      restore()
      toast.error(result.error ?? "That didn't work. Try again.")
    }
  }

  hide()
  const id = toast.success(message, {
    duration,
    action: {
      label: "Undo",
      onClick: () => {
        if (settle()) restore()
      },
    },
    onAutoClose: () => void finish(),
    onDismiss: () => void finish(),
  })
}
