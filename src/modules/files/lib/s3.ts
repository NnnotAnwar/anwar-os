import "server-only"
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { contentDisposition } from "./keys"

// S3-compatible object storage: Hetzner Object Storage in production, a local
// S3 server from compose.yaml in development. The client is created on first
// use, so builds and pages that never touch storage don't need it configured.

type Config = { bucket: string; client: S3Client }

let config: Config | null = null

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("File storage isn't configured. Set the S3_* variables (see .env.example).")
  }
}

export function storageConfigured() {
  const e = process.env
  return Boolean(e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY)
}

function storage(): Config {
  if (config) return config
  if (!storageConfigured()) throw new StorageNotConfiguredError()
  const e = process.env
  config = {
    bucket: e.S3_BUCKET!,
    client: new S3Client({
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION || "us-east-1",
      forcePathStyle: e.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
      // Hetzner and most S3-compatible servers don't support the newer default
      // CRC checksums on presigned uploads; only send them when required.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  }
  return config
}

export const UPLOAD_URL_TTL = 10 * 60
export const DOWNLOAD_URL_TTL = 60

/** A presigned PUT bound to the exact content type and length the server approved. */
export async function presignUpload(key: string, mime: string, size: number) {
  const { client, bucket } = storage()
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: size })
  // Signing content-type (not just hoisting it into the query) makes the server
  // reject a PUT with any other type; content-length is signed by default.
  return getSignedUrl(client, command, {
    expiresIn: UPLOAD_URL_TTL,
    signableHeaders: new Set(["content-type"]),
  })
}

/** A short-lived GET that names the file and decides inline vs attachment. */
export async function presignDownload(
  key: string,
  { name, mime, disposition }: { name: string; mime: string; disposition: "inline" | "attachment" },
) {
  const { client, bucket } = storage()
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: contentDisposition(name, disposition),
    ResponseContentType: mime,
    ResponseCacheControl: "private, max-age=60",
  })
  return getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL })
}

/** Size and type as stored, or null when there is no such object. */
export async function statObject(key: string): Promise<{ size: number; mime: string } | null> {
  const { client, bucket } = storage()
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { size: head.ContentLength ?? 0, mime: head.ContentType ?? "" }
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404 || status === 403) return null
    throw error
  }
}

/** Deletes objects in batches of 1000. Failures are logged: the rows are already gone. */
export async function removeObjects(keys: string[]) {
  if (!keys.length) return
  const { client, bucket } = storage()
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    try {
      const result = await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
      )
      if (result.Errors?.length) console.error("files: some objects were not deleted", result.Errors)
    } catch (error) {
      console.error("files: deleting objects failed; they are orphaned", batch, error)
    }
  }
}
