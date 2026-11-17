"use client"

import { useRef, useState, type DragEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CheckSquare,
  CloudUpload,
  Download,
  Eye,
  FileText,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { pendingRemovals, usePendingRemovals } from "@/components/list/pending"
import { RowContextMenu } from "@/components/list/row-menu"
import { BulkBar, SelectButton, SelectCheck, useSelection } from "@/components/list/selection"
import { EmptyState, ShortcutHint } from "@/components/list/shortcut-hint"
import { SwipeRow, type RowAction } from "@/components/list/swipe-row"
import { useListKeyboard } from "@/components/list/use-list-keyboard"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { itemHref, rawHref } from "../lib/links"
import { ACCEPT, formatBytes } from "../lib/validation"
import type { Folder, Item } from "../schema"
import {
  createFolder,
  deleteDocument,
  deleteFile,
  deleteFolder,
  moveItem,
  renameDocument,
  renameFolder,
  updateFile,
} from "../server-actions"
import { MoveDialog, NameDialog } from "./dialogs"
import { ItemIcon } from "./file-type-icon"
import { previewable, QuickLook } from "./quick-look"
import { DropZone, UploadPanel, useUploader } from "./uploader"

type Row = (Folder & { kind: "folder" }) | Item

type DialogState =
  | { type: "new-folder" }
  | { type: "rename"; row: Row }
  | { type: "move"; rows: Row[] }
  | { type: "delete-folders"; rows: Row[] }
  | null

/** Items dragged between rows, folders and breadcrumbs (not files from the desktop). */
export const DRAG_TYPE = "application/x-anwar-files"

const keyOf = (row: { kind: string; id: string }) => `${row.kind}:${row.id}`

/**
 * One folder's contents: subfolders first, then files and documents in the
 * chosen order. Upload by button or by dropping files; drag rows onto a folder
 * (or a breadcrumb) to move them. Swipe, long-press, right-click, the "…"
 * menu and the keyboard all reach the same actions. Deletes offer Undo,
 * except folders, which take their contents with them and ask first.
 */
export function FilesBrowser({
  folderId,
  folderName,
  folders,
  items,
  allFolders,
  dateLocale,
  timezone,
  storageReady,
}: {
  folderId: string | null
  folderName: string
  folders: Folder[]
  items: Item[]
  allFolders: Folder[]
  dateLocale: string
  timezone: string
  storageReady: boolean
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const { uploads, add, clear } = useUploader(folderId)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [look, setLook] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const removed = usePendingRemovals()
  const close = () => setDialog(null)

  const rows: Row[] = [...folders.map((f) => ({ ...f, kind: "folder" as const })), ...items].filter(
    (r) => !removed.has(keyOf(r)),
  )
  const byKey = new Map(rows.map((r) => [keyOf(r), r]))
  const selection = useSelection(rows.map(keyOf))
  const previews = previewable(rows)
  const folderNames = new Map(allFolders.map((f) => [f.id, f.name]))

  const day = new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", timeZone: timezone })
  const dayYear = new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", year: "numeric", timeZone: timezone })
  const thisYear = new Date().getFullYear()
  const formatDate = (iso: string) => (new Date(iso).getFullYear() === thisYear ? day : dayYear).format(new Date(iso))

  const selectedRows = () => [...selection.ids].map((k) => byKey.get(k)).filter((r): r is Row => Boolean(r))
  const targets = (key: string | null): Row[] => (selection.count ? selectedRows() : key && byKey.get(key) ? [byKey.get(key)!] : [])

  function remove(list: Row[]) {
    if (!list.length) return
    if (list.some((r) => r.kind === "folder")) return setDialog({ type: "delete-folders", rows: list })
    selection.done()
    removeWithUndo({
      message:
        list.length === 1
          ? list[0]!.kind === "file"
            ? "File deleted"
            : "Document deleted"
          : `${list.length} items deleted`,
      hide: () => list.forEach((r) => pendingRemovals.add(keyOf(r))),
      restore: () => list.forEach((r) => pendingRemovals.remove(keyOf(r))),
      commit: async () => {
        const results = await Promise.all(
          list.map((r) => (r.kind === "file" ? deleteFile({ id: r.id }) : deleteDocument({ id: r.id }))),
        )
        return results.find((r) => !r.ok) ?? { ok: true }
      },
    })
  }

  /** Moves rows to a folder at once (they leave this list) with Undo. */
  async function move(list: Row[], target: string | null) {
      const moving = list.filter((r) => r.id !== target && (r.kind !== "folder" || r.id !== target))
      if (!moving.length || target === folderId) return
      selection.done()
      moving.forEach((r) => pendingRemovals.add(keyOf(r)))
      const results = await Promise.all(moving.map((r) => moveItem({ kind: r.kind, id: r.id, folderId: target })))
      const failed = moving.filter((_, i) => !results[i]!.ok)
      failed.forEach((r) => pendingRemovals.remove(keyOf(r)))
      const firstError = results.find((r) => !r.ok)
      if (firstError && !firstError.ok) toast.error(firstError.error)
      const done = moving.filter((_, i) => results[i]!.ok)
      if (!done.length) return
      const where = target ? (folderNames.get(target) ?? "the folder") : "All files"
      toast.success(`${done.length === 1 ? `“${done[0]!.name}”` : `${done.length} items`} moved to ${where}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            await Promise.all(done.map((r) => moveItem({ kind: r.kind, id: r.id, folderId })))
            done.forEach((r) => pendingRemovals.remove(keyOf(r)))
          },
        },
      })
  }

  function rename(row: Row, name: string) {
    switch (row.kind) {
      case "folder":
        return renameFolder({ id: row.id, name })
      case "document":
        return renameDocument({ id: row.id, title: name })
      case "file":
        return updateFile({ id: row.id, name, description: row.description, tags: row.tags })
    }
  }

  function quickLook(row: Row) {
    const i = previews.findIndex((p) => p.id === row.id)
    if (i >= 0) setLook(i)
    else router.push(itemHref(row), { transitionTypes: NAV_FORWARD })
  }

  useListKeyboard({
    container: list,
    filter: { get current() { return typeof document === "undefined" ? null : (document.getElementById("files-filter") as HTMLInputElement | null) } },
    selection,
    enabled: look === null && dialog === null,
    handlers: {
      new: () => router.push(folderId ? `/app/files/doc/new?folder=${folderId}` : "/app/files/doc/new"),
      open: (key) => {
        const row = key && byKey.get(key)
        if (row) router.push(itemHref(row), { transitionTypes: NAV_FORWARD })
      },
      edit: (key) => {
        const row = key && byKey.get(key)
        if (row) setDialog({ type: "rename", row })
      },
      quickLook: (key) => {
        const row = key && byKey.get(key)
        if (row) quickLook(row)
      },
      delete: (key) => remove(targets(key)),
    },
    extra: {
      m: (key) => {
        const list = targets(key)
        if (list.length) setDialog({ type: "move", rows: list })
      },
    },
  })

  function actionsFor(row: Row): RowAction[] {
    const canPreview = row.kind === "file" && previews.some((p) => p.id === row.id)
    return [
      { id: "open", label: "Open", icon: FolderOpen, onSelect: () => router.push(itemHref(row), { transitionTypes: NAV_FORWARD }), shortcut: "↵" },
      ...(canPreview ? [{ id: "look", label: "Quick look", icon: Eye, onSelect: () => quickLook(row), shortcut: "Space" }] : []),
      ...(row.kind === "file"
        ? [{ id: "download", label: "Download", icon: Download, onSelect: () => window.location.assign(rawHref(row.id, "download")) }]
        : []),
      { id: "rename", label: "Rename", icon: Pencil, onSelect: () => setDialog({ type: "rename", row }), shortcut: "E" },
      { id: "move", label: "Move to…", icon: FolderPlus, tone: "neutral", onSelect: () => setDialog({ type: "move", rows: [row] }), shortcut: "M" },
      { id: "select", label: "Select", icon: CheckSquare, onSelect: () => selection.toggle(keyOf(row)), shortcut: "X" },
      { id: "delete", label: "Delete", icon: Trash2, tone: "destructive", onSelect: () => remove([row]), shortcut: "⌫" },
    ]
  }

  // Dragging rows (mouse): the selection if the row is in it, else the row.
  function onRowDragStart(e: DragEvent, row: Row) {
    const key = keyOf(row)
    const keys = selection.has(key) ? [...selection.ids] : [key]
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(keys))
    e.dataTransfer.effectAllowed = "move"
  }
  const carriesRows = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE)
  function onFolderDrop(e: DragEvent, target: string | null) {
    if (!carriesRows(e)) return
    e.preventDefault()
    setDropTarget(null)
    const keys = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]") as string[]
    void move(keys.map((k) => byKey.get(k)).filter((r): r is Row => Boolean(r)), target)
  }

  return (
    <div className="grid gap-3" ref={list}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" onClick={() => input.current?.click()} disabled={!storageReady}>
          <Upload />
          Upload
        </Button>
        <Link
          href={folderId ? `/app/files/doc/new?folder=${folderId}` : "/app/files/doc/new"}
          className={buttonVariants({ variant: "outline", size: "lg" })}
        >
          <FileText />
          <span className="max-sm:sr-only">New document</span>
          <span className="sm:hidden" aria-hidden>
            Document
          </span>
        </Link>
        <Button variant="outline" size="lg" onClick={() => setDialog({ type: "new-folder" })}>
          <FolderPlus />
          <span className="max-sm:sr-only">New folder</span>
          <span className="sm:hidden" aria-hidden>
            Folder
          </span>
        </Button>
        <div className="ml-auto">
          <SelectButton selection={selection} disabled={rows.length === 0} />
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files)
            e.target.value = ""
          }}
        />
      </div>
      {!storageReady && (
        <p className="text-meta rounded-xl bg-warning-surface px-3 py-2 text-warning-text">
          File storage isn&apos;t configured, so uploads are off. Documents and folders still work.
        </p>
      )}
      <UploadPanel uploads={uploads} onClear={clear} />
      <DropZone onFiles={add} folderName={folderName}>
        {rows.length === 0 ? (
          <EmptyState
            icon={CloudUpload}
            title="Nothing here yet"
            action={
              storageReady ? (
                <Button size="lg" onClick={() => input.current?.click()}>
                  <Upload />
                  Upload files
                </Button>
              ) : (
                <Link href={folderId ? `/app/files/doc/new?folder=${folderId}` : "/app/files/doc/new"} className={buttonVariants({ size: "lg" })}>
                  <FileText />
                  Write a document
                </Link>
              )
            }
          >
            {storageReady
              ? "Drop files anywhere on this page — PDFs, images, office files and archives up to 100 MB."
              : "Write a document or make a folder to start."}
          </EmptyState>
        ) : (
          <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl" aria-label={`Contents of ${folderName}`}>
            {rows.map((row) => {
              const key = keyOf(row)
              const actions = actionsFor(row)
              const checked = selection.has(key)
              const isTarget = row.kind === "folder" && dropTarget === row.id
              return (
                <li
                  key={key}
                  data-row-id={key}
                  draggable
                  onDragStart={(e) => onRowDragStart(e, row)}
                  onDragOver={(e) => {
                    if (row.kind !== "folder" || !carriesRows(e)) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                    if (dropTarget !== row.id) setDropTarget(row.id)
                  }}
                  onDragLeave={() => isTarget && setDropTarget(null)}
                  onDrop={(e) => row.kind === "folder" && onFolderDrop(e, row.id)}
                  className={cn(isTarget && "bg-secondary ring-2 ring-accent-500/60 ring-inset")}
                >
                  <SwipeRow
                    disabled={selection.active}
                    trailing={[actions.find((a) => a.id === "delete")!, actions.find((a) => a.id === "move")!]}
                    fullSwipe={row.kind !== "folder"}
                  >
                    <RowContextMenu actions={actions} label={row.name}>
                      <div
                        className={cn(
                          "group flex items-center gap-1 pr-2 hover:bg-white/40 dark:hover:bg-white/5",
                          checked && "bg-secondary hover:bg-secondary",
                        )}
                      >
                        <Link
                          data-row-primary
                          href={itemHref(row)}
                          transitionTypes={NAV_FORWARD}
                          draggable={false}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              e.preventDefault()
                              selection.extend(key)
                            } else if (selection.active) {
                              e.preventDefault()
                              selection.toggle(key)
                            }
                          }}
                          className="flex min-h-13 min-w-0 flex-1 items-center gap-3 py-2 pl-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                        >
                          {selection.active ? <SelectCheck checked={checked} className="mx-1.5" /> : <ItemIcon item={row} />}
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="text-body truncate">{row.name}</span>
                            <span className="text-caption truncate text-muted-foreground sm:hidden">
                              {row.kind === "folder" ? "Folder" : `${formatBytes(row.size)} · ${formatDate(row.createdAt)}`}
                            </span>
                            {row.kind === "document" && row.excerpt && (
                              <span className="text-caption hidden truncate text-muted-foreground sm:block">{row.excerpt}</span>
                            )}
                            {row.kind === "file" && row.tags.length > 0 && (
                              <span className="text-caption hidden truncate text-text-accent sm:block">
                                {row.tags.map((t) => `#${t}`).join(" ")}
                              </span>
                            )}
                          </span>
                          <span className="text-small hidden w-20 shrink-0 text-right text-muted-foreground tabular-nums sm:block">
                            {row.kind === "folder" ? "" : formatDate(row.createdAt)}
                          </span>
                          <span className="text-small hidden w-20 shrink-0 text-right text-muted-foreground tabular-nums sm:block">
                            {row.kind === "folder" ? "—" : formatBytes(row.size)}
                          </span>
                        </Link>
                        <RowMenu row={row} actions={actions} />
                      </div>
                    </RowContextMenu>
                  </SwipeRow>
                </li>
              )
            })}
          </ul>
        )}
      </DropZone>

      {rows.length > 0 && (
        <ShortcutHint
          items={[
            [["J", "K"], "move"],
            [["↵"], "open"],
            [["Space"], "quick look"],
            [["E"], "rename"],
            [["M"], "move to"],
            [["X"], "select"],
            [["⌫"], "delete"],
            [["N"], "new document"],
          ]}
          touch="Swipe a row left to delete or move it. Hold it for more."
        />
      )}
      <p className="text-caption hidden text-muted-foreground pointer-fine:block">
        Drag rows onto a folder or a breadcrumb to move them; drop files from your computer to upload.
      </p>

      <BulkBar selection={selection} noun={["item", "items"]} total={rows.length}>
        <Button variant="ghost" size="lg" disabled={!selection.count} onClick={() => setDialog({ type: "move", rows: selectedRows() })}>
          <FolderPlus />
          <span className="max-sm:sr-only">Move</span>
        </Button>
        <Button variant="destructive" size="lg" disabled={!selection.count} onClick={() => remove(selectedRows())}>
          <Trash2 />
          <span className="max-sm:sr-only">Delete</span>
        </Button>
      </BulkBar>

      <QuickLook files={previews} index={look} onIndex={setLook} onClose={() => setLook(null)} />

      <NameDialog
        open={dialog?.type === "new-folder"}
        onOpenChange={(o) => !o && close()}
        title="New folder"
        label="Name"
        placeholder="e.g. Taxes 2026"
        submitLabel="Create folder"
        onSubmit={(name) => createFolder({ name, parentId: folderId })}
      />
      <NameDialog
        open={dialog?.type === "rename"}
        onOpenChange={(o) => !o && close()}
        title={`Rename ${dialog?.type === "rename" ? dialog.row.kind : ""}`}
        label="Name"
        initial={dialog?.type === "rename" ? dialog.row.name : ""}
        submitLabel="Rename"
        onSubmit={(name) => (dialog?.type === "rename" ? rename(dialog.row, name) : Promise.resolve({ ok: false }))}
      />
      <MoveDialog
        open={dialog?.type === "move"}
        onOpenChange={(o) => !o && close()}
        itemName={dialog?.type === "move" ? (dialog.rows.length === 1 ? dialog.rows[0]!.name : `${dialog.rows.length} items`) : ""}
        movingFolderId={dialog?.type === "move" ? (dialog.rows.find((r) => r.kind === "folder")?.id ?? null) : null}
        currentFolderId={folderId}
        folders={allFolders}
        onMove={async (target) => {
          if (dialog?.type !== "move") return { ok: false }
          const list = dialog.rows
          close()
          await move(list, target)
          return { ok: true }
        }}
      />
      <DeleteFoldersDialog
        rows={dialog?.type === "delete-folders" ? dialog.rows : null}
        onClose={close}
        onDone={() => selection.done()}
      />
    </div>
  )
}

function RowMenu({ row, actions }: { row: Row; actions: RowAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`Actions for ${row.name}`} className="shrink-0 text-muted-foreground max-sm:size-10" />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass glass-menu w-48">
        {actions
          .filter((a) => a.tone !== "destructive")
          .map((a) => (
            <DropdownMenuItem key={a.id} onClick={a.onSelect}>
              <a.icon />
              {a.label}
            </DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        {actions
          .filter((a) => a.tone === "destructive")
          .map((a) => (
            <DropdownMenuItem key={a.id} variant="destructive" onClick={a.onSelect}>
              <a.icon />
              {a.label}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Folders take everything inside with them, so this one asks first. */
function DeleteFoldersDialog({ rows, onClose, onDone }: { rows: Row[] | null; onClose: () => void; onDone: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const single = rows?.length === 1 ? rows[0] : null
  return (
    <AlertDialog open={rows !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="glass glass-menu">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-card-title">
            {single ? `Delete “${single.name}”?` : `Delete ${rows?.length ?? 0} items?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Everything inside the folders goes too: subfolders, documents and uploaded files. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-caption rounded-lg bg-error-surface px-2 py-1.5 text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep {single?.kind === "folder" ? "folder" : "them"}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              if (!rows) return
              setPending(true)
              const results = await Promise.all(
                rows.map((r) =>
                  r.kind === "folder" ? deleteFolder({ id: r.id }) : r.kind === "file" ? deleteFile({ id: r.id }) : deleteDocument({ id: r.id }),
                ),
              )
              setPending(false)
              const failed = results.find((r) => !r.ok)
              if (failed && !failed.ok) return setError(failed.error)
              onDone()
              onClose()
            }}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
