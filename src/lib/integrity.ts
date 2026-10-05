import { createHash } from 'node:crypto'

/**
 * Per-sheet audit chain.
 *
 * seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
 *
 * Canonical JSON sorts object keys recursively so that the same event always serialises to
 * the same bytes. Without that, adding a field to an object could change the hash for
 * reasons that have nothing to do with the event's meaning, and the chain would be
 * unreplayable across versions.
 *
 * Deletes are tombstones, not row removals: the chain has to stay replayable after someone
 * retires a sheet, which is exactly when somebody might want to check the history.
 */

/** Genesis value: 96 hex characters, the width of a SHA-384 digest. */
export const GENESIS_SEAL = '0'.repeat(96)

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

function canonicalise(value: unknown): Json {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonicalJson: non-finite numbers cannot be canonicalised')
    }
    // -0 and 0 must hash identically or replay breaks on an arithmetic accident.
    return value === 0 ? 0 : value
  }
  if (typeof value === 'boolean' || typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(canonicalise)
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: { [key: string]: Json } = {}
    // Sorting by code unit, not locale, so the order cannot depend on the host locale.
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      out[key] = canonicalise(source[key])
    }
    return out
  }
  throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value))
}

export function sha384Hex(input: string): string {
  return createHash('sha384').update(input, 'utf8').digest('hex')
}

export interface ChainLink {
  readonly seq: number
  readonly sheetId: string
  readonly kind: 'create' | 'update' | 'decision' | 'delete'
  readonly at: string
  readonly actor: string
  readonly payload: Record<string, unknown>
  readonly prevSeal: string
  readonly seal: string
}

/** The event body that gets hashed. Deliberately excludes prevSeal, which is prepended raw. */
function eventBody(link: Omit<ChainLink, 'prevSeal' | 'seal'>): string {
  return canonicalJson({
    seq: link.seq,
    sheetId: link.sheetId,
    kind: link.kind,
    at: link.at,
    actor: link.actor,
    payload: link.payload,
  })
}

export function computeSeal(prevSeal: string, link: Omit<ChainLink, 'prevSeal' | 'seal'>): string {
  return sha384Hex(`${prevSeal}${eventBody(link)}`)
}

/** Append one event to a chain and return the stored link. */
export function appendEvent(
  existing: readonly ChainLink[],
  next: Omit<ChainLink, 'seq' | 'prevSeal' | 'seal'>,
): ChainLink {
  const previous = existing[existing.length - 1]
  const prevSeal = previous?.seal ?? GENESIS_SEAL
  const seq = previous === undefined ? 1 : previous.seq + 1
  const body: Omit<ChainLink, 'prevSeal' | 'seal'> = { ...next, seq }
  return { ...body, prevSeal, seal: computeSeal(prevSeal, body) }
}

export interface ReplayResult {
  readonly ok: boolean
  readonly length: number
  readonly headSeal: string
  readonly brokenAtSeq: number | null
  readonly reason: string | null
}

/** Re-derive every seal and report the first link that does not match. */
export function replayChain(events: readonly ChainLink[]): ReplayResult {
  let prevSeal = GENESIS_SEAL
  let expectedSeq = 1

  for (const event of events) {
    if (event.seq !== expectedSeq) {
      return {
        ok: false,
        length: events.length,
        headSeal: prevSeal,
        brokenAtSeq: event.seq,
        reason: `expected sequence ${expectedSeq}, found ${event.seq}`,
      }
    }
    if (event.prevSeal !== prevSeal) {
      return {
        ok: false,
        length: events.length,
        headSeal: prevSeal,
        brokenAtSeq: event.seq,
        reason: 'prevSeal does not match the preceding seal',
      }
    }
    // `seal` and `prevSeal` are excluded: the seal is what we are verifying, and prevSeal was
    // already checked above against the running chain head.
    const body: Omit<ChainLink, 'prevSeal' | 'seal'> = {
      seq: event.seq,
      sheetId: event.sheetId,
      kind: event.kind,
      at: event.at,
      actor: event.actor,
      payload: event.payload,
    }
    const recomputed = computeSeal(prevSeal, body)
    if (recomputed !== event.seal) {
      return {
        ok: false,
        length: events.length,
        headSeal: prevSeal,
        brokenAtSeq: event.seq,
        reason: 'seal does not match the recomputed digest',
      }
    }
    prevSeal = event.seal
    expectedSeq += 1
  }

  return {
    ok: true,
    length: events.length,
    headSeal: prevSeal,
    brokenAtSeq: null,
    reason: null,
  }
}
