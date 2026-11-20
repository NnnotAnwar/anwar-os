"use client"

import { useEffect, useId, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import { toast } from "sonner"
import { Eye, EyeSlash, GripVertical, Plus, SidebarIcon, Trash2, X } from "@/components/icons"
import { Field, fieldClass, SaveStatus, Toggle } from "@/components/editor-fields"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAutosave } from "@/lib/use-autosave"
import { cn } from "@/lib/utils"
import type { Cv, CvContact, EntryKind, Profile } from "../schema"
import { deleteCvEntry, reorderCvEntries, saveCvEntry, saveCvProfile } from "../server-actions"
import { CvPreviewContext, CvPreviewStore, usePreviewCv, usePreviewStore } from "./cv-preview-store"
import { CvSheet } from "./cv-sheet"

type Ctx = { timezone: string; locale: string }

/**
 * The CV editor. Every field saves as you type; from 1280px a live preview of
 * the public page sits beside it (the same markup as /cv), so there's no need
 * to switch tabs to see the result.
 */
export function CvEditor({ cv, timezone, locale }: { cv: Cv } & Ctx) {
  const ctx = { timezone, locale }
  const [store] = useState(() => new CvPreviewStore())
  const [preview, setPreview] = useState(true)
  return (
    <CvPreviewContext value={store}>
      <div className={cn("grid items-start gap-4", preview && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        <div className="grid gap-4">
          <ProfileCard profile={cv.profile} ctx={ctx} />
          {(Object.keys(sections) as EntryKind[]).map((kind) => (
            <EntrySection key={kind} kind={kind} entries={cv[kind] as unknown as Entry[]} ctx={ctx} />
          ))}
        </div>
        {preview ? (
          <aside aria-labelledby="cv-preview-title" className="sticky top-20 grid gap-2 max-xl:hidden">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="grid gap-0.5">
                <h2 id="cv-preview-title" className="text-eyebrow text-text-accent">
                  Live preview
                </h2>
                <p className="text-caption text-muted-foreground">What visitors see on /cv, as you type</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreview(false)}>
                <SidebarIcon />
                Hide
              </Button>
            </div>
            <div className="max-h-[calc(100svh-8rem)] overflow-y-auto rounded-xl">
              <Preview store={store} />
            </div>
          </aside>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreview(true)}
            className="fixed right-6 bottom-6 z-20 max-xl:hidden"
          >
            <SidebarIcon />
            Show preview
          </Button>
        )}
      </div>
    </CvPreviewContext>
  )
}

function Preview({ store }: { store: CvPreviewStore }) {
  const cv = usePreviewCv(store)
  return <CvSheet cv={cv} className="text-[0.95em] [--glass-shadow:var(--shadow-glass)] md:p-7" />
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

type ProfileForm = Omit<Profile, "updatedAt" | "contacts"> & { contacts: (Required<Omit<CvContact, "url">> & { url: string })[] }

function ProfileCard({ profile, ctx }: { profile: Profile | null; ctx: Ctx }) {
  const { value, update, status, flush } = useAutosave<ProfileForm>({
    initial: {
      fullName: profile?.fullName ?? "",
      headline: profile?.headline ?? "",
      summary: profile?.summary ?? "",
      location: profile?.location ?? "",
      contacts: (profile?.contacts ?? []).map((c) => ({ label: c.label, value: c.value, url: c.url ?? "" })),
      isPublic: profile?.isPublic ?? false,
    },
    initialSavedAt: profile?.updatedAt ?? null,
    save: async (v) => {
      // Half-typed contact rows wait until they have a value.
      const result = await saveCvProfile({ ...v, contacts: v.contacts.filter((c) => c.value.trim()) })
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : result
    },
  })

  const store = usePreviewStore()
  useEffect(() => store?.setProfile(value), [store, value])

  function setContact(index: number, patch: Partial<ProfileForm["contacts"][number]>) {
    update((prev) => ({ ...prev, contacts: prev.contacts.map((c, i) => (i === index ? { ...c, ...patch } : c)) }))
  }

  return (
    <section aria-labelledby="cv-profile" className="glass grid gap-4 rounded-xl p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="cv-profile" className="text-card-title">
          Profile
        </h2>
        <SaveStatus status={status} idleText="Saves as you type" {...ctx} className="min-w-0 flex-1" />
      </header>
      <div className="rounded-lg bg-muted p-3">
        <Toggle
          checked={value.isPublic}
          onChange={(isPublic) => {
            update({ isPublic })
            void flush().then(() => toast.success(isPublic ? "CV published on /cv" : "CV hidden from visitors"))
          }}
          label="Publish CV"
          description="Shows this profile and every visible entry on the public /cv page. Off hides all of it."
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Full name" value={value.fullName} onChange={(fullName) => update({ fullName })} placeholder="e.g. Jana Nováková" max={120} />
        <TextField label="Location" value={value.location} onChange={(location) => update({ location })} placeholder="e.g. Prague, Czech Republic" max={120} />
        <TextField
          label="Headline"
          value={value.headline}
          onChange={(headline) => update({ headline })}
          placeholder="e.g. Economics student and web developer"
          max={160}
          className="sm:col-span-2"
        />
        <Field label="Summary" hint="Three or four sentences: what you do, what you're good at, what you want next." className="sm:col-span-2">
          {(id) => (
            <Textarea id={id} value={value.summary} onChange={(e) => update({ summary: e.target.value })} maxLength={2000} />
          )}
        </Field>
      </div>

      <div className="grid gap-2">
        <h3 className="text-small text-muted-foreground">Contacts</h3>
        {value.contacts.length === 0 && (
          <p className="text-caption text-muted-foreground">Add email, phone or profiles. Links make them clickable on /cv.</p>
        )}
        <ul className="grid gap-2">
          {value.contacts.map((contact, index) => (
            <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                aria-label={`Contact ${index + 1} label`}
                value={contact.label}
                onChange={(e) => setContact(index, { label: e.target.value })}
                placeholder="e.g. Email"
                maxLength={40}
                className={cn(fieldClass, "max-sm:col-span-1")}
              />
              <Button
                variant="ghost"
                size="icon"
                className="sm:order-last"
                onClick={() => update((prev) => ({ ...prev, contacts: prev.contacts.filter((_, i) => i !== index) }))}
                aria-label={`Remove contact ${contact.label || index + 1}`}
              >
                <X />
              </Button>
              <input
                aria-label={`Contact ${index + 1} value`}
                value={contact.value}
                onChange={(e) => setContact(index, { value: e.target.value })}
                placeholder="e.g. hello@example.com"
                maxLength={200}
                className={cn(fieldClass, "max-sm:col-span-2")}
              />
              <input
                aria-label={`Contact ${index + 1} link`}
                value={contact.url}
                onChange={(e) => setContact(index, { url: e.target.value })}
                placeholder="e.g. mailto:hello@example.com"
                maxLength={500}
                spellCheck={false}
                className={cn(fieldClass, "max-sm:col-span-2")}
              />
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => update((prev) => ({ ...prev, contacts: [...prev.contacts, { label: "", value: "", url: "" }] }))}
          disabled={value.contacts.length >= 12}
        >
          <Plus />
          Add contact
        </Button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Entry sections
// ---------------------------------------------------------------------------

type Values = Record<string, string | boolean | null>
type Entry = { id: string; updatedAt: string } & Values

type FieldDef = {
  name: string
  label: string
  type?: "text" | "month" | "textarea"
  placeholder?: string
  hint?: string
  wide?: boolean
}

type SectionDef = {
  title: string
  add: string
  empty: string
  required: string
  requiredMessage: string
  compact?: boolean
  fields: FieldDef[]
}

const sections: Record<EntryKind, SectionDef> = {
  experience: {
    title: "Experience",
    add: "Add experience",
    empty: "Jobs, internships, freelance work, volunteering. Newest first reads best — use the arrows to order.",
    required: "role",
    requiredMessage: "Add the role to save this entry.",
    fields: [
      { name: "role", label: "Role", placeholder: "e.g. Frontend developer" },
      { name: "organization", label: "Organization", placeholder: "e.g. Acme s.r.o." },
      { name: "startOn", label: "Start", type: "month" },
      { name: "endOn", label: "End", type: "month", hint: "Leave empty while it's ongoing." },
      { name: "location", label: "Location", placeholder: "e.g. Prague · remote", wide: true },
      { name: "description", label: "What you did", type: "textarea", placeholder: "- Shipped …\n- Led …", wide: true },
    ],
  },
  education: {
    title: "Education",
    add: "Add education",
    empty: "Degrees, schools, courses that matter.",
    required: "institution",
    requiredMessage: "Add the school to save this entry.",
    fields: [
      { name: "institution", label: "School", placeholder: "e.g. Prague University of Economics and Business" },
      { name: "degree", label: "Degree or programme", placeholder: "e.g. Bachelor's, Economics and Management" },
      { name: "startOn", label: "Start", type: "month" },
      { name: "endOn", label: "End", type: "month", hint: "Leave empty while you're studying." },
      { name: "location", label: "Location", placeholder: "e.g. Prague", wide: true },
      { name: "description", label: "Notes", type: "textarea", placeholder: "Thesis, focus, honours…", wide: true },
    ],
  },
  skills: {
    title: "Skills",
    add: "Add skill",
    empty: "Group skills with the same label, e.g. Development, Business, Tools.",
    required: "name",
    requiredMessage: "Name the skill to save it.",
    compact: true,
    fields: [
      { name: "name", label: "Skill", placeholder: "e.g. TypeScript" },
      { name: "category", label: "Group", placeholder: "e.g. Development" },
    ],
  },
  languages: {
    title: "Languages",
    add: "Add language",
    empty: "In the order you want them read, strongest first.",
    required: "name",
    requiredMessage: "Name the language to save it.",
    compact: true,
    fields: [
      { name: "name", label: "Language", placeholder: "e.g. Czech" },
      { name: "level", label: "Level", placeholder: "e.g. B2 · upper-intermediate" },
    ],
  },
}

type Item = { key: string; id: string | null; initial: Values; updatedAt: string | null }

let draftCounter = 0

function emptyValues(def: SectionDef): Values {
  const values: Values = { isPublic: true }
  for (const f of def.fields) values[f.name] = ""
  return values
}

function toValues(def: SectionDef, entry: Entry): Values {
  const values: Values = { isPublic: entry.isPublic }
  for (const f of def.fields) {
    const v = entry[f.name]
    values[f.name] = f.type === "month" ? (typeof v === "string" ? v.slice(0, 7) : "") : ((v as string) ?? "")
  }
  return values
}

/** A row's one-line title while you edit it: "Founder · Planuj Směny · 2024 – now". */
function summaryOf(def: SectionDef, value: Values) {
  const text = (name: string) => String(value[name] ?? "").trim()
  const [first, second] = def.fields.map((f) => f.name)
  const year = (v: string) => v.slice(0, 4)
  const start = text("startOn")
  const period = start ? `${year(start)} – ${text("endOn") ? year(text("endOn")) : "now"}` : ""
  return [text(first!), second ? text(second) : "", period].filter(Boolean).join(" · ")
}

/** Drag state: which row, where it started, where it would land, how far the pointer moved. */
type Drag = { key: string; from: number; to: number; dy: number; shift: number }

function arrayMove<T>(list: T[], from: number, to: number) {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

function EntrySection({ kind, entries, ctx }: { kind: EntryKind; entries: Entry[]; ctx: Ctx }) {
  const def = sections[kind]
  const [items, setItems] = useState<Item[]>(() =>
    entries.map((e) => ({ key: e.id, id: e.id, initial: toValues(def, e), updatedAt: e.updatedAt })),
  )
  const [, startTransition] = useTransition()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const listRef = useRef<HTMLOListElement>(null)
  const geometry = useRef<{ mids: number[]; startY: number } | null>(null)
  const hintId = useId()
  const headingId = `cv-${kind}`
  const store = usePreviewStore()
  useEffect(() => store?.setOrder(kind, items.map((i) => i.key)), [store, kind, items])

  function add() {
    setItems((prev) => [...prev, { key: `draft-${++draftCounter}`, id: null, initial: emptyValues(def), updatedAt: null }])
  }

  function created(key: string, id: string) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, id } : item)))
  }

  /** New order on screen at once; the saved rows' order goes to the server in one call. */
  function commit(next: Item[], label: string) {
    setItems(next)
    const ids = next.flatMap((i) => (i.id ? [i.id] : []))
    if (ids.length === 0) return
    startTransition(async () => {
      const result = await reorderCvEntries({ kind, ids })
      if (!result.ok) toast.error(`Couldn't save the new order of ${label}. Check your connection and try again.`)
    })
  }

  function moveBy(index: number, step: -1 | 1, label: string) {
    const to = index + step
    if (to < 0 || to >= items.length) return
    commit(arrayMove(items, index, to), def.title.toLowerCase())
    setAnnouncement(`${label} moved to position ${to + 1} of ${items.length}.`)
  }

  function startDrag(e: PointerEvent<HTMLButtonElement>, index: number) {
    if (e.button !== 0 || !listRef.current) return
    e.preventDefault() // no text selection while dragging
    const rows = [...listRef.current.children] as HTMLElement[]
    const rects = rows.map((row) => row.getBoundingClientRect())
    const gap = rects[1] ? rects[1].top - rects[0]!.bottom : 8
    geometry.current = { mids: rects.map((r) => r.top + r.height / 2), startY: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ key: items[index]!.key, from: index, to: index, dy: 0, shift: rects[index]!.height + gap })
  }

  function moveDrag(e: PointerEvent<HTMLButtonElement>) {
    const g = geometry.current
    if (!drag || !g) return
    const dy = e.clientY - g.startY
    const center = g.mids[drag.from]! + dy
    const to = g.mids.filter((mid, i) => i !== drag.from && mid < center).length
    setDrag({ ...drag, dy, to })
  }

  function endDrag(label: string) {
    if (!drag) return
    if (drag.to !== drag.from) {
      commit(arrayMove(items, drag.from, drag.to), def.title.toLowerCase())
      setAnnouncement(`${label} moved to position ${drag.to + 1} of ${items.length}.`)
    }
    setDrag(null)
    geometry.current = null
  }

  /** While dragging, the other rows slide out of the way of where the dragged one would land. */
  function offsetFor(index: number): CSSProperties | undefined {
    if (!drag) return undefined
    if (index === drag.from) return { transform: `translateY(${drag.dy}px)`, zIndex: 10 }
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: `translateY(${-drag.shift}px)` }
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return { transform: `translateY(${drag.shift}px)` }
    return { transform: "translateY(0)" }
  }

  function remove(item: Item) {
    const index = items.indexOf(item)
    setItems((prev) => prev.filter((i) => i.key !== item.key))
    if (!item.id) return
    let undone = false
    const commitDelete = () => {
      if (!undone) startTransition(() => deleteCvEntry({ kind, id: item.id! }))
    }
    toast.success("Entry removed", {
      action: {
        label: "Undo",
        onClick: () => {
          undone = true
          setItems((prev) => {
            const next = [...prev]
            next.splice(Math.min(index, next.length), 0, item)
            return next
          })
        },
      },
      onAutoClose: commitDelete,
      onDismiss: commitDelete,
    })
  }

  return (
    <section aria-labelledby={headingId} className="glass grid gap-3 rounded-xl p-4 md:p-5">
      <header className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-card-title">
          {def.title}
          {items.length > 0 && <span className="text-meta ml-2 text-muted-foreground tabular-nums">{items.length}</span>}
        </h2>
        {items.length > 1 && (
          <p id={hintId} className="text-caption text-muted-foreground max-sm:hidden">
            Drag <GripVertical className="inline size-3 align-[-1px]" /> to reorder, or focus it and use ↑ ↓
          </p>
        )}
      </header>
      {items.length === 0 && <p className="text-meta text-muted-foreground">{def.empty}</p>}
      {items.length > 0 && (
        <ol ref={listRef} className={cn("grid", def.compact ? "gap-2" : "gap-3", drag && "select-none")}>
          {items.map((item, index) => (
            <EntryRow
              key={item.key}
              kind={kind}
              def={def}
              item={item}
              style={offsetFor(index)}
              dragging={drag?.key === item.key}
              animating={drag !== null && drag.key !== item.key}
              grip={(label) => ({
                "aria-label": `Reorder ${label}`,
                "aria-describedby": items.length > 1 ? hintId : undefined,
                "aria-keyshortcuts": "ArrowUp ArrowDown",
                onPointerDown: (e) => startDrag(e, index),
                onPointerMove: moveDrag,
                onPointerUp: () => endDrag(label),
                onPointerCancel: () => setDrag(null),
                onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault()
                    moveBy(index, e.key === "ArrowUp" ? -1 : 1, label)
                  }
                },
              })}
              onRemove={() => remove(item)}
              onCreated={(id) => created(item.key, id)}
              onAddNext={index === items.length - 1 ? add : undefined}
              ctx={ctx}
            />
          ))}
        </ol>
      )}
      {/* Inline add: the next row appears where you're already looking. */}
      <button
        type="button"
        onClick={add}
        className="press text-meta flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-dashed border-field-border text-muted-foreground outline-none transition-colors hover:border-accent-500/60 hover:bg-secondary hover:text-text-accent focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9"
      >
        <Plus className="size-4" />
        {def.add}
      </button>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}

type GripProps = {
  "aria-label": string
  "aria-describedby"?: string
  "aria-keyshortcuts": string
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
}

function EntryRow({
  kind,
  def,
  item,
  style,
  dragging,
  animating,
  grip,
  onRemove,
  onCreated,
  onAddNext,
  ctx,
}: {
  kind: EntryKind
  def: SectionDef
  item: Item
  style?: CSSProperties
  dragging: boolean
  animating: boolean
  grip: (label: string) => GripProps
  onRemove: () => void
  onCreated: (id: string) => void
  /** Set on the last row: Enter in its last short field adds the next one. */
  onAddNext?: () => void
  ctx: Ctx
}) {
  const idRef = useRef(item.id)
  const { value, update, status, flush, discard } = useAutosave<Values>({
    initial: item.initial,
    initialSavedAt: item.updatedAt,
    validate: (v) => (String(v[def.required] ?? "").trim() ? null : def.requiredMessage),
    save: async (v) => {
      const result = await saveCvEntry(kind, idRef.current, v)
      if (!result.ok) return result
      if (!idRef.current) {
        idRef.current = result.id
        onCreated(result.id)
      }
      return { ok: true, updatedAt: result.updatedAt }
    },
  })
  const label = String(value[def.required] || "new entry")
  const visible = value.isPublic !== false
  const store = usePreviewStore()
  useEffect(() => store?.setRow(kind, item.key, value), [store, kind, item.key, value])
  useEffect(() => () => store?.setRow(kind, item.key, null), [store, kind, item.key])

  const handle = (
    <button
      type="button"
      {...grip(label)}
      className={cn(
        "flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing max-md:size-10",
        dragging && "cursor-grabbing bg-track text-foreground",
      )}
    >
      <GripVertical className="size-4" />
    </button>
  )

  // The dragged row follows the pointer; the others glide out of its way.
  const rowMotion: CSSProperties = {
    ...style,
    transition: dragging ? "box-shadow 200ms ease" : animating ? "transform 200ms var(--ease-out)" : undefined,
  }
  const rowClass = cn(
    "relative rounded-lg border border-hairline bg-field",
    dragging && "border-accent-500/50 shadow-[var(--shadow-glass-lg)]",
  )

  const controls = (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          update({ isPublic: !visible })
          void flush()
        }}
        aria-pressed={visible}
        aria-label={visible ? `Hide ${label} on /cv` : `Show ${label} on /cv`}
        title={visible ? "Shown on /cv" : "Hidden from /cv"}
        className={visible ? "text-text-accent" : "text-muted-foreground"}
      >
        {visible ? <Eye /> : <EyeSlash />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          discard()
          onRemove()
        }}
        aria-label={`Remove ${label}`}
        className="text-muted-foreground"
      >
        <Trash2 />
      </Button>
    </div>
  )

  const fields = def.fields.map((f) => {
    const v = String(value[f.name] ?? "")
    if (f.type === "textarea") {
      return (
        <Field key={f.name} label={f.label} hint={f.hint} className={cn(f.wide && "sm:col-span-2")}>
          {(id) => (
            <Textarea id={id} value={v} onChange={(e) => update({ [f.name]: e.target.value })} placeholder={f.placeholder} maxLength={4000} />
          )}
        </Field>
      )
    }
    return (
      <Field key={f.name} label={f.label} hint={def.compact ? undefined : f.hint} className={cn(f.wide && "sm:col-span-2")}>
        {(id) => (
          <input
            id={id}
            type={f.type === "month" ? "month" : "text"}
            value={v}
            onChange={(e) => update({ [f.name]: e.target.value })}
            placeholder={f.type === "month" ? "YYYY-MM" : f.placeholder}
            autoFocus={!item.id && f.name === def.required}
            onKeyDown={
              // Skills and languages are typed as a list: Enter in the last field starts the next row.
              def.compact && onAddNext && f === def.fields[def.fields.length - 1]
                ? (e) => {
                    if (e.key === "Enter" && String(value[def.required] ?? "").trim()) {
                      e.preventDefault()
                      onAddNext()
                    }
                  }
                : undefined
            }
            enterKeyHint={def.compact && onAddNext && f === def.fields[def.fields.length - 1] ? "next" : undefined}
            className={cn(fieldClass, "max-md:h-11")}
          />
        )}
      </Field>
    )
  })

  if (def.compact) {
    return (
      <li
        style={rowMotion}
        className={cn(
          rowClass,
          "grid gap-2 p-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end",
          !visible && "opacity-60",
        )}
      >
        <div className="max-sm:hidden sm:self-end sm:pb-0.5">{handle}</div>
        {fields}
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="sm:hidden">{handle}</span>
          <SaveStatus status={status} idleText={def.requiredMessage} {...ctx} className="min-w-0 flex-1 sm:hidden" />
          {controls}
        </div>
        {(status.kind === "error" || status.kind === "idle") && (
          <SaveStatus status={status} idleText={def.requiredMessage} {...ctx} className="max-sm:hidden sm:col-span-4" />
        )}
      </li>
    )
  }

  return (
    <li style={rowMotion} className={cn(rowClass, "grid gap-3 p-3", !visible && "opacity-60")}>
      <div className="flex items-center gap-2">
        {handle}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-body-strong truncate">{summaryOf(def, value) || def.add.replace("Add ", "New ")}</p>
          <SaveStatus status={status} idleText={def.requiredMessage} {...ctx} />
        </div>
        {controls}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{fields}</div>
    </li>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  max,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  max: number
  className?: string
}) {
  return (
    <Field label={label} className={className}>
      {(id) => (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={max} className={fieldClass} />
      )}
    </Field>
  )
}
