/**
 * The outbox in the browser: one store per tab that the capture forms, the
 * header's sync status and the "waiting to sync" rows read, plus the syncer.
 *
 * - Captures go online first, through the module's Server Action as before,
 *   with an id made here. Offline, or when that call doesn't get through (no
 *   connection, or a deploy changed the action's id), the capture goes to the
 *   outbox under the same id, so it can never land twice.
 * - The outbox is sent oldest first by syncOutbox() (./sync.ts) on app open,
 *   on `online`, when the app comes back to the foreground, after each new
 *   capture, on a back-off timer after server errors, and by the service
 *   worker's Background Sync where the browser has it (not iOS).
 * - One syncer at a time across tabs and the service worker: the Web Lock
 *   below. Tabs tell each other about changes over a BroadcastChannel.
 */
import { openOutbox, type Outbox, type OutboxItem, type OutboxKind } from "./outbox"
import { retryDelay, sendItem, syncOutbox, type SyncReport } from "./sync"

/** Shared with public/sw.js. */
export const SYNC_LOCK = "anwar-os-outbox-sync"
export const BACKGROUND_SYNC_TAG = "anwar-os-outbox"
const CHANNEL = "anwar-os-outbox"
/** Cached app pages (public/sw.js); dropped on sign-out. */
export const PAGES_CACHE_PREFIX = "anwar-os-pages-"

export type OutboxState = {
  /** The outbox has been read at least once. */
  ready: boolean
  /** IndexedDB isn't available (private mode on some browsers): captures need a connection. */
  unavailable: boolean
  userId: string | null
  /** Every item on this device, oldest first (all accounts; filter by userId). */
  items: OutboxItem[]
  syncing: boolean
  /** The last run stopped because the session is gone. */
  signedOut: boolean
  /** The last transient error, while items are still waiting. */
  lastError: string | null
}

const initial: OutboxState = { ready: false, unavailable: false, userId: null, items: [], syncing: false, signedOut: false, lastError: null }
let state = initial
const listeners = new Set<() => void>()

function set(patch: Partial<OutboxState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function subscribeOutbox(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
export const getOutboxState = () => state
export const getServerOutboxState = () => initial

/** The current user's items. */
export function itemsFor(s: OutboxState): OutboxItem[] {
  return s.userId ? s.items.filter((item) => item.userId === s.userId) : []
}

// ---------------------------------------------------------------------------
// Storage and cross-tab messages
// ---------------------------------------------------------------------------

let outboxPromise: Promise<Outbox | null> | null = null

function outbox(): Promise<Outbox | null> {
  if (!outboxPromise) {
    outboxPromise =
      typeof indexedDB === "undefined"
        ? Promise.resolve(null)
        : openOutbox().catch((error) => {
            console.warn("offline outbox unavailable", error)
            return null
          })
  }
  return outboxPromise
}

let channel: BroadcastChannel | null = null
type Message = { type: "changed" } | { type: "synced"; items: { id: string; value: unknown }[] }

function connect() {
  if (channel || typeof BroadcastChannel === "undefined") return
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<Message>) => {
    if (event.data?.type === "synced") for (const { id, value } of event.data.items) emitSynced(id, value)
    void reload()
  }
}

/** Re-reads the outbox (after this tab, another tab or the service worker changed it). */
export async function reload() {
  const box = await outbox()
  if (!box) return set({ ready: true, unavailable: true })
  try {
    set({ ready: true, items: await box.list() })
  } catch (error) {
    console.warn("couldn't read the outbox", error)
  }
}

function announce(message: Message = { type: "changed" }) {
  channel?.postMessage(message)
}

// ---------------------------------------------------------------------------
// Who is signed in
// ---------------------------------------------------------------------------

let resolveUser: (id: string) => void = () => {}
const userReady = new Promise<string>((resolve) => {
  resolveUser = resolve
})

/** The last signed-in user on this device, for a capture made before <OfflineSync> has run. */
const LAST_USER_KEY = "anwar-os:outbox-user"

/** Set once by <OfflineSync> in the app shell (it knows the session's user). */
export function setOutboxUser(userId: string) {
  connect()
  if (state.userId !== userId) set({ userId, signedOut: false })
  resolveUser(userId)
  try {
    localStorage.setItem(LAST_USER_KEY, userId)
  } catch {
    // Storage blocked: the shell sets the user on every load anyway.
  }
  void reload()
}

/**
 * The user a new capture belongs to. Normally known at once; on a slow (offline)
 * start, the last user who signed in here. The server checks it against the
 * session before saving anything, so a wrong guess can't file it under someone else.
 */
async function currentUser(waitMs = 1500): Promise<string | null> {
  if (state.userId) return state.userId
  const known = await Promise.race([userReady, new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs))])
  if (known) return known
  try {
    return localStorage.getItem(LAST_USER_KEY)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

type SyncedListener = (id: string, value: unknown) => void
const syncedListeners = new Set<SyncedListener>()

/** Called for every item sent successfully, from this tab or another one. */
export function onItemSynced(listener: SyncedListener) {
  syncedListeners.add(listener)
  return () => void syncedListeners.delete(listener)
}

function emitSynced(id: string, value: unknown) {
  for (const listener of syncedListeners) listener(id, value)
}

let running: Promise<SyncReport | null> | null = null
let failures = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

async function runSync(wait: boolean): Promise<SyncReport | null> {
  const userId = state.userId
  const box = await outbox()
  if (!userId || !box) return null

  const body = async (): Promise<SyncReport> => {
    set({ syncing: true })
    try {
      const report = await syncOutbox({ outbox: box, userId, send: (item) => sendItem(item) })
      if (report.synced.length) {
        for (const { item, value } of report.synced) emitSynced(item.id, value)
        announce({ type: "synced", items: report.synced.map(({ item, value }) => ({ id: item.id, value })) })
      }
      clearTimeout(retryTimer)
      if (report.stopped === "retry") {
        failures += 1
        // Offline: the `online` event brings us back. Online with a failing server: back off.
        if (navigator.onLine) retryTimer = setTimeout(() => void requestSync(), retryDelay(failures) * 1000)
      } else {
        failures = 0
      }
      set({ signedOut: report.stopped === "signed-out", lastError: report.stopped === "retry" ? report.error : null })
      return report
    } finally {
      set({ syncing: false })
      await reload()
      announce()
    }
  }

  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(SYNC_LOCK, { ifAvailable: !wait }, async (lock) => (lock ? body() : null))
  }
  // No Web Locks: one run per tab (the server's idempotency covers two tabs).
  if (running) {
    if (!wait) return running
    await running.catch(() => null)
  }
  running = body()
  try {
    return await running
  } finally {
    running = null
  }
}

/** Starts a sync unless one is already running somewhere (another tab, the service worker). */
export function requestSync(): Promise<SyncReport | null> {
  if (!itemsFor(state).some((item) => item.status === "pending")) return Promise.resolve(null)
  return runSync(false).catch((error) => {
    console.warn("outbox sync failed", error)
    return null
  })
}

/** Syncs now, waiting for a run elsewhere to finish first. */
export function syncNow(): Promise<SyncReport | null> {
  return runSync(true).catch((error) => {
    console.warn("outbox sync failed", error)
    return null
  })
}

async function registerBackgroundSync() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    const sync = (registration as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | undefined)?.sync
    await sync?.register(BACKGROUND_SYNC_TAG)
  } catch {
    // Not supported (iOS, Firefox) or not allowed: the app syncs when it's open.
  }
}

// ---------------------------------------------------------------------------
// Capturing
// ---------------------------------------------------------------------------

const NO_OUTBOX = "That wasn't saved, and this browser can't keep it offline. Copy the text and try again when you're online."

/** Puts a capture in the outbox. Throws OutboxQuotaError when the device is full. */
export async function queueCapture(kind: OutboxKind, payload: Record<string, unknown>, id: string = crypto.randomUUID()): Promise<OutboxItem> {
  const box = await outbox()
  if (!box) throw new Error(NO_OUTBOX)
  const userId = await currentUser()
  if (!userId) {
    console.warn("offline outbox: no signed-in user known yet")
    throw new Error(NO_OUTBOX)
  }
  const item = await box.add({ id, kind, payload, userId })
  await reload()
  announce()
  void registerBackgroundSync()
  // Ask the browser not to evict the outbox under storage pressure (best effort; iOS may ignore it).
  void navigator.storage?.persist?.().catch(() => false)
  return item
}

export type CaptureOutcome<T> =
  /** `value` is the action's result when this tab saved it; `id` is the new item's id either way. */
  | { status: "saved"; id: string; value: T | undefined }
  | { status: "queued"; item: OutboxItem }
  | { status: "error"; error: string }

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Saves a capture online through `save` (the module's Server Action, given
 * the id to use), or keeps it in the outbox when that can't happen now.
 * Items already waiting go first, so captures land in the order they were made.
 */
export async function captureOrQueue<T>({
  kind,
  payload,
  save,
}: {
  kind: OutboxKind
  payload: Record<string, unknown>
  save: (id: string) => Promise<ActionResult<T>>
}): Promise<CaptureOutcome<T>> {
  const id = crypto.randomUUID()
  const waiting = itemsFor(state).some((item) => item.status === "pending")

  if (navigator.onLine && !waiting) {
    try {
      const result = await save(id)
      return result.ok ? { status: "saved", id, value: result.value } : { status: "error", error: result.error }
    } catch {
      // Didn't get through: keep it on the device under the same id.
    }
  }

  let item: OutboxItem
  try {
    item = await queueCapture(kind, payload, id)
  } catch (error) {
    console.warn("offline outbox: couldn't keep the capture", error)
    return { status: "error", error: error instanceof Error && error.message ? error.message : NO_OUTBOX }
  }

  if (navigator.onLine) {
    const report = await syncNow()
    const sent = report?.synced.find((s) => s.item.id === id)
    if (sent) return { status: "saved", id, value: sent.value as T }
    const refused = report?.failed.find((f) => f.item.id === id)
    if (refused) {
      // The form is still open with the text in it: show the reason there instead.
      await discardItem(id)
      return { status: "error", error: refused.error }
    }
    if (!(await outbox().then((box) => box?.get(id)))) return { status: "saved", id, value: undefined }
  }
  return { status: "queued", item }
}

/** Replaces a waiting item's payload (a note still being typed). False when it was sent or failed already. */
export async function amendQueued(id: string, payload: Record<string, unknown>): Promise<boolean> {
  const box = await outbox()
  if (!box) return false
  const changed = await box.amend(id, payload)
  if (changed) {
    await reload()
    announce()
  }
  return changed
}

export async function discardItem(id: string) {
  const box = await outbox()
  if (!box) return
  await box.remove(id)
  await reload()
  announce()
}

export async function retryItem(id: string) {
  const box = await outbox()
  if (!box) return
  await box.retry(id)
  await reload()
  announce()
  await syncNow()
}

/** Restores a discarded item (Undo). */
export async function restoreItem(item: OutboxItem) {
  const box = await outbox()
  if (!box) return
  await box.add({ id: item.id, kind: item.kind, payload: item.payload, userId: item.userId, capturedAt: item.capturedAt })
  await reload()
  announce()
}

// ---------------------------------------------------------------------------
// Sign-out
// ---------------------------------------------------------------------------

/** Deletes the cached app pages (they show the signed-in user's data). */
export async function forgetCachedPages() {
  if (typeof caches === "undefined") return
  try {
    for (const key of await caches.keys()) if (key.startsWith(PAGES_CACHE_PREFIX)) await caches.delete(key)
  } catch {
    // Storage blocked: nothing was cached either.
  }
}

/** On sign-out: the outbox (every account's) and the cached pages leave this device. */
export async function clearOfflineData() {
  const box = await outbox()
  await box?.clear().catch(() => undefined)
  try {
    localStorage.removeItem(LAST_USER_KEY)
  } catch {
    // Nothing stored.
  }
  await forgetCachedPages()
  await reload()
  announce()
}
