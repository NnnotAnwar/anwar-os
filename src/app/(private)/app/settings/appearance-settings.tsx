"use client"

import { useId, useState, useTransition, type ReactNode } from "react"
import { toast } from "sonner"
import { Clock, MapPin, Monitor, Moon, Sun, SunHorizon } from "@/components/icons"
import { useResolvedTheme, useTheme } from "@/components/theme/theme-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveTheme } from "@/core/preferences-actions"
import { CITIES, findCity, parseCoordinates } from "@/lib/cities"
import { describeSchedule, evaluateTheme, roundCoordinate, type ThemeConfig, type ThemeMode } from "@/lib/theme"
import { cn } from "@/lib/utils"

const MODES: { value: ThemeMode; label: string; hint: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", hint: "Always", icon: <Sun /> },
  { value: "dark", label: "Dark", hint: "Always", icon: <Moon /> },
  { value: "system", label: "Match system", hint: "Follows this device", icon: <Monitor /> },
  { value: "scheduled", label: "Scheduled", hint: "Dark at night", icon: <Clock /> },
]

const fieldLabel = "text-eyebrow text-muted-foreground"

/** Settings → Appearance: the mode (saved at once) and the schedule (saved with its button). */
export function AppearanceSettings({
  place: savedPlace,
  timeZone,
  locale,
}: {
  place: string | null
  timeZone: string
  locale: string
}) {
  const { config, setTheme } = useTheme()
  const groupId = useId()

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className={cn(fieldLabel, "mb-2")}>Theme</legend>
        {/* Four across only on a full-width phone or small tablet; from md the column is
            460–520px (beside the sidebar or the heading) and "Scheduled" spilt out of a quarter. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2">
          {MODES.map((m) => (
            <label
              key={m.value}
              className={cn(
                "press grid min-h-16 cursor-pointer content-center gap-0.5 rounded-lg border border-field-border bg-field px-3 py-2 transition-colors",
                "has-checked:border-accent-500 has-checked:bg-accent-500/10 has-focus-visible:ring-3 has-focus-visible:ring-accent-500/30",
              )}
            >
              <input
                type="radio"
                name={`${groupId}-mode`}
                value={m.value}
                checked={config.mode === m.value}
                onChange={() => setTheme(m.value)}
                className="sr-only"
              />
              <span className="flex items-center gap-1.5 text-body-strong [&_svg]:size-4">
                {m.icon}
                {m.label}
              </span>
              <span className="text-caption text-muted-foreground">{m.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <ScheduleForm
        // A new saved schedule (another device, a reset) starts the form over.
        key={`${config.schedule}|${config.from}|${config.until}|${config.lat}|${config.lon}`}
        config={config}
        savedPlace={savedPlace}
        timeZone={timeZone}
        locale={locale}
      />
    </div>
  )
}

function ScheduleForm({
  config,
  savedPlace,
  timeZone,
  locale,
}: {
  config: ThemeConfig
  savedPlace: string | null
  timeZone: string
  locale: string
}) {
  const { apply } = useTheme()
  const { now } = useResolvedTheme()
  const id = useId()
  const [schedule, setSchedule] = useState(config.schedule)
  const [from, setFrom] = useState(config.from)
  const [until, setUntil] = useState(config.until)
  const savedPlaceText = savedPlace ?? (config.lat !== null && config.lon !== null ? `${config.lat}, ${config.lon}` : "")
  const [placeText, setPlaceText] = useState(savedPlaceText)
  const [locating, setLocating] = useState(false)
  const [pending, startTransition] = useTransition()

  const typed = findCity(placeText) ?? parseCoordinates(placeText)
  // A city from the list or typed coordinates; the saved place while the field is unchanged.
  const place = typed
    ? { lat: roundCoordinate(typed.lat), lon: roundCoordinate(typed.lon) }
    : placeText !== "" && placeText === savedPlaceText && config.lat !== null && config.lon !== null
      ? { lat: config.lat, lon: config.lon }
      : null

  const draft: ThemeConfig = { mode: "scheduled", schedule, from, until, lat: place?.lat ?? null, lon: place?.lon ?? null }
  const validHours = /^\d{2}:\d{2}$/.test(from) && /^\d{2}:\d{2}$/.test(until)
  const canSave = schedule === "hours" ? validHours : place !== null
  const placeProblem = schedule === "sun" && placeText.trim() !== "" && !place ? "Pick a city from the list, or type coordinates like 50.1, 14.4" : null
  const preview = now !== 0 && canSave ? describeSchedule(draft, evaluateTheme(draft, now, false), locale, timeZone) : null

  function locate() {
    if (!("geolocation" in navigator)) return toast.error("This browser can't share a location.")
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        // Rounded right away: about 10 km, all sunset needs. Nothing else is kept.
        setPlaceText(`${roundCoordinate(pos.coords.latitude)}, ${roundCoordinate(pos.coords.longitude)}`)
      },
      () => {
        setLocating(false)
        toast.error("Couldn't get your location. Pick a city instead.")
      },
      { enableHighAccuracy: false, maximumAge: 60 * 60_000, timeout: 15_000 },
    )
  }

  function save() {
    if (!canSave) return
    const label = findCity(placeText)?.name ?? (place ? placeText.trim() : null)
    startTransition(async () => {
      try {
        const saved = await saveTheme({ ...draft, place: schedule === "sun" ? label : undefined })
        apply(saved)
        toast.success("Dark at night: on")
      } catch {
        toast.error("Couldn't save the schedule. Try again.")
      }
    })
  }

  return (
    <section id="appearance-schedule" aria-labelledby={`${id}-title`} className="grid gap-4 border-t border-hairline pt-5">
      <div className="grid gap-1">
        <h3 id={`${id}-title`} className="text-body-strong">
          Schedule
        </h3>
        <p className="text-meta text-muted-foreground">
          What &ldquo;Scheduled&rdquo; follows. Saving it also turns Scheduled on.
        </p>
      </div>

      <fieldset className="grid grid-cols-2 gap-1 rounded-lg bg-field p-1">
        <legend className="sr-only">Schedule</legend>
        {(
          [
            { value: "hours", label: "Fixed hours", icon: <Clock /> },
            { value: "sun", label: "Sunset to sunrise", icon: <SunHorizon /> },
          ] as const
        ).map((s) => (
          <label
            key={s.value}
            className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-accent-500/30 md:min-h-9 [&_svg]:size-4"
          >
            <input
              type="radio"
              name={`${id}-schedule`}
              value={s.value}
              checked={schedule === s.value}
              onChange={() => setSchedule(s.value)}
              className="sr-only"
            />
            {s.icon}
            {s.label}
          </label>
        ))}
      </fieldset>

      {schedule === "hours" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5">
            <span className={fieldLabel}>Dark from</span>
            <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required className="h-11 text-base md:h-9 md:text-sm" />
          </label>
          <label className="grid gap-1.5">
            <span className={fieldLabel}>Light from</span>
            <Input type="time" value={until} onChange={(e) => setUntil(e.target.value)} required className="h-11 text-base md:h-9 md:text-sm" />
          </label>
        </div>
      ) : (
        <div className="grid gap-2">
          <label htmlFor={`${id}-place`} className={fieldLabel}>
            Place
          </label>
          <div className="flex gap-2">
            <Input
              id={`${id}-place`}
              list={`${id}-cities`}
              value={placeText}
              onChange={(e) => setPlaceText(e.target.value)}
              placeholder="City, or 50.1, 14.4"
              autoComplete="off"
              aria-invalid={placeProblem ? true : undefined}
              aria-describedby={`${id}-place-hint`}
              className="h-11 flex-1 text-base md:h-9 md:text-sm"
            />
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={locate} disabled={locating}>
              <MapPin />
              {locating ? "Locating…" : "Use my location"}
            </Button>
          </div>
          <datalist id={`${id}-cities`}>
            {CITIES.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
          <p id={`${id}-place-hint`} className={cn("text-caption", placeProblem ? "text-destructive" : "text-muted-foreground")}>
            {placeProblem ?? "Only an approximate place (about 10 km) is saved, and nothing is looked up online."}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-muted-foreground" aria-live="polite">
          {preview}
        </p>
        <Button type="button" className="h-11 md:h-9" disabled={!canSave || pending} onClick={save}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </section>
  )
}
