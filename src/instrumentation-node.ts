// Node-only half of src/instrumentation.ts: unhandled rejections and uncaught
// exceptions outside a request, into the error log. Imported only when
// NEXT_RUNTIME is "nodejs".

export function listenForProcessErrors(record: (error: unknown) => Promise<void>) {
  const g = globalThis as typeof globalThis & { __aosErrorLogListeners?: boolean }
  // Dev reloads re-run register(); listen once per process.
  if (g.__aosErrorLogListeners) return
  g.__aosErrorLogListeners = true
  process.on("unhandledRejection", (reason) => void record(reason))
  process.on("uncaughtExceptionMonitor", (error) => void record(error))
}
