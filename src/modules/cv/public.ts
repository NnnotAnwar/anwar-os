import "server-only"
import { cacheLife, cacheTag } from "next/cache"
import { asPublic } from "@/db"
import { readCv } from "./actions"
import { PUBLIC_CV_TAG, type Cv } from "./schema"

/**
 * The CV as visitors see it, or null while it's unpublished. RLS does the
 * filtering (published profile, visible entries, site owner only); this just
 * caches the result until the owner edits something (tag PUBLIC_CV_TAG).
 * Render after `await connection()` inside <Suspense>: no database at build.
 */
export async function getPublicCv(): Promise<Cv | null> {
  "use cache"
  cacheTag(PUBLIC_CV_TAG)
  cacheLife("days")
  const cv = await asPublic((tx) => readCv(tx, "site owner"))
  return cv.profile ? cv : null
}
