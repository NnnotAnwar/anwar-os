"use client"

import { createContext, useContext, useSyncExternalStore } from "react"
import type { Cv, CvContact, EntryKind } from "../schema"

/** What the editor's rows currently hold, field by field (months as "YYYY-MM"). */
export type RowValues = Record<string, string | boolean | null>
export type ProfileValues = {
  fullName: string
  headline: string
  summary: string
  location: string
  contacts: { label: string; value: string; url: string }[]
  isPublic: boolean
}

type Section = { order: string[]; values: Record<string, RowValues> }
type State = { profile: ProfileValues | null; sections: Record<EntryKind, Section> }

const empty = (): Section => ({ order: [], values: {} })
const required: Record<EntryKind, string> = { experience: "role", education: "institution", skills: "name", languages: "name" }
const month = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? `${v}-01` : null)

/**
 * A tiny store the editor writes to as you type and the live preview reads
 * from. Rows keep their own autosave state; they only publish a copy here, so
 * typing in one field re-renders just that row and the preview.
 */
export class CvPreviewStore {
  private state: State = {
    profile: null,
    sections: { experience: empty(), education: empty(), skills: empty(), languages: empty() },
  }
  private cv: Cv | null = null
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): Cv => (this.cv ??= this.build())

  setProfile(profile: ProfileValues) {
    this.state = { ...this.state, profile }
    this.emit()
  }

  setOrder(kind: EntryKind, order: string[]) {
    const section = this.state.sections[kind]
    if (section.order.join() === order.join()) return
    this.state = { ...this.state, sections: { ...this.state.sections, [kind]: { ...section, order } } }
    this.emit()
  }

  setRow(kind: EntryKind, key: string, values: RowValues | null) {
    const section = this.state.sections[kind]
    const next = { ...section.values }
    if (values) next[key] = values
    else delete next[key]
    this.state = { ...this.state, sections: { ...this.state.sections, [kind]: { ...section, values: next } } }
    this.emit()
  }

  private emit() {
    this.cv = null
    for (const listener of this.listeners) listener()
  }

  /** The same filtering visitors get: published rows with their required field filled in. */
  private build(): Cv {
    const rows = (kind: EntryKind) => {
      const { order, values } = this.state.sections[kind]
      return order
        .map((key) => [key, values[key]] as const)
        .flatMap(([key, v]): (RowValues & { id: string })[] =>
          v && v.isPublic !== false && String(v[required[kind]] ?? "").trim() ? [{ ...v, id: key }] : [],
        )
    }
    const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
    const p = this.state.profile
    return {
      profile: p
        ? {
            fullName: p.fullName.trim(),
            headline: p.headline.trim(),
            summary: p.summary.trim(),
            location: p.location.trim(),
            contacts: p.contacts
              .filter((c) => c.value.trim())
              .map((c): CvContact => ({ label: c.label.trim(), value: c.value.trim(), url: c.url.trim() || undefined })),
            isPublic: p.isPublic,
            updatedAt: "",
          }
        : null,
      experience: rows("experience").map((v) => ({
        id: v.id,
        updatedAt: "",
        role: text(v.role),
        organization: text(v.organization),
        location: text(v.location),
        startOn: month(v.startOn),
        endOn: month(v.endOn),
        description: text(v.description),
        isPublic: true,
      })),
      education: rows("education").map((v) => ({
        id: v.id,
        updatedAt: "",
        institution: text(v.institution),
        degree: text(v.degree),
        location: text(v.location),
        startOn: month(v.startOn),
        endOn: month(v.endOn),
        description: text(v.description),
        isPublic: true,
      })),
      skills: rows("skills").map((v) => ({ id: v.id, updatedAt: "", name: text(v.name), category: text(v.category), isPublic: true })),
      languages: rows("languages").map((v) => ({ id: v.id, updatedAt: "", name: text(v.name), level: text(v.level), isPublic: true })),
    }
  }
}

export const CvPreviewContext = createContext<CvPreviewStore | null>(null)

export function usePreviewStore() {
  return useContext(CvPreviewContext)
}

/** The CV as the preview should draw it right now. */
export function usePreviewCv(store: CvPreviewStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
