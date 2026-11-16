"use client"

import { useEffect, useRef } from "react"

/** Same rule as the shell's shortcuts: no page keys while the focus is in a field. */
export function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

/**
 * The shell owns `g` + letter (go to). A page key pressed right after `g`
 * belongs to that chord, so callers skip it when this returns true.
 */
export function useAfterG() {
  const lastG = useRef(0)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) lastG.current = e.timeStamp
    }
    // Capture phase: record `g` before any page handler reads it.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])
  return (e: KeyboardEvent) => e.key === "g" || (lastG.current > 0 && e.timeStamp - lastG.current < 1200 && e.timeStamp !== lastG.current)
}
