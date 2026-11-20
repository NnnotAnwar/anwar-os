import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { headers } from "next/headers"
import { ThemeProvider } from "next-themes"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"

// Inter carries the UI and every number (tabular figures). Satoshi, the display
// face, comes from Fontshare as in Planuj Směny; Inter is its fallback.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "cyrillic"],
})

export const metadata: Metadata = {
  title: { default: "Anwar", template: "%s · Anwar" },
  description: "Anwar's projects, writing and tools.",
  applicationName: "anwar.os",
  // Added to the home screen from Safari: full screen, our own title and icon
  // (src/app/apple-icon.png). The manifest (src/app/manifest.ts) covers the rest.
  appleWebApp: { capable: true, title: "anwar.os", statusBarStyle: "default" },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f9" },
    { media: "(prefers-color-scheme: dark)", color: "#121022" },
  ],
}

/**
 * Every page renders per request, on purpose. The CSP (src/proxy.ts) only lets
 * scripts carrying this request's nonce run, and a prerendered static shell (PPR)
 * is built without one, so its bootstrap scripts would be blocked. Reading the
 * nonce here makes the whole document dynamic and Next stamps the nonce on every
 * script. Suspense boundaries below still stream; `use cache` data stays cached.
 * `instant = false` tells Cache Components this blocking read is intended.
 */
export const instant = false

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@500,700&display=swap" />
      </head>
      <body className="flex min-h-full flex-col text-foreground">
        <ThemeProvider nonce={nonce} attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-center" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
