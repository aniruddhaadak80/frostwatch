import type { AuditEvent, FrostSheet } from './types'

/**
 * The repository interface. Every route, the agent tool and the tests all talk to this and
 * nothing else, so the SQLite and Postgres adapters are genuinely interchangeable.
 */
export interface Store {
  readonly kind: 'sqlite' | 'neon'
  init(): Promise<void>
  listBlocks(): Promise<import('./types').Block[]>
  listSheets(ownerId: string, options?: { includeDeleted?: boolean }): Promise<FrostSheet[]>
  getSheet(id: string, ownerId: string): Promise<FrostSheet | null>
  createSheet(input: {
    ownerId: string
    blockId: string
    nightOf: string
    notes: string
    actor: string
    at: string
  }): Promise<FrostSheet>
  updateSheet(
    id: string,
    ownerId: string,
    patch: { notes?: string; status?: FrostSheet['status']; at: string; actor: string },
  ): Promise<FrostSheet>
  deleteSheet(id: string, ownerId: string, at: string, actor: string): Promise<FrostSheet>
  eventsFor(sheetId: string): Promise<AuditEvent[]>
}

/** Stable error codes so the UI, the API and the agent surface agree on what went wrong. */
export class StoreError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'StoreError'
    this.code = code
    this.status = status
  }
}

/**
 * Adapter selection.
 *
 * Production must never silently fall back to the embedded database, so the choice is
 * explicit and loud: a Vercel production build without DATABASE_URL throws rather than
 * quietly writing into a read-only or ephemeral filesystem.
 *
 * Takes the narrow shape it actually reads rather than the whole ProcessEnv, so it is
 * trivially testable without casting.
 */
export function adapterName(
  env: Readonly<Record<string, string | undefined>> = process.env,
): 'sqlite' | 'neon' {
  const url = env.DATABASE_URL ?? env.POSTGRES_URL ?? env.NEON_DATABASE_URL
  if (typeof url === 'string' && url.length > 0) return 'neon'
  if (env.VERCEL === '1' || env.VERCEL_ENV === 'production') {
    throw new StoreError(
      'STORE_UNAVAILABLE',
      'DATABASE_URL is required in production. Refusing to fall back to an ephemeral store.',
      500,
    )
  }
  return 'sqlite'
}

let cached: Promise<Store> | null = null

export async function getStore(): Promise<Store> {
  cached ??= (async () => {
    const name = adapterName()
    if (name === 'neon') {
      const mod = await import('./store-neon')
      const store: Store = new mod.NeonStore()
      await store.init()
      return store
    }
    const mod = await import('./store-sqlite')
    const store: Store = new mod.SqliteStore()
    await store.init()
    return store
  })()
  return cached
}
