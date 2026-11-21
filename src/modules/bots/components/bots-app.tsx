"use client"

import { useState, useTransition } from "react"
import NextLink from "next/link"
import { toast } from "sonner"
import { ArrowUpRight, MoreHorizontal, Pencil, Plus, Robot, TelegramLogo, Trash2 } from "@/components/icons"
import { RowContextMenu } from "@/components/list/row-menu"
import { EmptyState } from "@/components/list/shortcut-hint"
import type { RowAction } from "@/components/list/swipe-row"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { formatMoney, liveness } from "../lib/stats"
import type { Bot, BotStats, BotWithStats, DailyPoint } from "../schema"
import { addKnownBots, deleteBot } from "../server-actions"
import { BotFormSheet } from "./bot-form"

/** The linked service's state from ops, prepared on the server. */
export type ServiceState = { label: string; tone: "ok" | "warn" | "down" | "off" }

export function BotsApp({
  bots,
  services,
  locale,
  renderedAt,
}: {
  /** Server clock (ISO) so SSR and hydration agree. */
  renderedAt: string
  bots: BotWithStats[]
  /** By service name; null when the control panel isn't connected. */
  services: Record<string, ServiceState> | null
  locale: string
}) {
  const [editing, setEditing] = useState<Bot | "new" | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [adding, startAdding] = useTransition()
  const [now] = useState(() => new Date(renderedAt))

  function remove(bot: Bot) {
    removeWithUndo({
      message: `${bot.name} removed from the registry`,
      hide: () => setHidden((h) => new Set(h).add(bot.id)),
      restore: () =>
        setHidden((h) => {
          const next = new Set(h)
          next.delete(bot.id)
          return next
        }),
      commit: () => deleteBot({ id: bot.id }),
    })
  }

  function addKnown() {
    startAdding(async () => {
      const res = await addKnownBots()
      if (!res.ok) toast.error(res.error)
      else toast.success(res.value ? `Added ${res.value} ${res.value === 1 ? "bot" : "bots"}` : "Both bots are already here")
    })
  }

  const shown = bots.filter((b) => !hidden.has(b.id))

  return (
    <div className="grid gap-4">
      {shown.length === 0 ? (
        <EmptyState
          icon={Robot}
          title="No bots registered"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="lg" onClick={addKnown} disabled={adding}>
                <Plus />
                Add Expenses and osbot
              </Button>
              <Button size="lg" variant="outline" onClick={() => setEditing("new")}>
                Another bot
              </Button>
            </div>
          }
        >
          Register your Telegram bots to see their users, activity and whether they are alive.
        </EmptyState>
      ) : (
        <>
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((b) => (
              <BotCard
                key={b.id}
                bot={b}
                service={b.serviceName && services ? (services[b.serviceName] ?? { label: "· not running here", tone: "off" }) : null}
                now={now}
                locale={locale}
                onEdit={() => setEditing(b)}
                onRemove={() => remove(b)}
              />
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing("new")} className="min-h-11 sm:min-h-9">
              <Plus />
              Add a bot
            </Button>
            {shown.length < 2 && (
              <Button variant="ghost" onClick={addKnown} disabled={adding} className="min-h-11 sm:min-h-9">
                Add the built-in bots
              </Button>
            )}
          </div>
        </>
      )}
      <BotFormSheet bot={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </div>
  )
}

const toneDot: Record<ServiceState["tone"], string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  down: "bg-destructive",
  off: "bg-muted-foreground/50",
}

function BotCard({
  bot,
  service,
  now,
  locale,
  onEdit,
  onRemove,
}: {
  bot: BotWithStats
  service: ServiceState | null
  now: Date
  locale: string
  onEdit: () => void
  onRemove: () => void
}) {
  const s = bot.stats
  const beat = s.kind === "schema" || s.kind === "osbot" ? liveness(s.lastBeatAt, now) : null
  const actions: RowAction[] = [
    { id: "edit", label: "Edit", icon: Pencil, onSelect: onEdit, shortcut: "E" },
    { id: "remove", label: "Remove from registry", icon: Trash2, tone: "destructive", onSelect: onRemove },
  ]

  return (
    <li>
      <RowContextMenu actions={actions} label={bot.name} render={<div />}>
        <article className="glass grid h-full content-start gap-4 rounded-xl p-4">
          <header className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Robot className="size-5" />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <h2 className="text-card-title truncate">{bot.name}</h2>
              <p className="text-caption flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                {bot.telegramUsername && (
                  <a
                    href={`https://t.me/${bot.telegramUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <TelegramLogo className="size-3.5" />@{bot.telegramUsername}
                  </a>
                )}
                {beat && (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        beat.state === "alive" ? "bg-emerald-500" : beat.state === "silent" ? "bg-amber-500" : "bg-muted-foreground/50",
                      )}
                    />
                    <span className={cn(beat.state === "silent" && "text-warning-text")}>{beat.label}</span>
                  </span>
                )}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-11 sm:size-8" aria-label={`${bot.name} options`} />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onRemove}>
                  <Trash2 />
                  Remove from registry
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <Stats stats={s} locale={locale} />

          {bot.description && <p className="text-meta text-muted-foreground">{bot.description}</p>}

          {bot.serviceName && (
            <NextLink
              href={`/app/ops#service-${bot.serviceName}`}
              className="text-caption -mx-2 -mb-1 flex min-h-11 items-center gap-2 rounded-lg px-2 text-muted-foreground outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9"
            >
              {service && <span aria-hidden className={cn("size-2 rounded-full", toneDot[service.tone])} />}
              <span className="text-foreground">{bot.serviceName}</span>
              <span className="truncate">{service ? service.label : "· control panel not connected"}</span>
              <ArrowUpRight className="ml-auto size-3.5 shrink-0" />
            </NextLink>
          )}
        </article>
      </RowContextMenu>
    </li>
  )
}

function Stats({ stats: s, locale }: { stats: BotStats; locale: string }) {
  const n = (v: number | null) => (v == null ? "–" : new Intl.NumberFormat(locale).format(v))
  if (s.kind === "none") return <p className="text-meta text-muted-foreground">No stats source set. Edit the bot to add one.</p>
  if (s.kind === "unavailable") return <p className="text-meta rounded-lg bg-track px-3 py-2 text-muted-foreground">{s.reason}</p>
  if (s.kind === "osbot") {
    return (
      <dl className="grid grid-cols-2 gap-3">
        <Metric label="Version" value={s.version ? s.version.slice(0, 12) : "–"} />
        <Metric label="Internal API" value={s.configured ? "Configured" : "Not configured"} />
      </dl>
    )
  }
  const money = Object.entries(s.amounts)
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-3 gap-3">
        <Metric label="Users" value={n(s.users)} />
        <Metric label="Active 7 d" value={n(s.active7d)} />
        <Metric label="Active 30 d" value={n(s.active30d)} />
        {s.counters.map((c) => (
          <Metric key={c.label} label={c.label} value={n(c.value)} />
        ))}
        {money.map(([cur, minor]) => (
          <Metric key={cur} label={`Total ${cur}`} value={formatMoney(minor, cur, locale)} className="col-span-2" />
        ))}
      </dl>
      {s.daily.length > 0 && <Sparkline points={s.daily} />}
    </div>
  )
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("grid min-w-0 gap-0.5", className)}>
      <dt className="text-caption truncate text-muted-foreground">{label}</dt>
      <dd className="text-body-strong truncate tabular-nums">{value}</dd>
    </div>
  )
}

/** Messages per day, last two weeks: bars, today on the right. */
function Sparkline({ points }: { points: DailyPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.messages))
  const total = points.reduce((sum, p) => sum + p.messages, 0)
  return (
    <figure className="grid gap-1.5">
      <div className="flex h-10 items-end gap-[3px]" role="img" aria-label={`${total} messages in the last ${points.length} days`}>
        {points.map((p) => (
          <span
            key={p.day}
            title={`${p.day}: ${p.messages} messages, ${p.activeUsers} users`}
            className={cn("min-h-[2px] flex-1 rounded-sm", p.messages ? "bg-accent-500/70" : "bg-track")}
            style={{ height: `${Math.max(5, (p.messages / max) * 100)}%` }}
          />
        ))}
      </div>
      <figcaption className="text-caption flex justify-between text-muted-foreground">
        <span>Messages, {points.length} days</span>
        <span className="tabular-nums">{total}</span>
      </figcaption>
    </figure>
  )
}
