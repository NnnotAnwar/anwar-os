"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Plus } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type CreateItem = { label: string; href: string; icon: ReactNode }

/** The header "New" button: a direct link with one module, a menu with several. */
export function CreateMenu({ items }: { items: CreateItem[] }) {
  if (items.length === 0) return null

  if (items.length === 1) {
    const [only] = items
    return (
      <Link href={only!.href} className={cn(buttonVariants(), "gap-1.5")}>
        <Plus />
        <span className="hidden sm:inline">{only!.label}</span>
        <span className="sr-only sm:hidden">{only!.label}</span>
      </Link>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants(), "gap-1.5")} aria-label="Create something new">
        <Plus />
        <span className="hidden sm:inline">New</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} render={<Link href={item.href} />}>
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
