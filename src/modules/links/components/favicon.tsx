"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * The site's icon, or a tinted letter tile when there is none or it fails to
 * load (the way Safari shows sites without a touch icon).
 */
export function Favicon({ src, name, className }: { src: string; name?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const img = useRef<HTMLImageElement>(null)

  // An icon that failed before hydration never fires onError for React.
  useEffect(() => {
    const el = img.current
    if (el && el.complete && el.naturalWidth === 0) setFailed(true)
  }, [src])

  if (!src || failed) {
    const letter = (name ?? "").replace(/^www\./, "").trim().charAt(0).toUpperCase() || "·"
    return (
      <span
        aria-hidden
        className={cn(
          "text-micro flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-secondary font-semibold text-text-accent",
          className,
        )}
      >
        {letter}
      </span>
    )
  }
  return (
    // Third-party icons of arbitrary size and origin: next/image would need every
    // host allow-listed. No referrer, so sites don't learn where they were saved.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={img}
      src={src}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("size-4 shrink-0 rounded-sm object-contain", className)}
    />
  )
}
