"use client"

import { useTransition } from "react"
import Link from "next/link"
import { Clock, House, LogOut, Monitor, Moon, Settings, Sun } from "@/components/icons"
import { useTheme } from "@/components/theme/theme-provider"
import { THEME_MODES, type ThemeMode } from "@/lib/theme"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOutSafely } from "@/components/offline/sign-out"
import { cn } from "@/lib/utils"

type Props = {
  name: string
  email: string | null
  role: string
  /** "full" shows name + role next to the avatar (sidebar); "compact" is avatar only. */
  variant: "full" | "compact"
}

export function UserMenu({ name, email, role, variant }: Props) {
  const { theme, config, setTheme } = useTheme()
  const [pending, startTransition] = useTransition()
  const initial = name.trim().charAt(0).toUpperCase() || "?"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account and appearance"
        className={cn(
          "flex items-center gap-2.5 rounded-md text-left outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50",
          variant === "full" ? "w-full px-2 py-1.5" : "p-1",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-600 font-display text-xs font-semibold text-primary-foreground">
          {initial}
        </span>
        {variant === "full" && (
          <span className="grid min-w-0 leading-tight">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{role}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={variant === "full" ? "start" : "end"} side={variant === "full" ? "top" : "bottom"} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid">
            <span className="text-sm font-medium text-foreground">{name}</span>
            {email && <span className="truncate text-xs font-normal">{email}</span>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/app/settings" />}>
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/" />}>
          <House />
          Public site
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(v) => THEME_MODES.includes(v as ThemeMode) && setTheme(v as ThemeMode)}
          >
            <DropdownMenuRadioItem value="light">
              <Sun />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor />
              Match system
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="scheduled">
              <Clock />
              <span className="grid">
                Scheduled
                <span className="text-xs text-muted-foreground">
                  {config.schedule === "sun" ? "Sunset to sunrise" : `Dark ${config.from}–${config.until}`}
                </span>
              </span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem render={<Link href="/app/settings#appearance" />} className="text-muted-foreground">
            Schedule settings…
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onClick={() => startTransition(() => signOutSafely())}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
