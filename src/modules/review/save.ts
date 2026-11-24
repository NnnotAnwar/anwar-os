import "server-only"
import { randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { asViewer, requireViewer } from "@/core/auth"
import { filesFiles, filesFolders } from "@/db/schema"
import { buildStorageKey } from "@/modules/files/lib/keys"
import { putObject, removeObjects, storageConfigured } from "@/modules/files/lib/s3"
import { renderReportPdf } from "./lib/pdf"
import { REPORTS_FOLDER, reportFileName, type MonthlyReport, type SavedReport } from "./schema"

// Saves a month's report as a PDF in Files → Reports (top level, created on
// first use). One file per month: saving again replaces its contents in place,
// so osbot's card on the 1st and a later "Save to Files" never make copies.

const PDF = "application/pdf"

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

async function reportsFolder(): Promise<string> {
  return asViewer(async (tx) => {
    const top = and(isNull(filesFolders.parentId), eq(filesFolders.name, REPORTS_FOLDER))
    const [found] = await tx.select({ id: filesFolders.id }).from(filesFolders).where(top)
    if (found) return found.id
    // Sibling names are unique (nulls not distinct): a concurrent save just finds it.
    await tx.insert(filesFolders).values({ name: REPORTS_FOLDER, parentId: null }).onConflictDoNothing()
    const [made] = await tx.select({ id: filesFolders.id }).from(filesFolders).where(top)
    return made!.id
  })
}

export async function saveReportPdf(report: MonthlyReport, now = new Date()): Promise<SavedReport> {
  const name = reportFileName(report.month)
  if (!storageConfigured()) return { saved: false, fileId: null, name, url: report.pdfUrl }

  const viewer = await requireViewer()
  const bytes = await renderReportPdf(report, now)
  const folderId = await reportsFolder()
  const [existing] = await asViewer((tx) =>
    tx
      .select({ id: filesFiles.id, key: filesFiles.storageKey })
      .from(filesFiles)
      .where(and(eq(filesFiles.folderId, folderId), eq(filesFiles.name, name)))
      .limit(1),
  )

  const key = existing?.key ?? buildStorageKey(viewer.id, randomUUID())
  await putObject(key, bytes, PDF)

  let id = existing?.id
  if (existing) {
    await asViewer((tx) => tx.update(filesFiles).set({ sizeBytes: bytes.byteLength, mime: PDF }).where(eq(filesFiles.id, existing.id)))
  } else {
    try {
      const [row] = await asViewer((tx) =>
        tx
          .insert(filesFiles)
          .values({
            name,
            sizeBytes: bytes.byteLength,
            mime: PDF,
            storageKey: key,
            folderId,
            tags: ["report"],
            description: `Monthly report for ${report.label}, made by anwar.os.`,
          })
          .returning({ id: filesFiles.id }),
      )
      id = row!.id
    } catch (error) {
      await removeObjects([key])
      throw error
    }
  }
  return { saved: true, fileId: id!, name, url: `${baseUrl()}/app/files/file/${id}` }
}
