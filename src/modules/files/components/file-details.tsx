"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, Trash2 } from "@/components/icons"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { folderHref, rawHref } from "../lib/links"
import { normalizeTags } from "../lib/validation"
import type { FileItem } from "../schema"
import { deleteFile, updateFile } from "../server-actions"

/** Name, description and tags for one file, plus download and delete. */
export function FileDetails({ file }: { file: FileItem }) {
  const router = useRouter()
  const [name, setName] = useState(file.name)
  const [description, setDescription] = useState(file.description)
  const [tags, setTags] = useState(file.tags.join(", "))
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const [deleting, startDeleting] = useTransition()
  const dirty = name !== file.name || description !== file.description || normalizeTags(tags).join(",") !== file.tags.join(",")

  function save(e: FormEvent) {
    e.preventDefault()
    startSaving(async () => {
      const result = await updateFile({ id: file.id, name, description, tags: normalizeTags(tags) })
      if (!result.ok) return setError(result.error)
      setError(null)
      setTags(result.value.tags.join(", "))
      setName(result.value.name)
      toast.success("Changes saved")
      router.refresh()
    })
  }

  function remove() {
    startDeleting(async () => {
      const result = await deleteFile({ id: file.id })
      if (!result.ok) return setError(result.error)
      toast.success("File deleted")
      router.push(folderHref(file.folderId))
    })
  }

  return (
    <form onSubmit={save} className="glass grid content-start gap-4 rounded-xl p-4">
      <div className="grid gap-1.5">
        <label htmlFor="file-name" className="text-meta text-muted-foreground">
          Name
        </label>
        <Input id="file-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="file-description" className="text-meta text-muted-foreground">
          Description
        </label>
        <Textarea
          id="file-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          placeholder="e.g. Signed lease, valid until 2028"
          className="min-h-20"
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="file-tags" className="text-meta text-muted-foreground">
          Tags
        </label>
        <Input
          id="file-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="e.g. housing, contracts"
          aria-describedby="file-tags-hint"
          autoComplete="off"
        />
        <p id="file-tags-hint" className="text-caption text-muted-foreground">
          Separate with commas. Search finds files by tag.
        </p>
      </div>
      {error && <p className="text-caption rounded-lg bg-error-surface px-2 py-1.5 text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!dirty || saving}>
          Save changes
        </Button>
        <a href={rawHref(file.id, "download")} className={buttonVariants({ variant: "outline" })}>
          <Download />
          Download
        </a>
        <AlertDialog>
          <AlertDialogTrigger render={<Button type="button" variant="ghost" className="ml-auto text-destructive" />}>
            <Trash2 />
            Delete
          </AlertDialogTrigger>
          <AlertDialogContent className="glass glass-menu">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-card-title">Delete “{file.name}”?</AlertDialogTitle>
              <AlertDialogDescription>The file is removed from storage for good. This can&apos;t be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep file</AlertDialogCancel>
              <Button variant="destructive" onClick={remove} disabled={deleting}>
                Delete file
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </form>
  )
}
