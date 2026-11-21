import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted in Docker: emit .next/standalone (server.js + traced deps only).
  // See Dockerfile and docs/DEPLOY.md.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Static PWA files skip src/proxy.ts (no nonce needed), so their headers live
  // here. Page CSP: src/proxy.ts. Edge headers (HSTS, X-Frame-Options, ...):
  // infra/Caddyfile. Overview: docs/DEPLOY.md, "Security headers".
  async headers() {
    return [
      {
        // Always revalidate the worker so a deploy's new version is picked up.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: "/offline.html",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          },
        ],
      },
    ]
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
