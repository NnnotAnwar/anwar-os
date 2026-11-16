"use client"

import { toast } from "sonner"

/**
 * One-tap removal with Undo (Planuj Glass): the item disappears at once, a
 * toast offers Undo, and the real write runs only when the toast goes away.
 * Closing the tab before then keeps the item, which is the safe direction.
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
  hide()
  const finish = async () => {
    if (settled) return
    settled = true
    const result = await commit()
    if (result && !result.ok) {
      restore()
      toast.error(result.error ?? "That didn't work. Try again.")
    }
  }
  toast.success(message, {
    duration,
    action: {
      label: "Undo",
      onClick: () => {
        if (settled) return
        settled = true
        restore()
      },
    },
    onAutoClose: () => void finish(),
    onDismiss: () => void finish(),
  })
}
