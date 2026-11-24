/**
 * The offline outbox: captures made without a connection (Inbox, a task, a
 * note, a quick expense) wait here, in IndexedDB, until they are sent to
 * POST /api/sync/<kind> (src/core/offline-sync.ts). Browser-only, no React.
 *
 * Each item's `id` is a UUID made on the device. The server uses it as the new
 * row's primary key and returns the existing row when it sees the id again, so
 * sending an item twice (a lost response, two tabs, the service worker's
 * Background Sync) never creates two rows.
 *
 * public/sw.js reads and writes the same database for Background Sync, so the
 * names below and the item shape are shared with it; outbox.test.ts checks
 * that the worker still uses the same names.
 */

export const OUTBOX_DB = "anwar-os-offline"
export const OUTBOX_DB_VERSION = 1
export const OUTBOX_STORE = "outbox"

export const outboxKinds = ["inbox", "task", "note", "expense"] as const
export type OutboxKind = (typeof outboxKinds)[number]

export function isOutboxKind(value: unknown): value is OutboxKind {
  return outboxKinds.includes(value as OutboxKind)
}

export type OutboxItem = {
  /** Made on the device; becomes the row's id on the server (idempotency key). */
  id: string
  kind: OutboxKind
  payload: Record<string, unknown>
  /** Whose session made it: only that user's session ever sends it. */
  userId: string
  /** When it was captured (ISO instant); dates like "yesterday" count from this day. */
  capturedAt: string
  /** Capture order; items are sent oldest first. */
  seq: number
  /** pending: waiting to be sent. failed: the server refused it (see error); needs Retry or Discard. */
  status: "pending" | "failed"
  attempts: number
  error: string | null
  lastAttemptAt: string | null
}

export type NewOutboxItem = {
  id: string
  kind: OutboxKind
  payload: Record<string, unknown>
  userId: string
  capturedAt?: string
}

/** The device has no room left for the outbox (IndexedDB quota). */
export class OutboxQuotaError extends Error {
  constructor() {
    super("This device is out of storage, so it can't keep anything offline. Free up some space and try again.")
  }
}

export type Outbox = {
  add(item: NewOutboxItem): Promise<OutboxItem>
  /** Replaces a pending item's payload (a note still being typed). False when it is gone or failed. */
  amend(id: string, payload: Record<string, unknown>): Promise<boolean>
  get(id: string): Promise<OutboxItem | undefined>
  /** All items, oldest first; only `userId`'s when given. */
  list(userId?: string): Promise<OutboxItem[]>
  remove(id: string): Promise<void>
  /** The server refused it: keep it, with the reason, until Retry or Discard. */
  markFailed(id: string, error: string): Promise<void>
  /** A send that didn't get through (offline, server down): counts the attempt, stays pending. */
  noteAttempt(id: string, error: string): Promise<void>
  /** Failed → pending again. */
  retry(id: string): Promise<void>
  /** Removes every item, or only `userId`'s. */
  clear(userId?: string): Promise<void>
  close(): void
}

function isQuotaError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  )
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Runs `fn` in one transaction and resolves with its result once the transaction commits. */
function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(OUTBOX_STORE, mode)
    } catch (error) {
      reject(error)
      return
    }
    let result: T
    const fail = (error: unknown) => reject(isQuotaError(error) ? new OutboxQuotaError() : error)
    tx.oncomplete = () => resolve(result)
    tx.onerror = (event) => fail((event.target as IDBRequest | null)?.error ?? tx.error)
    tx.onabort = () => fail(tx.error ?? new Error("The outbox transaction was aborted."))
    let started: Promise<T> | T
    try {
      // Synchronously, while the transaction is active; later requests chain off request().
      started = fn(tx.objectStore(OUTBOX_STORE))
    } catch (error) {
      started = Promise.reject(error)
    }
    Promise.resolve(started).then(
        (value) => {
          result = value
        },
        (error) => {
          try {
            tx.abort()
          } catch {
            // Already finished.
          }
          fail(error)
        },
      )
  })
}

/** Opens (and on first use creates) the outbox database. */
export function openOutboxDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(OUTBOX_DB, OUTBOX_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" })
        store.createIndex("seq", "seq")
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab (or a new worker) upgrading the schema: step aside.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(isQuotaError(req.error) ? new OutboxQuotaError() : req.error)
    req.onblocked = () => reject(new Error("The offline storage is busy in another tab. Close it and try again."))
  })
}

let counter = 0
/** Capture order: milliseconds, then a counter for captures in the same millisecond. */
function nextSeq(now: number) {
  counter = (counter + 1) % 1000
  return now * 1000 + counter
}

export async function openOutbox(factory: IDBFactory = indexedDB): Promise<Outbox> {
  const db = await openOutboxDb(factory)

  async function update(id: string, change: (item: OutboxItem) => OutboxItem | null): Promise<boolean> {
    return transact(db, "readwrite", async (store) => {
      const item = await request<OutboxItem | undefined>(store.get(id))
      if (!item) return false
      const next = change(item)
      if (!next) return false
      await request(store.put(next))
      return true
    })
  }

  return {
    async add(input) {
      const now = Date.now()
      const item: OutboxItem = {
        id: input.id,
        kind: input.kind,
        payload: input.payload,
        userId: input.userId,
        capturedAt: input.capturedAt ?? new Date(now).toISOString(),
        seq: nextSeq(now),
        status: "pending",
        attempts: 0,
        error: null,
        lastAttemptAt: null,
      }
      await transact(db, "readwrite", (store) => request(store.add(item)))
      return item
    },

    amend(id, payload) {
      return update(id, (item) => (item.status === "pending" ? { ...item, payload } : null))
    },

    get(id) {
      return transact(db, "readonly", (store) => request<OutboxItem | undefined>(store.get(id)))
    },

    async list(userId) {
      const items = await transact(db, "readonly", (store) => request<OutboxItem[]>(store.index("seq").getAll()))
      return userId === undefined ? items : items.filter((item) => item.userId === userId)
    },

    async remove(id) {
      await transact(db, "readwrite", (store) => request(store.delete(id)))
    },

    async markFailed(id, error) {
      const at = new Date().toISOString()
      await update(id, (item) => ({ ...item, status: "failed", error, attempts: item.attempts + 1, lastAttemptAt: at }))
    },

    async noteAttempt(id, error) {
      const at = new Date().toISOString()
      await update(id, (item) => ({ ...item, error, attempts: item.attempts + 1, lastAttemptAt: at }))
    },

    async retry(id) {
      await update(id, (item) => ({ ...item, status: "pending", error: null }))
    },

    async clear(userId) {
      await transact(db, "readwrite", async (store) => {
        if (userId === undefined) {
          await request(store.clear())
          return
        }
        const items = await request<OutboxItem[]>(store.getAll())
        for (const item of items) if (item.userId === userId) await request(store.delete(item.id))
      })
    },

    close() {
      db.close()
    },
  }
}
