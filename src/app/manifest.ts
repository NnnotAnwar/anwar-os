import type { MetadataRoute } from "next"

/**
 * Installable app ("Add to Home Screen" / "Install app"). Opens on Today; the
 * scope is the whole site so sign-in and public pages stay inside the app window.
 * Colours: the Planuj Glass light canvas for the splash screen; the in-app bar
 * follows light/dark through the viewport theme-color in the root layout.
 * Icons come from scripts/generate-icons.mts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "anwar.os",
    short_name: "anwar.os",
    description: "Anwar's personal operating system: notes, links, calendar, files and more.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f5f4f9",
    theme_color: "#f5f4f9",
    categories: ["productivity", "utilities", "lifestyle"],
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/monochrome.svg", sizes: "any", type: "image/svg+xml", purpose: "monochrome" },
    ],
    shortcuts: [
      { name: "Capture", short_name: "Capture", url: "/app/capture", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "New note", short_name: "Note", url: "/app/notes/new" },
      { name: "Calendar", url: "/app/calendar" },
      { name: "Feedback", url: "/app/feedback" },
    ],
    // Sharing a page or text to anwar.os opens the capture screen, prefilled.
    share_target: {
      action: "/app/capture",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
  }
}
