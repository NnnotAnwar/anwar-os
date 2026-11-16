import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

// The public site's signature, a sibling of the app's year ruler: the year
// ruler measures time, this one measures the way from home. Longitude ticks
// run west → east; the stretch from Kazakhstan to Prague is inked, and the
// accent marks where Anwar is now.

const WEST = 10
const EAST = 80
const STEP = 1
const PRAGUE = 14.4
/** Roughly the middle of Kazakhstan; no single city is implied. */
const KAZAKHSTAN = 67

const at = (lon: number) => `${((lon - WEST) / (EAST - WEST)) * 100}%`

export function Meridian({ className }: { className?: string }) {
  const ticks = Array.from({ length: (EAST - WEST) / STEP + 1 }, (_, i) => WEST + i * STEP)
  const span = Math.round(KAZAKHSTAN - PRAGUE)
  const summary = `From Kazakhstan to Prague: about ${span} degrees of longitude west.`

  return (
    <figure className={cn("grid gap-2", className)} aria-label={summary}>
      <div className="relative h-14" aria-hidden>
        {ticks.map((lon, i) => {
          const major = lon % 10 === 0
          const travelled = lon >= PRAGUE && lon <= KAZAKHSTAN
          return (
            <span
              key={lon}
              style={{ left: at(lon), "--i": i } as CSSProperties}
              className={cn(
                "ruler-tick absolute bottom-0 w-px rounded-full",
                major ? "h-5" : "h-3",
                travelled ? "bg-foreground/60" : "bg-muted-foreground/25",
              )}
            />
          )
        })}
        {/* Origin: an ink dot over Kazakhstan. */}
        <span
          className="absolute bottom-0 h-7 w-px -translate-x-1/2 bg-foreground/70"
          style={{ left: at(KAZAKHSTAN) }}
        >
          <span className="absolute -top-2 left-1/2 size-2 -translate-x-1/2 rounded-full border-2 border-foreground/70 bg-background" />
        </span>
        {/* Now: the accent marker over Prague. */}
        <span className="absolute bottom-0 h-9 w-[3px] -translate-x-1/2 rounded-full bg-accent-500" style={{ left: at(PRAGUE) }}>
          <span className="ruler-sun absolute -top-3 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-accent-500 ring-4 ring-accent-500/25" />
        </span>
      </div>
      <div className="text-micro relative h-3 text-muted-foreground" aria-hidden>
        {ticks
          .filter((lon) => lon % 20 === 0)
          .map((lon) => (
            <span key={lon} className="absolute -translate-x-1/2 tabular-nums" style={{ left: at(lon) }}>
              {lon}°E
            </span>
          ))}
      </div>
      <figcaption className="text-meta flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>
          <span className="font-semibold text-text-accent">Prague</span> · now
        </span>
        <span>
          <span className="font-semibold text-foreground">Kazakhstan</span> · home
        </span>
        <span className="tabular-nums">≈ {span}° of longitude between them</span>
      </figcaption>
    </figure>
  )
}
