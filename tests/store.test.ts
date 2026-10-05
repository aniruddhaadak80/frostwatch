import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replayChain } from '../src/lib/integrity'
import { SqliteStore } from '../src/lib/store-sqlite'
import { adapterName, StoreError } from '../src/lib/store'

const OWNER = 'own_0123456789abcdef0123456789abcdef'
const OTHER = 'own_ffffffffffffffffffffffffffffffff'

let dir: string
let store: SqliteStore

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'frostwatch-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  store = new SqliteStore()
  await store.init()
})

afterEach(async () => {
  store.db.close()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.SQLITE_PATH
})

describe('adapter selection', () => {
  it('uses sqlite locally with no env at all', () => {
    expect(adapterName({})).toBe('sqlite')
  })

  it('uses neon when a database url is present', () => {
    expect(adapterName({ DATABASE_URL: 'postgres://x' })).toBe('neon')
    expect(adapterName({ POSTGRES_URL: 'postgres://x' })).toBe('neon')
  })

  it('refuses to fall back to sqlite in production', () => {
    // The whole point: a silent ephemeral fallback in production is a data-loss bug.
    expect(() => adapterName({ VERCEL: '1' })).toThrow(StoreError)
    expect(() => adapterName({ VERCEL_ENV: 'production' })).toThrow(
      /DATABASE_URL is required in production/,
    )
  })
})

describe('SqliteStore', () => {
  it('seeds blocks idempotently', async () => {
    const first = await store.listBlocks()
    await store.init()
    const second = await store.listBlocks()
    expect(first.length).toBe(6)
    expect(second.length).toBe(6)
  })

  it('seeds real coordinates', async () => {
    const blocks = await store.listBlocks()
    for (const block of blocks) {
      expect(Math.abs(block.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(block.lon)).toBeLessThanOrEqual(180)
    }
  })

  it('creates a sheet with a sealed genesis chain', async () => {
    const sheet = await store.createSheet({
      ownerId: OWNER,
      blockId: 'blk-yakima',
      nightOf: '2026-01-15',
      notes: 'first',
      actor: 'grower',
      at: '2026-01-15T09:00:00.000Z',
    })
    expect(sheet.status).toBe('watching')
    expect(sheet.eventCount).toBe(1)
    expect(sheet.seal).toHaveLength(96)

    const replay = replayChain(await store.eventsFor(sheet.id))
    expect(replay.ok).toBe(true)
    expect(replay.headSeal).toBe(sheet.seal)
  })

  it('rejects a duplicate block and night with 409', async () => {
    await store.createSheet({
      ownerId: OWNER,
      blockId: 'blk-yakima',
      nightOf: '2026-01-15',
      notes: '',
      actor: 'grower',
      at: '2026-01-15T09:00:00.000Z',
    })
    await expect(
      store.createSheet({
        ownerId: OWNER,
        blockId: 'blk-yakima',
        nightOf: '2026-01-15',
        notes: '',
        actor: 'grower',
        at: '2026-01-15T10:00:00.000Z',
      }),
    ).rejects.toThrow(/already exists/)
  })

  it('allows the same block and night for a different owner', async () => {
    await store.createSheet({
      ownerId: OWNER,
      blockId: 'blk-yakima',
      nightOf: '2026-01-16',
      notes: '',
      actor: 'grower',
      at: '2026-01-16T09:00:00.000Z',
    })
    const other = await store.createSheet({
      ownerId: OTHER,
      blockId: 'blk-yakima',
      nightOf: '2026-01-16',
      notes: '',
      actor: 'grower',
      at: '2026-01-16T09:00:00.000Z',
    })
    expect(other.ownerId).toBe(OTHER)
  })

  it('never exposes another owner’s sheet', async () => {
    const sheet = await store.createSheet({
      ownerId: OWNER,
      blockId: 'blk-yakima',
      nightOf: '2026-01-17',
      notes: '',
      actor: 'grower',
      at: '2026-01-17T09:00:00.000Z',
    })
    expect(await store.getSheet(sheet.id, OTHER)).toBeNull()
    await expect(
      store.updateSheet(sheet.id, OTHER, { status: 'protected', at: 'x', actor: 'attacker' }),
    ).rejects.toThrow(/no sheet/)
    expect(await store.listSheets(OTHER)).toHaveLength(0)
  })

  it('extends the chain and records a decision event', async () => {
    const sheet = await store.createSheet({
      ownerId: OWNER,
      blockId: 'blk-yakima',
      nightOf: '2026-01-18',
      notes: '',
      actor: 'grower',
      at: '2026-01-18T09:00:00.000Z',
    })
    const updated = await store.updateSheet(sheet.id, OWNER, {
      status: 'protected',
      at: '2026-01-18T20:00:00.000Z',
      actor: 'grower',
    })
    expect(updated.status).toBe('protected')
    expect(updated.eventCount).toBe(2)

    const events = await store.eventsFor(sheet.id)
    expect(events.map((event) => event.kind)).toEqual(['create', 'decision'])
    expect(replayChain(events).ok).toBe(true)
    expect(replayChain(events).headSeal).toBe(updated.seal)
  })

  it('rejects an unknown block', async () => {
    await expect(
      store.createSheet({
        ownerId: OWNER,
        blockId: 'blk-nope',
        nightOf: '2026-01-19',
        notes: '',
        actor: 'grower',
        at: '2026-01-19T09:00:00.000Z',
    }),
    ).rejects.toThrow(/no block with id/)
  })

  it('tombstones on delete and keeps the chain replayable', async () => {
    const sheet = await store.createSheet({
      ownerId: OWNER,
      blockId: 'blk-yakima',
      nightOf: '2026-01-20',
      notes: '',
      actor: 'grower',
      at: '2026-01-20T09:00:00.000Z',
    })
    const deleted = await store.deleteSheet(sheet.id, OWNER, '2026-01-20T12:00:00.000Z', 'grower')
    expect(deleted.deletedAt).not.toBeNull()
    expect(deleted.status).toBe('retired')

    // Hidden from the default list, still present as a tombstone.
    expect(await store.listSheets(OWNER)).toHaveLength(0)
    expect(await store.listSheets(OWNER, { includeDeleted: true })).toHaveLength(1)

    const replay = replayChain(await store.eventsFor(sheet.id))
    expect(replay.ok).toBe(true)
    expect(replay.length).toBe(2)
  })

  it('refuses to update a retired sheet', async () => {
    const sheet = await store.createSheet({
      ownerId: OWNER,
      blockId: 'blk-yakima',
      nightOf: '2026-01-21',
      notes: '',
      actor: 'grower',
      at: '2026-01-21T09:00:00.000Z',
    })
    await store.deleteSheet(sheet.id, OWNER, '2026-01-21T10:00:00.000Z', 'grower')
    await expect(
      store.updateSheet(sheet.id, OWNER, { status: 'protected', at: 'x', actor: 'grower' }),
    ).rejects.toThrow(/retired/)
  })
})
