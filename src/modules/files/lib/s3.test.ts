// Storage helpers without any S3 configured (the integration test covers a real server).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { presignUpload, removeObjects, StorageNotConfiguredError } = await import("./s3")

describe("object storage when S3 isn't configured", () => {
  beforeEach(() => {
    vi.stubEnv("S3_ENDPOINT", "")
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("refuses to presign, with a message the UI can show", async () => {
    await expect(presignUpload("owner/key", "text/plain", 1)).rejects.toBeInstanceOf(StorageNotConfiguredError)
  })

  it("doesn't fail a delete whose rows are already gone", async () => {
    await expect(removeObjects(["owner/a", "owner/b"])).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalledOnce()
  })
})
