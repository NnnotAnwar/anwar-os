"use client"

import { startTransition, useEffect, useState, useSyncExternalStore } from "react"
import { Reveal } from "@/components/motion"
import { DeviceMobile, PlusSquare, ShareIos, X } from "@/components/icons"
import { Button } from "@/components/ui/button"

/**
 * "Install anwar.os" card on Today, for phones only, until it's installed or
 * dismissed. Dismissal is remembered per device (localStorage), since installing
 * is a per-device thing. Android/Chrome gets a real Install button
 * (beforeinstallprompt); iOS Safari can only be told where the menu item is.
 */
const DISMISSED_KEY = "anwar-os:install-hint-dismissed"

type Platform = "ios" | "android" | "other"
type View = Platform | "hidden"

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const standaloneQuery = "(display-mode: standalone)"
const phoneQuery = "(max-width: 767px) and (pointer: coarse)"

function subscribe(onChange: () => void) {
  const queries = [matchMedia(standaloneQuery), matchMedia(phoneQuery)]
  queries.forEach((q) => q.addEventListener("change", onChange))
  window.addEventListener("storage", onChange)
  return () => {
    queries.forEach((q) => q.removeEventListener("change", onChange))
    window.removeEventListener("storage", onChange)
  }
}

function readView(): View {
  try {
    if (localStorage.getItem(DISMISSED_KEY)) return "hidden"
  } catch {
    // Storage blocked (private mode): just show the hint.
  }
  const nav = navigator as Navigator & { standalone?: boolean }
  if (matchMedia(standaloneQuery).matches || nav.standalone) return "hidden"
  if (!matchMedia(phoneQuery).matches) return "hidden"
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios"
  if (/Android/i.test(ua)) return "android"
  return "other"
}

export function InstallHint() {
  const view = useSyncExternalStore(subscribe, readView, () => "hidden" as const)
  const [dismissed, setDismissed] = useState(false)
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => setDismissed(true)
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  if (view === "hidden" || dismissed) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, new Date().toISOString())
    } catch {
      // Not remembered, but hidden for now.
    }
    startTransition(() => setDismissed(true))
  }

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    setPrompt(null)
    if (outcome === "accepted") dismiss()
  }

  return (
    <Reveal>
      <section aria-labelledby="install-hint" className="glass flex items-start gap-3 rounded-xl p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-text-accent [&_svg]:size-5">
          <DeviceMobile />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 id="install-hint" className="text-card-title">
            Install anwar.os
          </h2>
          {view === "ios" ? (
            <p className="text-meta text-muted-foreground">
              Tap <ShareIos className="inline size-4 align-[-3px] text-text-accent" aria-label="Share" /> in Safari,
              then <span className="text-body-strong text-foreground">Add to Home Screen</span>{" "}
              <PlusSquare className="inline size-4 align-[-3px] text-text-accent" aria-hidden />. It opens full
              screen, and things you share land in Capture.
            </p>
          ) : prompt ? (
            <p className="text-meta text-muted-foreground">
              Open it from your home screen, full screen, and share links straight into it.
            </p>
          ) : (
            <p className="text-meta text-muted-foreground">
              In your browser&apos;s menu, choose <span className="text-body-strong text-foreground">Install app</span>{" "}
              or <span className="text-body-strong text-foreground">Add to Home screen</span>.
            </p>
          )}
          {prompt && (
            <div className="pt-2">
              <Button onClick={install}>Install</Button>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Hide the install hint"
          onClick={dismiss}
          className="-mt-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4"
        >
          <X />
        </button>
      </section>
    </Reveal>
  )
}
