"use client"

import { useState } from "react"
import { Globe } from "@/components/icons"
import { cn } from "@/lib/utils"

/** The site's icon, or a globe when there is none or it fails to load. */
export function Favicon({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return <Globe className={cn("size-4 shrink-0 text-muted-foreground", className)} />
  }
  return (
    // Third-party icons of arbitrary size and origin: next/image would need every
    // host allow-listed. No referrer, so sites don't learn where they were saved.
    // eslint-disable-next-line @next/next/no-img-element
    <img
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
