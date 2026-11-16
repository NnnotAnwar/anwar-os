// Runs against a real S3-compatible server when S3_* is set (e.g. via
// `node --env-file=.env.local node_modules/vitest/vitest.mjs run s3`); skipped
// otherwise, so `pnpm test` never needs storage.
import { randomUUID } from "node:crypto"
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3"
import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const configured = Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID)

describe.skipIf(!configured)("object storage (S3)", async () => {
  const { presignDownload, presignUpload, removeObjects, statObject } = await import("./s3")
  const key = `test-owner/${randomUUID()}`
  const body = new TextEncoder().encode("hello knowledge base")

  beforeAll(async () => {
    const client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
    })
    try {
      await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }))
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }))
    }
  })

  it("uploads through a presigned PUT and reports size and type", async () => {
    const url = await presignUpload(key, "text/plain", body.length)
    const res = await fetch(url, { method: "PUT", body, headers: { "Content-Type": "text/plain" } })
    expect(res.status).toBe(200)
    expect(await statObject(key)).toEqual({ size: body.length, mime: "text/plain" })
  })

  it("rejects an upload whose type differs from the signed one", async () => {
    const other = `test-owner/${randomUUID()}`
    const url = await presignUpload(other, "application/pdf", body.length)
    const res = await fetch(url, { method: "PUT", body, headers: { "Content-Type": "text/html" } })
    expect(res.ok).toBe(false)
    expect(await statObject(other)).toBeNull()
  })

  it("rejects an upload larger than the signed length", async () => {
    const other = `test-owner/${randomUUID()}`
    const url = await presignUpload(other, "text/plain", 4)
    const res = await fetch(url, { method: "PUT", body, headers: { "Content-Type": "text/plain" } })
    expect(res.ok).toBe(false)
  })

  it("serves a presigned GET with the stored name", async () => {
    const url = await presignDownload(key, { name: "Poznámky.txt", mime: "text/plain", disposition: "attachment" })
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("hello knowledge base")
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''Pozn%C3%A1mky.txt")
  })

  it("deletes objects and reports missing ones as null", async () => {
    await removeObjects([key])
    expect(await statObject(key)).toBeNull()
  })
})
