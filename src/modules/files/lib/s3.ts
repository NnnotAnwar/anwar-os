import "server-only"
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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

/**
 * A short-lived GET of any object, for a machine (the restore drill fetches
 * the newest encrypted backup with it). `bucket` defaults to S3_BUCKET.
 */
export async function presignGet(key: string, expiresIn: number, bucket?: string) {
  const { client, bucket: defaultBucket } = storage()
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket || defaultBucket, Key: key }), { expiresIn })
}

/** Writes an object the server made itself (e.g. a generated report), replacing any at `key`. */
export async function putObject(key: string, body: Uint8Array, mime: string) {
  const { client, bucket } = storage()
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mime, ContentLength: body.byteLength }))
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

/** Size and last change as stored, or null when there is no such object (the files storage check). */
export async function headObject(key: string): Promise<{ size: number; lastModified: Date | null } | null> {
  const { client, bucket } = storage()
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { size: head.ContentLength ?? 0, lastModified: head.LastModified ?? null }
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404) return null
    throw error
  }
}

/**
 * Every object in the bucket, 1000 per request (ListObjectsV2 pages). Unlike
 * removeObjects this throws: the storage check must not mistake a failed
 * listing for an empty bucket.
 */
export async function* listObjects(
  opts: { prefix?: string; bucket?: string } = {},
): AsyncGenerator<{ key: string; size: number; lastModified: Date | null }> {
  const { client, bucket: defaultBucket } = storage()
  const bucket = opts.bucket || defaultBucket
  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: opts.prefix, ContinuationToken: token, MaxKeys: 1000 }),
    )
    for (const o of page.Contents ?? []) {
      if (o.Key) yield { key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? null }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
}

/**
 * Deletes objects in batches of 1000. Failures are logged, never thrown: the
 * rows are already gone, so the delete the user asked for has happened. That
 * includes storage that has since been unconfigured (the objects are orphaned).
 */
export async function removeObjects(keys: string[]) {
  if (!keys.length) return
  if (!storageConfigured()) {
    console.error("files: storage isn't configured; these objects are orphaned", keys)
    return
  }
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
