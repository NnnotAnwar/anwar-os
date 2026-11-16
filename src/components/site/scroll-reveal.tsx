"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Rises its content in the first time it scrolls into view (CSS in site.css).
 * Anything already on screen when the page opens is left alone, the hidden
 * state is set by JS before paint, and reduced motion skips it entirely, so
 * content is never stuck invisible.
 */
export function ScrollReveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return
    el.dataset.reveal = "pending"
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        el.dataset.reveal = "shown"
        observer.disconnect()
      },
      { rootMargin: "0px 0px -10% 0px" },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      delete el.dataset.reveal
    }
  }, [])

  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      {children}
    </div>
  )
}
