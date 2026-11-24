"use client"

import { useSyncExternalStore } from "react"

// The last few queries that led somewhere, on this device only (localStorage).
// Storage can be missing or throw (private mode, blocked site data): search then
// simply has no history.

const KEY = "anwar.os:recent-searches"
const CHANGE = "anwar:recent-searches"
export const MAX_RECENT = 8

/** Newest first, without case-insensitive duplicates, at most `max`. Pure. */
export function pushRecent(list: readonly string[], query: string, max = MAX_RECENT): string[] {
  const q = query.trim().replace(/\s+/g, " ")
  if (!q) return [...list]
  const lower = q.toLocaleLowerCase()
  return [q, ...list.filter((item) => item.toLocaleLowerCase() !== lower)].slice(0, max)
}

function readRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

function parse(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function write(list: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // No storage: nothing to remember.
  }
  window.dispatchEvent(new Event(CHANGE))
}

export function rememberSearch(query: string) {
  write(pushRecent(parse(readRaw()), query))
}

export function forgetSearch(query: string) {
  write(parse(readRaw()).filter((q) => q !== query))
}

export function clearRecentSearches() {
  write([])
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(CHANGE, onChange)
    window.removeEventListener("storage", onChange)
  }
}

// useSyncExternalStore needs a stable snapshot: parse once per stored string.
let lastRaw = ""
let lastList: string[] = []
function snapshot() {
  const raw = readRaw()
  if (raw !== lastRaw) {
    lastRaw = raw
    lastList = parse(raw)
  }
  return lastList
}
const empty: string[] = []

export function useRecentSearches(): string[] {
  return useSyncExternalStore(subscribe, snapshot, () => empty)
}
