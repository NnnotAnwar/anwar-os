"use client"

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import { saveTheme } from "@/core/preferences-actions"
import {
  DEFAULT_THEME,
  encodeThemeCookie,
  evaluateTheme,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_COLORS,
  type ThemeConfig,
  type ThemeMode,
  type ThemeState,
} from "@/lib/theme"

/**
 * Only what changes on a user's choice. The clock and the system preference stay
 * out on purpose: they settle right after hydration, and a context change then
 * would reach Suspense boundaries that are still hydrating (the user menu, the
 * palette…) and make React client-render them. `useResolvedTheme()` reads those
 * where they're needed.
 */
type ThemeContextValue = {
  /** The saved mode: system, light, dark or scheduled. */
  theme: ThemeMode
  config: ThemeConfig
  /** Applies a new config on this device (class + cookie + other tabs); `background` for catching up. */
  apply: (config: ThemeConfig, options?: { background?: boolean }) => void
  /** Picks a mode (keeping the schedule) and saves it for every device. Signed-in only. */
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const CHANNEL = "aos-theme"
/** How often a scheduled theme re-checks the clock while the page is open. */
const TICK_MS = 30_000

const DARK_QUERY = "(prefers-color-scheme: dark)"

function subscribeSystem(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}
const systemDarkNow = () => window.matchMedia(DARK_QUERY).matches

/** The clock in 30 s steps; it only ticks while a schedule needs it, and on waking up. */
function subscribeClock(scheduled: boolean) {
  return (onChange: () => void) => {
    const onVisible = () => document.visibilityState === "visible" && onChange()
    document.addEventListener("visibilitychange", onVisible)
    const timer = scheduled ? window.setInterval(onChange, TICK_MS / 3) : undefined
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(timer)
    }
  }
}
const clockNow = () => Math.floor(Date.now() / TICK_MS)
/** The server (and hydration) render has no clock: 0 means "not in the browser yet". */
const noClock = () => 0
const noSystemDark = () => false

function writeCookie(config: ThemeConfig) {
  const secure = window.location.protocol === "https:" ? "; secure" : ""
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(encodeThemeCookie(config))}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax${secure}`
}

/** Switches the <html> class without animating every transition in the page. */
function paint(dark: boolean) {
  // The browser chrome (address bar, Android status bar) follows the chosen theme,
  // not just the system's (the root layout's theme-color metas are per system scheme).
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light)
  }
  const root = document.documentElement
  if (root.classList.contains(dark ? "dark" : "light") && !root.classList.contains(dark ? "light" : "dark")) return
  root.classList.add("theme-switching")
  root.classList.remove(dark ? "light" : "dark")
  root.classList.add(dark ? "dark" : "light")
  root.style.colorScheme = dark ? "dark" : "light"
  // Two frames: the new colours are painted before transitions come back.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")))
}

/**
 * Replaces next-themes: the same `useTheme()` shape, plus a schedule. The root
 * layout renders the pre-paint script (src/lib/theme.ts) with the cookie's
 * config, so the first paint is already right; this keeps it right afterwards
 * (system changes, the schedule's boundaries, other tabs, saving a new choice).
 */
/** Light or dark for `config` now, re-evaluated as the clock and the system change. */
function useEvaluation(config: ThemeConfig) {
  const scheduled = config.mode === "scheduled"
  const subscribe = useMemo(() => subscribeClock(scheduled), [scheduled])
  const tick = useSyncExternalStore(subscribe, clockNow, noClock)
  const systemDark = useSyncExternalStore(subscribeSystem, systemDarkNow, noSystemDark)
  const now = tick * TICK_MS
  // Before hydration ends this is a placeholder; the pre-paint script already set the class.
  const state = useMemo(() => evaluateTheme(config, now, systemDark), [config, now, systemDark])
  return { state, now }
}

/** Paints the theme; its own component, so the clock re-renders nothing else. */
function ThemePainter({ config }: { config: ThemeConfig }) {
  const { state, now } = useEvaluation(config)
  useEffect(() => {
    if (now !== 0) paint(state.dark)
  }, [now, state.dark])
  return null
}

export function ThemeProvider({ initial, children }: { initial: ThemeConfig | null; children: ReactNode }) {
  const [config, setConfig] = useState<ThemeConfig>(initial ?? DEFAULT_THEME)

  // Other tabs of this browser follow a change at once.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<ThemeConfig>) => startTransition(() => setConfig(event.data))
    return () => channel.close()
  }, [])

  const apply = useCallback((next: ThemeConfig, { background = false } = {}) => {
    // A choice the user just made shows at once (a controlled radio must not
    // snap back). Catching up in the background is a transition: if parts of the
    // page are still hydrating, React finishes that first.
    if (background) startTransition(() => setConfig(next))
    else setConfig(next)
    writeCookie(next)
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL)
      channel.postMessage(next)
      channel.close()
    }
  }, [])

  const setTheme = useCallback(
    (mode: ThemeMode) => {
      const next = { ...config, mode }
      apply(next)
      saveTheme(next).catch(() => toast.error("Couldn't save the theme. It's set on this device only."))
    },
    [config, apply],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: config.mode, config, apply, setTheme }),
    [config, apply, setTheme],
  )
  return (
    <ThemeContext.Provider value={value}>
      <ThemePainter config={config} />
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("useTheme needs <ThemeProvider>")
  return value
}

/**
 * What's showing now (and the clock it was judged at: 30 s steps, 0 until
 * hydrated). Each caller keeps its own clock, so only it re-renders.
 */
export function useResolvedTheme(): { resolvedTheme: "light" | "dark"; state: ThemeState; now: number } {
  const { config } = useTheme()
  const { state, now } = useEvaluation(config)
  return { resolvedTheme: state.dark ? "dark" : "light", state, now }
}
