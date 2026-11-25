"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { fieldClass, Toggle } from "@/components/editor-fields"
import { cn } from "@/lib/utils"
import type { BriefSettings as Settings } from "../brief"
import { updateBriefSettings } from "../server-actions"

/** Settings → Telegram: osbot's morning brief, on/off and its time (the owner's clock). */
export function BriefSettings({ settings, timezone }: { settings: Settings; timezone: string }) {
  const [enabled, setEnabled] = useState(settings.briefEnabled)
  const [time, setTime] = useState(settings.briefTime)
  const [saved, setSaved] = useState(settings)
  const [, start] = useTransition()

  function save(next: Settings) {
    start(async () => {
      const result = await updateBriefSettings(next)
      if (!result.ok) {
        setEnabled(saved.briefEnabled)
        setTime(saved.briefTime)
        toast.error(result.error)
        return
      }
      setSaved(result.value)
      toast.success(next.briefEnabled ? `Morning brief at ${next.briefTime}` : "Morning brief off")
    })
  }

  return (
    <div className="grid gap-3">
      <h3 className="text-body-strong">Scheduled messages</h3>
      <Toggle
        checked={enabled}
        onChange={(on) => {
          setEnabled(on)
          save({ briefEnabled: on, briefTime: time })
        }}
        label="Morning brief"
        description="Today's calendar, tasks, habits, money and payments in one message. Skipped if osbot is more than 3 hours late."
      />
      <label className={cn("flex items-center gap-3 pl-12", !enabled && "opacity-60")}>
        <span className="text-small text-muted-foreground">At</span>
        <input
          type="time"
          value={time}
          disabled={!enabled}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => enabled && time && time !== saved.briefTime && save({ briefEnabled: true, briefTime: time })}
          aria-label="Morning brief time"
          className={cn(fieldClass, "h-11 w-32 tabular-nums md:h-9 dark:[color-scheme:dark]")}
        />
        <span className="text-caption text-muted-foreground">{timezone.replace(/_/g, " ")}</span>
      </label>
      <p className="text-caption text-muted-foreground">
        The evening question is set in{" "}
        <Link href="/app/journal" className="text-text-accent underline-offset-4 hover:underline">
          Journal
        </Link>
        , habit reminders and the evening nudge in{" "}
        <Link href="/app/habits" className="text-text-accent underline-offset-4 hover:underline">
          Habits
        </Link>
        . /brief shows the brief any time.
      </p>
    </div>
  )
}
