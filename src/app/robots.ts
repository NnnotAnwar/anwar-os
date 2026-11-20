import type { MetadataRoute } from "next"
import { absoluteUrl } from "@/lib/site"

/** Everything public is crawlable; the private app, sign-in and the API are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/login", "/api"] },
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}
