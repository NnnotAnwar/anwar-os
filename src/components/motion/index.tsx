import { ViewTransition, type ReactNode } from "react"

/**
 * Motion vocabulary for anwar.os (React 19.3 <ViewTransition> + the browser's
 * View Transitions API; browsers without it simply don't animate).
 *
 *   Moving deeper (list → detail)   <Link transitionTypes={NAV_FORWARD}>  slides left
 *   Going back (detail → list)      <Link transitionTypes={NAV_BACK}>     slides right
 *   Switching sections (tabs, nav)  <Link transitionTypes={NAV_TAB}>      soft crossfade
 *
 * Wrap each page's content in <Page> (in page.tsx, not a layout: layouts persist
 * and never enter or exit). Wrap streamed content in <Reveal> and its skeleton
 * in <SkeletonExit> so the placeholder hands over instead of popping.
 * CSS lives in globals.css ("Motion"). Reduced motion turns it all off.
 */
export const NAV_FORWARD = ["nav-forward"]
export const NAV_BACK = ["nav-back"]
export const NAV_TAB = ["nav-tab"]

const byType = { "nav-forward": "nav-forward", "nav-back": "nav-back", "nav-tab": "nav-tab", default: "none" }

export function Page({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter={byType} exit={byType} default="none">
      {children}
    </ViewTransition>
  )
}

/** Streamed content arriving: rises in after its skeleton leaves. */
export function Reveal({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="reveal" default="none">
      {children}
    </ViewTransition>
  )
}

/** The skeleton leaving when its content is ready. */
export function SkeletonExit({ children }: { children: ReactNode }) {
  return (
    <ViewTransition exit="skeleton-out" default="none">
      {children}
    </ViewTransition>
  )
}

/**
 * Same thing on two screens (a card and its detail hero): the browser morphs one
 * into the other. Use the same `name` on both sides, e.g. `project-${id}`.
 */
export function Morph({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  )
}
