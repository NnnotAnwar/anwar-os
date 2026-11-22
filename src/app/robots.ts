import type { MetadataRoute } from "next"
import { connection } from "next/server"
import { absoluteUrl } from "@/lib/site"

/**
 * Everything public is crawlable; the private app, sign-in and the API are not.
 * Request time, like the sitemap: prerendered at build it pointed crawlers at
 * the build's placeholder origin (http://localhost:3000/sitemap.xml).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection()
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/login", "/api"] },
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}
