"use client"

import { useEffect, useState } from "react"
import { Check, Rocket } from "@/components/icons"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/time"
import { shortTag } from "../lib/status"
import type { AgentService, ImageTag } from "../schema"
import { loadTags } from "../server-actions"

/**
 * Pick a tag and deploy it. Lists recent GHCR tags with their commit message;
 * any other tag can be typed. The agent pulls it, swaps the container, waits for
 * its healthcheck and rolls back by itself if it fails.
 */
export function DeploySheet({
  service,
  onOpenChange,
  onDeploy,
}: {
  service: AgentService | null
  onOpenChange: (open: boolean) => void
  onDeploy: (service: AgentService, tag: string) => void
}) {
  return (
    <Sheet
      open={service !== null}
      onOpenChange={onOpenChange}
      title={service ? `Deploy ${service.name}` : "Deploy"}
      description={
        service ? (
          <>
            Running <span className="text-foreground tabular-nums">{shortTag(service.tag)}</span>. The new container must pass
            its healthcheck, or the current one comes back.
          </>
        ) : undefined
      }
      className="sm:max-w-lg"
    >
      {service && <DeployForm key={service.name} service={service} onDeploy={onDeploy} />}
    </Sheet>
  )
}

function DeployForm({ service, onDeploy }: { service: AgentService; onDeploy: (service: AgentService, tag: string) => void }) {
  const [tags, setTags] = useState<ImageTag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState("")
  const [typed, setTyped] = useState("")
  const name = service.name

  useEffect(() => {
    let live = true
    void loadTags({ service: name }).then((res) => {
      if (!live) return
      if (res.ok) {
        setTags(res.tags)
        setPicked(res.tags.find((t) => !t.current)?.tag ?? "")
      } else {
        setTags([])
        setError(res.error)
      }
    })
    return () => {
      live = false
    }
  }, [name])

  const tag = typed.trim() || picked
  const valid = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)
  const now = new Date()

  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onDeploy(service, tag)
      }}
    >
      <fieldset className="grid gap-1.5">
        <legend className="text-eyebrow mb-1.5 text-muted-foreground">Recent images</legend>
        {tags === null ? (
          <div className="grid gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-track" />
            ))}
          </div>
        ) : tags.length === 0 ? (
          <p className="text-meta text-muted-foreground">{error ?? "No tags found for this image."}</p>
        ) : (
          <ul className="grid max-h-[40svh] gap-1 overflow-y-auto">
            {tags.map((t) => {
              const selected = !typed && picked === t.tag
              return (
                <li key={t.tag}>
                  <label
                    className={cn(
                      "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 outline-none hover:bg-track has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      selected && "bg-secondary",
                    )}
                  >
                    <input
                      type="radio"
                      name="tag"
                      value={t.tag}
                      checked={selected}
                      onChange={() => {
                        setPicked(t.tag)
                        setTyped("")
                      }}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-field-border",
                        selected && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {selected && <Check className="size-2.5" />}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="text-body-strong tabular-nums">{shortTag(t.tag)}</span>
                        {t.current && (
                          <span className="text-micro rounded-md bg-primary/12 px-1.5 py-0.5 text-text-accent">Running</span>
                        )}
                        {t.date && (
                          <time dateTime={t.date} className="text-caption ml-auto shrink-0 text-muted-foreground">
                            {formatRelative(new Date(t.date), now, "en")}
                          </time>
                        )}
                      </span>
                      {t.message && <span className="text-caption line-clamp-2 text-muted-foreground">{t.message}</span>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>

      <label className="grid gap-1.5">
        <span className="text-caption text-muted-foreground">Or type a tag</span>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="e.g. a commit sha or latest"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={typed !== "" && !valid}
        />
      </label>

      <Button type="submit" size="lg" disabled={!valid || tag === service.tag}>
        <Rocket />
        {tag ? `Deploy ${shortTag(tag)}` : "Pick a tag"}
      </Button>
      <p className="text-caption text-muted-foreground">
        Takes up to a few minutes: pull, start, healthcheck. The tag stays until the next deploy from main.
      </p>
    </form>
)
}
