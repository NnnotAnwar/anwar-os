import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // Only routes that touch the session. Public pages stay fully static.
  matcher: ["/app/:path*", "/login/:path*", "/auth/:path*"],
}
