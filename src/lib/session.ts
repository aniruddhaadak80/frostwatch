import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'

/**
 * Anonymous ownership.
 *
 * There are no accounts. Each browser gets an unguessable owner id in an HTTP-only cookie,
 * and every query is scoped by it, so knowing somebody else's sheet id grants nothing.
 *
 * The cookie is issued by `src/proxy.ts`, which runs before rendering. That matters: a Server
 * Component is not allowed to set cookies, so a page that called `cookies().set()` during
 * render would throw. Pages therefore only ever read.
 */

const COOKIE = 'fw_owner'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export const OWNER_COOKIE = COOKIE

export function newOwnerId(): string {
  return `own_${randomBytes(16).toString('hex')}`
}

const SAFE = /^own_[a-f0-9]{32}$/

/** Only accepts ids this app could have issued, so a tampered cookie never reaches a query. */
export function isValidOwnerId(value: unknown): value is string {
  return typeof value === 'string' && SAFE.test(value)
}

/**
 * Read-only, and safe to call from a Server Component. If the cookie is somehow absent, a
 * fresh id is returned for this render only: it scopes nothing, so the page shows the empty
 * state rather than somebody else's rows, and the proxy issues a real cookie on the next hit.
 */
export async function getOwnerId(): Promise<string> {
  const jar = await cookies()
  const existing = jar.get(COOKIE)?.value
  return isValidOwnerId(existing) ? existing : newOwnerId()
}

export const OWNER_COOKIE_MAX_AGE = MAX_AGE_SECONDS
