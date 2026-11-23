"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Kbd } from "@/components/ui/kbd"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useModKey } from "./search-trigger"

export type GoTarget = { key: string; label: string; href: string }

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

/**
 * App-wide keys: `g` then a letter jumps to a section (Gmail / Linear style),
 * `?` shows every shortcut. Modules add their own keys on their pages.
 */
export function KeyboardShortcuts({ targets }: { targets: GoTarget[] }) {
  const router = useRouter()
  const mod = useModKey()
  const [helpOpen, setHelpOpen] = useState(false)
  const [pendingG, setPendingG] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (e.key === "?") {
        e.preventDefault()
        setHelpOpen(true)
        return
      }
      if (pendingG) {
        const target = targets.find((t) => t.key === e.key.toLowerCase())
        setPendingG(false)
        clearTimeout(timer.current)
        if (target) {
          e.preventDefault()
          router.push(target.href)
        }
        return
      }
      if (e.key === "g") {
        setPendingG(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setPendingG(false), 1200)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pendingG, router, targets])

  useEffect(() => () => clearTimeout(timer.current), [])

  const general: [string[], string][] = [
    [[mod, "K"], "Search and commands"],
    [["/"], "Search"],
    [["?"], "This list"],
  ]

  return (
    <>
      {pendingG && (
        <div
          role="status"
          className="glass glass-menu text-meta fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full px-3 py-1.5 md:bottom-6"
        >
          Go to… <span className="text-muted-foreground">{targets.map((t) => t.key.toUpperCase()).join(" · ")}</span>
        </div>
      )}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="glass glass-menu sm:max-w-md">
          <DialogTitle className="text-card-title">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-meta text-muted-foreground">
            Press <Kbd>G</Kbd> then a letter to jump anywhere.
          </DialogDescription>
          <dl className="grid gap-1.5">
            {general.map(([keys, label]) => (
              <Row key={label} keys={keys} label={label} />
            ))}
            <div className="my-1 border-t border-hairline" />
            {targets.map((t) => (
              <Row key={t.href} keys={["G", t.key.toUpperCase()]} label={t.label} />
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-meta">{label}</dt>
      <dd className="flex gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </dd>
    </div>
  )
}
