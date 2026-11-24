// Appearance: light, dark, match the system, or scheduled (fixed hours, or
// sunset to sunrise at an approximate place). Pure, shared by the server (root
// layout, settings), the client provider and the inline pre-paint script.
//
// Where it lives: core_preferences (per user, so phone and desktop agree) and a
// mirror cookie, `aos-theme`, which the root layout reads to apply the theme
// before the first paint, on the public site too. Visitors have no cookie and
// get "system".

export const THEME_MODES = ["system", "light", "dark", "scheduled"] as const
export type ThemeMode = (typeof THEME_MODES)[number]
export const THEME_SCHEDULES = ["hours", "sun"] as const
export type ThemeSchedule = (typeof THEME_SCHEDULES)[number]

export type ThemeConfig = {
  mode: ThemeMode
  schedule: ThemeSchedule
  /** Local wall-clock "HH:MM": dark from … until … (may cross midnight). */
  from: string
  until: string
  /** Approximate place for sunset/sunrise. Both or neither. */
  lat: number | null
  lon: number | null
}

export const DEFAULT_THEME: ThemeConfig = { mode: "system", schedule: "hours", from: "20:00", until: "07:00", lat: null, lon: null }
export const THEME_COOKIE = "aos-theme"
/** A year, renewed on every save; if it lapses, the app shell (ThemeSync) writes it again. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
/** The canvas colours, for the browser's theme-color (matches --canvas-via in globals.css). */
export const THEME_COLORS = { light: "#f5f4f9", dark: "#121022" } as const

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function isHhmm(value: string) {
  return HHMM.test(value)
}

/** Rounds to one decimal (~10 km): enough for sunset, and no precise location is kept. */
export function roundCoordinate(value: number) {
  return Math.round(value * 10) / 10
}

/** "scheduled|sun|20:00|07:00|50.1|14.4": short, cookie-safe after encodeURIComponent. */
export function encodeThemeCookie(c: ThemeConfig): string {
  return [c.mode, c.schedule, c.from, c.until, c.lat ?? "", c.lon ?? ""].join("|")
}

/** Parses the cookie strictly; anything unexpected is "no preference" (null). */
export function decodeThemeCookie(value: string | undefined | null): ThemeConfig | null {
  if (!value || value.length > 80) return null
  const [mode, schedule, from, until, lat, lon, ...rest] = value.split("|")
  if (rest.length || lat === undefined || lon === undefined) return null
  if (!THEME_MODES.includes(mode as ThemeMode) || !THEME_SCHEDULES.includes(schedule as ThemeSchedule)) return null
  if (!isHhmm(from ?? "") || !isHhmm(until ?? "")) return null
  const place = parsePlace(lat, lon)
  if (place === undefined) return null
  if (schedule === "sun" && !place) return null
  return {
    mode: mode as ThemeMode,
    schedule: schedule as ThemeSchedule,
    from: from!,
    until: until!,
    lat: place?.lat ?? null,
    lon: place?.lon ?? null,
  }
}

function parsePlace(lat: string, lon: string): { lat: number; lon: number } | null | undefined {
  if (lat === "" && lon === "") return null
  const la = Number(lat)
  const lo = Number(lon)
  if (lat === "" || lon === "" || !Number.isFinite(la) || !Number.isFinite(lo)) return undefined
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return undefined
  return { lat: la, lon: lo }
}

export type ThemeState = {
  dark: boolean
  /** For the sun schedule: the sunrise and sunset (epoch ms) of the day nearest now. */
  rise: number | null
  set: number | null
  /** The sun schedule where the sun doesn't rise or set at all that day. */
  polar: "night" | "day" | null
}

/**
 * Light or dark right now. SELF-CONTAINED on purpose: the root layout inlines
 * its source (`Function.prototype.toString`) into the pre-paint script, so it
 * must not reference anything outside its own body. Local time is the browser's.
 *
 * Sun: the NOAA-style sunrise equation (≈1 min accuracy, plenty for a theme),
 * around the solar noon nearest to `now`, with the standard −0.833° horizon.
 */
export function evaluateTheme(
  c: { mode: string; schedule: string; from: string; until: string; lat: number | null; lon: number | null } | null,
  now: number,
  systemDark: boolean,
): { dark: boolean; rise: number | null; set: number | null; polar: "night" | "day" | null } {
  if (!c || c.mode === "system") return { dark: systemDark, rise: null, set: null, polar: null }
  if (c.mode === "dark") return { dark: true, rise: null, set: null, polar: null }
  if (c.mode !== "scheduled") return { dark: false, rise: null, set: null, polar: null }

  if (c.schedule === "sun" && c.lat !== null && c.lon !== null) {
    const rad = Math.PI / 180
    const jd = now / 86400000 + 2440587.5
    // Days since J2000 of the solar noon nearest to now at this longitude.
    const n = Math.round(jd - 2451545.0009 + c.lon / 360)
    const jStar = n + 0.0009 - c.lon / 360
    const m = (357.5291 + 0.98560028 * jStar) % 360
    const center = 1.9148 * Math.sin(m * rad) + 0.02 * Math.sin(2 * m * rad) + 0.0003 * Math.sin(3 * m * rad)
    const lambda = (m + center + 180 + 102.9372) % 360
    const transit = 2451545 + jStar + 0.0053 * Math.sin(m * rad) - 0.0069 * Math.sin(2 * lambda * rad)
    const sinDecl = Math.sin(lambda * rad) * Math.sin(23.4397 * rad)
    const cosDecl = Math.cos(Math.asin(sinDecl))
    const cosHour = (Math.sin(-0.833 * rad) - Math.sin(c.lat * rad) * sinDecl) / (Math.cos(c.lat * rad) * cosDecl)
    if (cosHour > 1) return { dark: true, rise: null, set: null, polar: "night" }
    if (cosHour < -1) return { dark: false, rise: null, set: null, polar: "day" }
    const half = Math.acos(cosHour) / rad / 360
    const rise = (transit - half - 2440587.5) * 86400000
    const set = (transit + half - 2440587.5) * 86400000
    return { dark: now < rise || now >= set, rise: rise, set: set, polar: null }
  }

  const d = new Date(now)
  const minute = d.getHours() * 60 + d.getMinutes()
  const from = Number(c.from.slice(0, 2)) * 60 + Number(c.from.slice(3, 5))
  const until = Number(c.until.slice(0, 2)) * 60 + Number(c.until.slice(3, 5))
  // Same start and end: never dark (an empty window), not always.
  const dark = from < until ? minute >= from && minute < until : from > until ? minute >= from || minute < until : false
  return { dark: dark, rise: null, set: null, polar: null }
}

/**
 * The pre-paint script: sets `dark`/`light` and color-scheme on <html> before
 * the body renders, so there's no flash. Inlined with the request's CSP nonce.
 */
export function themeScript(config: ThemeConfig | null): string {
  // JSON can't close the <script>: escape "<" anyway, belt and braces.
  const json = JSON.stringify(config).replace(/</g, "\\u003c")
  return `(function(c){try{var evaluate=${evaluateTheme.toString()};var s=evaluate(c,Date.now(),window.matchMedia("(prefers-color-scheme: dark)").matches);var d=document.documentElement;d.classList.remove(s.dark?"light":"dark");d.classList.add(s.dark?"dark":"light");d.style.colorScheme=s.dark?"dark":"light"}catch(e){}})(${json})`
}

/** "20:00–07:00", or the sunset/sunrise times today in the viewer's zone. */
export function describeSchedule(c: ThemeConfig, state: ThemeState, locale: string, timeZone?: string): string {
  if (c.schedule === "hours") return `Dark ${c.from}–${c.until}`
  if (state.polar === "night") return "Dark all day here (polar night)"
  if (state.polar === "day") return "Light all day here (midnight sun)"
  if (state.rise === null || state.set === null) return "Sunset to sunrise"
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  return `Dark after sunset ${time.format(state.set)}, light from sunrise ${time.format(state.rise)}`
}
