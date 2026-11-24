import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { cookies, headers } from "next/headers"
import { ThemeProvider } from "@/components/theme/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { decodeThemeCookie, THEME_COLORS, THEME_COOKIE, themeScript } from "@/lib/theme"
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
  width: "device-width",
  initialScale: 1,
  // Draw edge to edge on notched iPhones. Without it iOS reports every
  // env(safe-area-inset-*) as 0, so in the home-screen app the phone tab bar sat
  // under the home indicator. Fixed bars, sheets and toasts pad themselves with
  // the insets; the body keeps content clear of the notch in landscape.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
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
  // The signed-in user's appearance (src/lib/theme.ts); visitors have none: system.
  const theme = decodeThemeCookie((await cookies()).get(THEME_COOKIE)?.value)
  // A fixed choice is right in the HTML itself; system and scheduled need the
  // browser (its preference, its clock), so the script below sets them before paint.
  const fixed = theme?.mode === "dark" || theme?.mode === "light" ? theme.mode : undefined
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased ${fixed ?? ""}`}
      style={fixed ? { colorScheme: fixed } : undefined}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@500,700&display=swap" />
      </head>
      <body className="flex min-h-full flex-col text-foreground">
        <ThemeProvider initial={theme}>
          <TooltipProvider>
            {children}
            {/* Above the home indicator, and above the phone tab bar in the app (--toast-bottom, globals.css). */}
            <Toaster
              position="bottom-center"
              offset={{ bottom: "var(--toast-bottom)" }}
              mobileOffset={{ bottom: "var(--toast-bottom)" }}
            />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
