// Uploading a scan from the browser: a presigned PUT straight to object
// storage (with progress), then the server records it in Files → Documents.
// Shared by the attachments list and the document scanner.
import { checkUpload } from "@/modules/files/lib/validation"
import type { AttachedFile } from "../schema"
import { confirmScanUpload, prepareScanUpload } from "../server-actions"

/** PUT straight to object storage with progress (fetch has no upload progress). */
function put(url: string, file: File, mime: string, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", mime)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the upload (${xhr.status}).`)))
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."))
    xhr.send(file)
  })
}

/** Uploads one file into Files → Documents; throws an Error with a message people can read. */
export async function uploadScan(file: File, onProgress: (loaded: number) => void = () => {}): Promise<AttachedFile> {
  const check = checkUpload(file)
  if (!check.ok) throw new Error(check.error)
  const prepared = await prepareScanUpload({ name: file.name, size: file.size, type: file.type })
  if (!prepared.ok) throw new Error(prepared.error)
  await put(prepared.value.url, file, prepared.value.mime, onProgress)
  const confirmed = await confirmScanUpload({ key: prepared.value.key, name: file.name, folderId: prepared.value.folderId })
  if (!confirmed.ok) throw new Error(confirmed.error)
  return confirmed.value
}
