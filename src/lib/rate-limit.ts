import { sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

/**
 * Attempt limits stored in Postgres (auth.rate_limit), so they survive the
 * restart every deploy does and hold across processes.
 *
 * Used twice:
 * - as Better Auth's rate-limit storage, for /api/auth/* (passkey and Google
 *   flows, and any direct call to the HTTP sign-in endpoints);
 * - by the sign-in and 2FA server actions (src/core/auth-actions.ts), which call
 *   auth.api.* directly and so never pass through Better Auth's HTTP limiter.
 *
 * Fixed windows: the first attempt opens a window of `window` seconds, every
 * attempt in it counts, and once `max` is exceeded the rest of the window is
 * refused. One statement does the check and the increment, so concurrent
 * attempts can't all slip past a stale read.
 */

export type RateRule = { window: number; max: number }
export type RateDecision = { allowed: boolean; retryAfter: number | null }

type Db = Pick<PostgresJsDatabase<Record<string, unknown>>, "execute">

/** Rows older than this are deleted now and then; no window is longer. */
const KEEP_ROWS_SECONDS = 24 * 60 * 60

export async function consumeRateLimit(db: Db, key: string, rule: RateRule): Promise<RateDecision> {
  const window = Math.max(1, Math.ceil(rule.window))
  const rows = await db.execute<{ count: number; retry_after: number }>(sql`
    insert into auth.rate_limit as r (key, count, window_start)
    values (${key}, 1, now())
    on conflict (key) do update set
      count = case when r.window_start <= now() - make_interval(secs => ${window}) then 1 else r.count + 1 end,
      window_start = case when r.window_start <= now() - make_interval(secs => ${window}) then now() else r.window_start end
    returning
      count,
      ceil(extract(epoch from (window_start + make_interval(secs => ${window}) - now())))::int as retry_after
  `)
  const row = rows[0]!
  if (Math.random() < 0.01) await pruneRateLimits(db)
  return row.count <= rule.max ? { allowed: true, retryAfter: null } : { allowed: false, retryAfter: Math.max(1, row.retry_after) }
}

export async function pruneRateLimits(db: Db) {
  await db.execute(sql`delete from auth.rate_limit where window_start < now() - make_interval(secs => ${KEEP_ROWS_SECONDS})`)
}

/** Better Auth `rateLimit.customStorage`: its rules, our table. */
export function postgresRateLimitStorage(db: Db) {
  return { consume: (key: string, rule: RateRule) => consumeRateLimit(db, `auth-api:${key}`, rule) }
}

/** Limits for the server actions, per client IP and per account. */
export const SIGN_IN_LIMITS = {
  ip: { window: 15 * 60, max: 10 },
  account: { window: 15 * 60, max: 20 },
  mfa: { window: 15 * 60, max: 10 },
} as const satisfies Record<string, RateRule>

/**
 * The client address as the edge proxy reported it. Caddy replaces any
 * X-Forwarded-For a client sends with the address it saw (it trusts no
 * upstream proxies), and Next only fills the header in when it's missing (the
 * socket address, in local runs). Taking the last entry stays correct even if
 * a proxy in front starts appending. Note: IPv6 visitors currently arrive via
 * Docker's userland proxy and share one address (docs/DEPLOY.md, Day-2 notes).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown"
}

export function retryMessage(seconds: number | null) {
  const minutes = Math.max(1, Math.ceil((seconds ?? 60) / 60))
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
}
