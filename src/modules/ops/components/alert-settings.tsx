"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Toggle } from "@/components/editor-fields"
import { Bell, BellSlash } from "@/components/icons"
import { Button } from "@/components/ui/button"
import type { OpsAlertKind } from "@/db/schema/ops"
import { alertKindLabels } from "../lib/server"
import type { AlertSettings } from "../alerts"
import { updateAlertSettings } from "../server-actions"

const MUTES = [
  { label: "1 h", hours: 1 },
  { label: "8 h", hours: 8 },
  { label: "24 h", hours: 24 },
]

/**
 * Which server problems osbot announces, and a mute. Each switch saves in one
 * tap; a mute offers Undo. Muted alerts are held, not dropped: what is still
 * wrong when the mute ends is sent then.
 */
export function AlertSettingsCard({
  initial,
  osbot,
  renderedAt,
  timezone,
  locale,
}: {
  initial: AlertSettings
  /** Is osbot configured and alive? Alerts go out through it. */
  osbot: { configured: boolean; connected: boolean }
  renderedAt: string
  timezone: string
  locale: string
}) {
  const [settings, setSettings] = useState(initial)
  const [saving, setSaving] = useState(false)
  const now = new Date(renderedAt)
  const muted = settings.mutedUntil && new Date(settings.mutedUntil) > now ? settings.mutedUntil : null
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

  async function save(next: AlertSettings, message: string, undo?: AlertSettings) {
    const before = settings
    setSettings(next)
    setSaving(true)
    const res = await updateAlertSettings(next)
    setSaving(false)
    if (!res.ok) {
      setSettings(before)
      toast.error(res.error)
      return
    }
    setSettings(res.settings)
    toast.success(message, undo ? { action: { label: "Undo", onClick: () => void save(undo, "Back as it was") } } : undefined)
  }

  function toggle(kind: OpsAlertKind, on: boolean) {
    const disabledKinds = on ? settings.disabledKinds.filter((k) => k !== kind) : [...settings.disabledKinds, kind]
    void save({ ...settings, disabledKinds }, `${alertKindLabels[kind].label} alerts ${on ? "on" : "off"}`)
  }

  return (
    <section className="glass grid gap-4 rounded-xl p-4 sm:p-5" aria-labelledby="alerts-title">
      <header className="grid gap-1">
        <h3 id="alerts-title" className="text-card-title flex items-center gap-2">
          {muted ? <BellSlash className="size-4 text-text-accent" /> : <Bell className="size-4 text-text-accent" />}
          Telegram alerts
        </h3>
        <p className="text-meta text-muted-foreground">
          {!osbot.configured
            ? "osbot isn't set up, so nothing is sent yet (docs/DEPLOY.md, “Connect osbot”). Choices here are kept for when it is."
            : !osbot.connected
              ? "osbot hasn't checked in for a few minutes: alerts wait until it is back."
              : "osbot checks every 5 minutes and tells you once when something breaks and once when it recovers."}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2" data-testid="alerts-mute">
        {muted ? (
          <>
            <p className="text-meta flex-1 text-warning-text">Muted until {time(muted)}. Held alerts go out then.</p>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={saving}
              onClick={() => void save({ ...settings, mutedUntil: null }, "Alerts unmuted", settings)}
            >
              Unmute
            </Button>
          </>
        ) : (
          <>
            <span className="text-meta text-muted-foreground">Mute all for</span>
            {MUTES.map((m) => (
              <Button
                key={m.hours}
                variant="outline"
                size="sm"
                className="min-h-11 min-w-11 sm:min-h-8"
                disabled={saving}
                onClick={() =>
                  void save(
                    { ...settings, mutedUntil: new Date(Date.now() + m.hours * 3_600_000).toISOString() },
                    `Alerts muted for ${m.label}`,
                    settings,
                  )
                }
              >
                {m.label}
              </Button>
            ))}
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(alertKindLabels) as OpsAlertKind[]).map((kind) => (
          <Toggle
            key={kind}
            checked={!settings.disabledKinds.includes(kind)}
            onChange={(on) => toggle(kind, on)}
            label={alertKindLabels[kind].label}
            description={alertKindLabels[kind].description}
            disabled={saving}
          />
        ))}
      </div>
    </section>
  )
}
