"use client"

import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Eye, EyeSlash, Plus, Trash2, X } from "@/components/icons"
import { Field, fieldClass, SaveStatus, Toggle } from "@/components/editor-fields"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAutosave } from "@/lib/use-autosave"
import { cn } from "@/lib/utils"
import type { Cv, CvContact, EntryKind, Profile } from "../schema"
import { deleteCvEntry, moveCvEntry, saveCvEntry, saveCvProfile } from "../server-actions"

type Ctx = { timezone: string; locale: string }

export function CvEditor({ cv, timezone, locale }: { cv: Cv } & Ctx) {
  const ctx = { timezone, locale }
  return (
    <div className="grid gap-4">
      <ProfileCard profile={cv.profile} ctx={ctx} />
      {(Object.keys(sections) as EntryKind[]).map((kind) => (
        <EntrySection key={kind} kind={kind} entries={cv[kind] as unknown as Entry[]} ctx={ctx} />
      ))}
    </div>
  )
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

function EntrySection({ kind, entries, ctx }: { kind: EntryKind; entries: Entry[]; ctx: Ctx }) {
  const def = sections[kind]
  const [items, setItems] = useState<Item[]>(() =>
    entries.map((e) => ({ key: e.id, id: e.id, initial: toValues(def, e), updatedAt: e.updatedAt })),
  )
  const [, startTransition] = useTransition()
  const headingId = `cv-${kind}`

  function add() {
    setItems((prev) => [...prev, { key: `draft-${++draftCounter}`, id: null, initial: emptyValues(def), updatedAt: null }])
  }

  function created(key: string, id: string) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, id } : item)))
  }

  function move(index: number, direction: "up" | "down") {
    const item = items[index]
    const to = direction === "up" ? index - 1 : index + 1
    if (!item?.id || !items[to]?.id) return
    setItems((prev) => {
      const next = [...prev]
      ;[next[index], next[to]] = [next[to]!, next[index]!]
      return next
    })
    startTransition(() => moveCvEntry({ kind, id: item.id!, direction }))
  }

  function remove(item: Item) {
    const index = items.indexOf(item)
    setItems((prev) => prev.filter((i) => i.key !== item.key))
    if (!item.id) return
    let undone = false
    const commit = () => {
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
      onAutoClose: commit,
      onDismiss: commit,
    })
  }

  return (
    <section aria-labelledby={headingId} className="glass grid gap-3 rounded-xl p-4 md:p-5">
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-card-title">
          {def.title}
          {items.length > 0 && <span className="text-meta ml-2 text-muted-foreground tabular-nums">{items.length}</span>}
        </h2>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus />
          {def.add}
        </Button>
      </header>
      {items.length === 0 ? (
        <p className="text-meta text-muted-foreground">{def.empty}</p>
      ) : (
        <ol className={cn("grid", def.compact ? "gap-2" : "gap-3")}>
          {items.map((item, index) => (
            <EntryRow
              key={item.key}
              kind={kind}
              def={def}
              item={item}
              canUp={index > 0 && Boolean(item.id && items[index - 1]?.id)}
              canDown={index < items.length - 1 && Boolean(item.id && items[index + 1]?.id)}
              onMove={(direction) => move(index, direction)}
              onRemove={() => remove(item)}
              onCreated={(id) => created(item.key, id)}
              ctx={ctx}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

function EntryRow({
  kind,
  def,
  item,
  canUp,
  canDown,
  onMove,
  onRemove,
  onCreated,
  ctx,
}: {
  kind: EntryKind
  def: SectionDef
  item: Item
  canUp: boolean
  canDown: boolean
  onMove: (direction: "up" | "down") => void
  onRemove: () => void
  onCreated: (id: string) => void
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

  const controls = (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" onClick={() => onMove("up")} disabled={!canUp} aria-label={`Move ${label} up`}>
        <ArrowUp />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => onMove("down")} disabled={!canDown} aria-label={`Move ${label} down`}>
        <ArrowDown />
      </Button>
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
            className={fieldClass}
          />
        )}
      </Field>
    )
  })

  if (def.compact) {
    return (
      <li className={cn("grid gap-2 rounded-lg border border-hairline p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end", !visible && "opacity-60")}>
        {fields}
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <SaveStatus status={status} idleText={def.requiredMessage} {...ctx} className="sm:hidden" />
          {controls}
        </div>
        {(status.kind === "error" || status.kind === "idle") && (
          <SaveStatus status={status} idleText={def.requiredMessage} {...ctx} className="max-sm:hidden sm:col-span-3" />
        )}
      </li>
    )
  }

  return (
    <li className={cn("grid gap-3 rounded-lg border border-hairline p-3", !visible && "opacity-60")}>
      <div className="flex items-center gap-2">
        <SaveStatus status={status} idleText={def.requiredMessage} {...ctx} className="min-w-0 flex-1" />
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
