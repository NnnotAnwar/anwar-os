import {
  FileCsv,
  FileDoc,
  FileIcon,
  FileImage,
  FileMd,
  FilePdf,
  FilePpt,
  FileText,
  FileTxt,
  FileXls,
  FileZip,
  Folder,
  type AppIcon,
} from "@/components/icons"
import { cn } from "@/lib/utils"

const ICONS = {
  folder: Folder,
  document: FileText,
  pdf: FilePdf,
  image: FileImage,
  md: FileMd,
  csv: FileCsv,
  txt: FileTxt,
  zip: FileZip,
  xls: FileXls,
  ppt: FilePpt,
  doc: FileDoc,
  file: FileIcon,
} satisfies Record<string, AppIcon>

/** Which icon a folder, a markdown document, or a file (by MIME type) gets. */
export function iconKey(item: { kind: "folder" | "file" | "document"; mime?: string }): keyof typeof ICONS {
  if (item.kind !== "file") return item.kind
  const mime = item.mime ?? ""
  if (mime === "application/pdf") return "pdf"
  if (mime.startsWith("image/")) return "image"
  if (mime === "text/markdown") return "md"
  if (mime === "text/csv") return "csv"
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/rtf") return "txt"
  if (/zip|rar|tar|gzip|7z/.test(mime)) return "zip"
  if (/spreadsheet|excel|numbers/.test(mime)) return "xls"
  if (/presentation|powerpoint|keynote/.test(mime)) return "ppt"
  if (/word|opendocument\.text|pages|epub/.test(mime)) return "doc"
  return "file"
}

/** A small tinted tile holding the item's icon. */
export function ItemIcon({
  item,
  className,
}: {
  item: { kind: "folder" | "file" | "document"; mime?: string }
  className?: string
}) {
  const Icon = ICONS[iconKey(item)]
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        item.kind === "folder" ? "bg-secondary text-text-accent" : "bg-muted text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      <Icon className="size-4" />
    </span>
  )
}
