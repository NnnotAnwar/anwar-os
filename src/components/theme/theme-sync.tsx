"use client"

import { useEffect } from "react"
import { encodeThemeCookie, type ThemeConfig } from "@/lib/theme"
import { useTheme } from "./theme-provider"

/**
 * In the app shell: the saved appearance (database) wins over this browser's
 * cookie, so a new device, or one that missed a change made on another, catches
 * up (and gets the cookie for a flash-free next load). Runs when the saved value
 * changes, never because of a local change.
 */
export function ThemeSync({ saved }: { saved: ThemeConfig }) {
  const { config, apply } = useTheme()
  const savedKey = encodeThemeCookie(saved)
  useEffect(() => {
    if (encodeThemeCookie(config) !== savedKey) apply(saved, { background: true })
    // Only the saved value should trigger this; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])
  return null
}
