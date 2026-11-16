"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { DotsGrid } from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type MoreItem = { label: string; href: string; icon: ReactNode }

/** Last phone tab: every module that didn't fit, plus Settings. */
export function MoreMenu({ items }: { items: MoreItem[] }) {
  const pathname = usePathname()
  const active = items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground outline-none focus-visible:text-foreground [&_svg]:size-5",
          active && "font-semibold text-text-accent",
        )}
      >
        <DotsGrid />
        More
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-56">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} render={<Link href={item.href} />} className="text-meta h-10">
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
