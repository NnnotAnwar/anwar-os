"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import {
  Download,
  FileText,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
  CloudUpload,
} from "@/components/icons"
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
import { DropZone, UploadPanel, useUploader } from "./uploader"

type Row = (Folder & { kind: "folder" }) | Item

type DialogState =
  | { type: "new-folder" }
  | { type: "rename"; row: Row }
  | { type: "move"; row: Row }
  | { type: "delete-folder"; row: Folder & { kind: "folder" } }
  | null

/**
 * One folder's contents: subfolders first, then files and documents in the
 * chosen order. Upload by button or drag-and-drop; every row has a menu for
 * rename, move, download and delete (with Undo for files and documents).
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
  const input = useRef<HTMLInputElement>(null)
  const { uploads, add, clear } = useUploader(folderId)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const close = () => setDialog(null)

  const rows: Row[] = [...folders.map((f) => ({ ...f, kind: "folder" as const })), ...items].filter(
    (r) => !hidden.has(`${r.kind}:${r.id}`),
  )
  const day = new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", timeZone: timezone })
  const dayYear = new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", year: "numeric", timeZone: timezone })
  const thisYear = new Date().getFullYear()
  const formatDate = (iso: string) => (new Date(iso).getFullYear() === thisYear ? day : dayYear).format(new Date(iso))

  function setRowHidden(row: Row, value: boolean) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (value) next.add(`${row.kind}:${row.id}`)
      else next.delete(`${row.kind}:${row.id}`)
      return next
    })
  }

  function remove(row: Row) {
    if (row.kind === "folder") return setDialog({ type: "delete-folder", row })
    removeWithUndo({
      message: row.kind === "file" ? "File deleted" : "Document deleted",
      hide: () => setRowHidden(row, true),
      restore: () => setRowHidden(row, false),
      commit: () => (row.kind === "file" ? deleteFile({ id: row.id }) : deleteDocument({ id: row.id })),
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

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="lg" onClick={() => setDialog({ type: "new-folder" })}>
        <FolderPlus />
        New folder
      </Button>
      <Link
        href={folderId ? `/app/files/doc/new?folder=${folderId}` : "/app/files/doc/new"}
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        <FileText />
        New document
      </Link>
      <Button size="lg" onClick={() => input.current?.click()} disabled={!storageReady}>
        <Upload />
        Upload
      </Button>
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
  )

  return (
    <div className="grid gap-3">
      {actions}
      {!storageReady && (
        <p className="text-meta rounded-xl bg-warning-surface px-3 py-2 text-warning-text">
          File storage isn&apos;t configured, so uploads are off. Documents and folders still work.
        </p>
      )}
      <UploadPanel uploads={uploads} onClear={clear} />
      <DropZone onFiles={add} folderName={folderName}>
        {rows.length === 0 ? (
          <EmptyFolder onUpload={() => input.current?.click()} storageReady={storageReady} />
        ) : (
          <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl" aria-label={`Contents of ${folderName}`}>
            {rows.map((row) => (
              <li key={`${row.kind}:${row.id}`} className="group flex items-center gap-1 pr-2 hover:bg-white/40 dark:hover:bg-white/5">
                <Link
                  href={itemHref(row)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                >
                  <ItemIcon item={row} />
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
                <RowMenu
                  row={row}
                  onRename={() => setDialog({ type: "rename", row })}
                  onMove={() => setDialog({ type: "move", row })}
                  onDelete={() => remove(row)}
                />
              </li>
            ))}
          </ul>
        )}
      </DropZone>

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
        itemName={dialog?.type === "move" ? dialog.row.name : ""}
        movingFolderId={dialog?.type === "move" && dialog.row.kind === "folder" ? dialog.row.id : null}
        currentFolderId={folderId}
        folders={allFolders}
        onMove={(target) =>
          dialog?.type === "move" ? moveItem({ kind: dialog.row.kind, id: dialog.row.id, folderId: target }) : Promise.resolve({ ok: false })
        }
      />
      <DeleteFolderDialog row={dialog?.type === "delete-folder" ? dialog.row : null} onClose={close} />
    </div>
  )
}

function RowMenu({
  row,
  onRename,
  onMove,
  onDelete,
}: {
  row: Row
  onRename: () => void
  onMove: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`Actions for ${row.name}`} className="shrink-0 text-muted-foreground max-sm:size-10" />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass glass-menu w-44">
        <DropdownMenuItem render={<Link href={itemHref(row)} />}>
          <FolderOpen />
          Open
        </DropdownMenuItem>
        {row.kind === "file" && (
          <DropdownMenuItem render={<a href={rawHref(row.id, "download")} />}>
            <Download />
            Download
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMove}>
          <FolderPlus />
          Move to…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DeleteFolderDialog({ row, onClose }: { row: Folder | null; onClose: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <AlertDialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="glass glass-menu">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-card-title">Delete “{row?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Everything inside goes too: subfolders, documents and uploaded files. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-caption rounded-lg bg-error-surface px-2 py-1.5 text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep folder</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              if (!row) return
              setPending(true)
              const result = await deleteFolder({ id: row.id })
              setPending(false)
              if (result.ok) onClose()
              else setError(result.error)
            }}
          >
            Delete folder
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function EmptyFolder({ onUpload, storageReady }: { onUpload: () => void; storageReady: boolean }) {
  return (
    <div className={cn("grid justify-items-start gap-3 rounded-xl border border-dashed border-field-border p-6")}>
      <CloudUpload className="size-7 text-text-accent" aria-hidden />
      <div className="grid gap-1">
        <p className="text-body-strong">Nothing here yet</p>
        <p className="text-meta max-w-prose text-muted-foreground">
          {storageReady
            ? "Drop files here or upload them — PDFs, images, office documents and archives up to 100 MB. Or write a document."
            : "Write a document or make a folder to start."}
        </p>
      </div>
      {storageReady && (
        <Button variant="outline" onClick={onUpload}>
          <Upload />
          Upload files
        </Button>
      )}
    </div>
  )
}
