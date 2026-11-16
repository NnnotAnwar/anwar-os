/** Only paths inside the private zone are allowed as post-sign-in targets (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/app(\/[\w\-/]*)?$/.test(next) ? next : "/app"
}
