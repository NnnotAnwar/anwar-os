"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { fieldClass, Toggle } from "@/components/editor-fields"
import { TelegramLogo } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { JournalSettings } from "../schema"
import { updateJournalSettings } from "../server-actions"

/** osbot's evening question: on/off and its time (the owner's clock). */
export function PromptSettings({ settings }: { settings: JournalSettings }) {
  const [enabled, setEnabled] = useState(settings.promptEnabled)
  const [time, setTime] = useState(settings.promptTime)
  const [saved, setSaved] = useState(settings)
  const [, start] = useTransition()

  function save(next: JournalSettings) {
    start(async () => {
      const result = await updateJournalSettings(next)
      if (!result.ok) {
        setEnabled(saved.promptEnabled)
        setTime(saved.promptTime)
        toast.error(result.error)
        return
      }
      setSaved(result.value)
      toast.success(next.promptEnabled ? `osbot asks at ${next.promptTime}` : "Evening question off")
    })
  }

  return (
    <section className="glass grid gap-3 rounded-xl p-4" aria-labelledby="journal-prompt">
      <h2 id="journal-prompt" className="text-card-title flex items-center gap-2 [&_svg]:size-4">
        <TelegramLogo />
        Evening question
      </h2>
      <Toggle
        checked={enabled}
        onChange={(on) => {
          setEnabled(on)
          save({ promptEnabled: on, promptTime: time })
        }}
        label="Ask me in Telegram how the day was"
        description="osbot sends “🌙 How was today?” with five faces, then asks for one line. Not sent once today has a mood, nor more than 3 hours late."
      />
      <label className={cn("flex items-center gap-3", !enabled && "opacity-60")}>
        <span className="text-small text-muted-foreground">At</span>
        <input
          type="time"
          value={time}
          disabled={!enabled}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => enabled && time && time !== saved.promptTime && save({ promptEnabled: true, promptTime: time })}
          aria-label="Evening question time"
          className={cn(fieldClass, "h-11 w-32 tabular-nums md:h-9 dark:[color-scheme:dark]")}
        />
      </label>
    </section>
  )
}
