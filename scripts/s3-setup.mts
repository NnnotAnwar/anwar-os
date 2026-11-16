/**
 * Prepares the bucket for the files module: creates it if missing and sets the
 * CORS rule browsers need for presigned uploads (PUT straight from the page)
 * and previews. Safe to run again. Works against Hetzner Object Storage and the
 * local S3 server from compose.yaml.
 *
 *   pnpm s3:setup                       # origin from BETTER_AUTH_URL
 *   S3_CORS_ORIGINS=https://a,https://b pnpm s3:setup
 *
 * Env (loaded from .env.local): S3_ENDPOINT, S3_REGION, S3_BUCKET,
 * S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE.
 */
import {
  CreateBucketCommand,
  GetBucketCorsCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3"

const e = process.env
for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
  if (!e[name]) throw new Error(`Set ${name} (see .env.example).`)
}
const origins = (e.S3_CORS_ORIGINS ?? e.BETTER_AUTH_URL ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean)
if (!origins.length) throw new Error("Set S3_CORS_ORIGINS or BETTER_AUTH_URL to the app's origin.")

const bucket = e.S3_BUCKET!
const client = new S3Client({
  endpoint: e.S3_ENDPOINT,
  region: e.S3_REGION || "us-east-1",
  forcePathStyle: e.S3_FORCE_PATH_STYLE === "true",
  credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
})

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
  console.log(`Bucket exists: ${bucket}`)
} catch {
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
  console.log(`Bucket created: ${bucket}`)
}

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ["PUT", "GET", "HEAD"],
          AllowedHeaders: ["content-type"],
          ExposeHeaders: ["etag"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
)
const cors = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
console.log(`CORS set for ${cors.CORSRules?.[0]?.AllowedOrigins?.join(", ")}`)
