import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { appendEvent, type ChainLink } from './integrity'
import { StoreError, type Store } from './store'
import type { AuditEvent, Block, FrostSheet } from './types'

/** Real growing regions. Coordinates are real, so every forecast fetched for them is real. */
export const SEED_BLOCKS: readonly Block[] = [
  { id: 'blk-yakima', label: 'Yakima Valley — Block 4', lat: 46.6, lon: -120.51, cropStage: 'fruit-set', thresholdC: 2 },
  { id: 'blk-wallawalla', label: 'Walla Walla — Stone Terrace', lat: 46.07, lon: -118.34, cropStage: 'veraison', thresholdC: 2 },
  { id: 'blk-willamette', label: 'Willamette Valley — Eola-Amity', lat: 45.28, lon: -123.04, cropStage: 'flowering', thresholdC: 3 },
  { id: 'blk-hoodriver', label: 'Hood River — Sandy Bench', lat: 45.7, lon: -121.51, cropStage: 'fruit-set', thresholdC: 2 },
  { id: 'blk-colchagua', label: 'Colchagua — Peumo Alto', lat: -34.6, lon: -71.15, cropStage: 'veraison', thresholdC: 1 },
  { id: 'blk-barossa', label: 'Barossa — Northern Heights', lat: -34.56, lon: 138.95, cropStage: 'fruit-set', thresholdC: 2 },
]

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  crop_stage TEXT NOT NULL,
  threshold_c REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  block_id TEXT NOT NULL REFERENCES blocks(id),
  night_of TEXT NOT NULL,
  crop_stage TEXT NOT NULL,
  threshold_c REAL NOT NULL,
  status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  seal TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sheets_owner_idx ON sheets (owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sheets_owner_block_night_idx
  ON sheets (owner_id, block_id, night_of);
CREATE TABLE IF NOT EXISTS audit_events (
  sheet_id TEXT NOT NULL REFERENCES sheets(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  prev_seal TEXT NOT NULL,
  seal TEXT NOT NULL,
  PRIMARY KEY (sheet_id, seq)
);
`

interface SheetRow {
  id: string
  owner_id: string
  block_id: string
  night_of: string
  crop_stage: string
  threshold_c: number
  status: string
  notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  seal: string
  event_count: number
}

function toSheet(row: SheetRow): FrostSheet {
  return {
    id: row.id,
    ownerId: row.owner_id,
    blockId: row.block_id,
    blockLabel: '',
    nightOf: row.night_of,
    cropStage: row.crop_stage as FrostSheet['cropStage'],
    thresholdC: row.threshold_c,
    status: row.status as FrostSheet['status'],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    seal: row.seal,
    eventCount: row.event_count,
  }
}

export class SqliteStore implements Store {
  readonly kind = 'sqlite' as const
  #db: Database.Database | null = null

  async init(): Promise<void> {
    // Idempotent: re-initialising an already-open store must not open a second connection to
    // the same file, which deadlocks on the WAL lock and leaks the first handle.
    if (this.#db !== null && this.#db.open) return
    const path = process.env.SQLITE_PATH ?? '.data/frostwatch.db'
    mkdirSync(dirname(path), { recursive: true })
    this.#db = new Database(path)
    this.#db.pragma('journal_mode = WAL')
    this.#db.pragma('foreign_keys = ON')
    this.#db.exec(SCHEMA)
    this.#seed()
  }

  get db(): Database.Database {
    if (this.#db === null) throw new StoreError('STORE_UNAVAILABLE', 'store not initialised', 500)
    return this.#db
  }

  /** Idempotent: only seeds when the table is empty, so user rows are never touched. */
  #seed(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM blocks').get() as { n: number }
    if (count.n > 0) return
    const insert = this.db.prepare(
      'INSERT INTO blocks (id, label, lat, lon, crop_stage, threshold_c) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const tx = this.db.transaction(() => {
      for (const block of SEED_BLOCKS) {
        insert.run(block.id, block.label, block.lat, block.lon, block.cropStage, block.thresholdC)
      }
    })
    tx()
  }

  async listBlocks(): Promise<Block[]> {
    const rows = this.db.prepare('SELECT * FROM blocks ORDER BY label').all() as {
      id: string
      label: string
      lat: number
      lon: number
      crop_stage: string
      threshold_c: number
    }[]
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      lat: row.lat,
      lon: row.lon,
      cropStage: row.crop_stage as Block['cropStage'],
      thresholdC: row.threshold_c,
    }))
  }

  async listSheets(ownerId: string, options: { includeDeleted?: boolean } = {}): Promise<FrostSheet[]> {
    const sql = options.includeDeleted === true
      ? 'SELECT * FROM sheets WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200'
      : 'SELECT * FROM sheets WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200'
    const rows = this.db.prepare(sql).all(ownerId) as SheetRow[]
    const blocks = await this.listBlocks()
    return rows.map((row) => ({ ...toSheet(row), blockLabel: blocks.find((b) => b.id === row.block_id)?.label ?? row.block_id }))
  }

  async getSheet(id: string, ownerId: string): Promise<FrostSheet | null> {
    const row = this.db
      .prepare('SELECT * FROM sheets WHERE id = ? AND owner_id = ?')
      .get(id, ownerId) as SheetRow | undefined
    if (row === undefined) return null
    const blocks = await this.listBlocks()
    return { ...toSheet(row), blockLabel: blocks.find((b) => b.id === row.block_id)?.label ?? row.block_id }
  }

  #loadEvents(sheetId: string): ChainLink[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_events WHERE sheet_id = ? ORDER BY seq')
      .all(sheetId) as { seq: number; sheet_id: string; kind: string; at: string; actor: string; payload: string; prev_seal: string; seal: string }[]
    return rows.map((row) => ({
      seq: row.seq,
      sheetId: row.sheet_id,
      kind: row.kind as ChainLink['kind'],
      at: row.at,
      actor: row.actor,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      prevSeal: row.prev_seal,
      seal: row.seal,
    }))
  }

  #append(sheetId: string, next: { kind: ChainLink['kind']; at: string; actor: string; payload: Record<string, unknown> }): ChainLink {
    const link = appendEvent(this.#loadEvents(sheetId), { sheetId, ...next })
    this.db
      .prepare(
        'INSERT INTO audit_events (sheet_id, seq, kind, at, actor, payload, prev_seal, seal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(sheetId, link.seq, link.kind, link.at, link.actor, JSON.stringify(link.payload), link.prevSeal, link.seal)
    return link
  }

  async createSheet(input: {
    ownerId: string
    blockId: string
    nightOf: string
    notes: string
    actor: string
    at: string
  }): Promise<FrostSheet> {
    const block = (await this.listBlocks()).find((b) => b.id === input.blockId)
    if (block === undefined) {
      throw new StoreError('BLOCK_UNKNOWN', `no block with id "${input.blockId}"`, 422)
    }
    const clash = this.db
      .prepare('SELECT id FROM sheets WHERE owner_id = ? AND block_id = ? AND night_of = ?')
      .get(input.ownerId, input.blockId, input.nightOf) as { id: string } | undefined
    if (clash !== undefined) {
      throw new StoreError('SHEET_EXISTS', `a sheet already exists for this block and night`, 409)
    }
    const id = `sh_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    this.db
      .prepare(
        `INSERT INTO sheets (id, owner_id, block_id, night_of, crop_stage, threshold_c, status, notes, created_at, updated_at, deleted_at, seal, event_count)
         VALUES (?, ?, ?, ?, ?, ?, 'watching', ?, ?, ?, NULL, '', 0)`,
      )
      .run(id, input.ownerId, block.id, input.nightOf, block.cropStage, block.thresholdC, input.notes, input.at, input.at)
    const link = this.#append(id, {
      kind: 'create',
      at: input.at,
      actor: input.actor,
      payload: { blockId: block.id, nightOf: input.nightOf, cropStage: block.cropStage, thresholdC: block.thresholdC },
    })
    this.db.prepare('UPDATE sheets SET seal = ?, event_count = ? WHERE id = ?').run(link.seal, link.seq, id)
    const created = await this.getSheet(id, input.ownerId)
    if (created === null) throw new StoreError('WRITE_FAILED', 'sheet vanished after create', 500)
    return created
  }

  async updateSheet(
    id: string,
    ownerId: string,
    patch: { notes?: string; status?: FrostSheet['status']; at: string; actor: string },
  ): Promise<FrostSheet> {
    const existing = await this.getSheet(id, ownerId)
    if (existing === null) throw new StoreError('SHEET_NOT_FOUND', `no sheet "${id}"`, 404)
    if (existing.deletedAt !== null) throw new StoreError('SHEET_RETIRED', 'sheet is retired', 409)
    if (patch.status !== undefined && existing.status === patch.status && patch.notes === undefined) {
      return existing
    }
    const notes = patch.notes ?? existing.notes
    const status = patch.status ?? existing.status
    this.db
      .prepare('UPDATE sheets SET notes = ?, status = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
      .run(notes, status, patch.at, id, ownerId)
    const link = this.#append(id, {
      kind: patch.status !== undefined && patch.status !== existing.status ? 'decision' : 'update',
      at: patch.at,
      actor: patch.actor,
      payload: { status, notes },
    })
    this.db.prepare('UPDATE sheets SET seal = ?, event_count = ? WHERE id = ?').run(link.seal, link.seq, id)
    const updated = await this.getSheet(id, ownerId)
    if (updated === null) throw new StoreError('WRITE_FAILED', 'sheet vanished after update', 500)
    return updated
  }

  /** Tombstone, never a row removal: the chain has to stay replayable after a retire. */
  async deleteSheet(id: string, ownerId: string, at: string, actor: string): Promise<FrostSheet> {
    const existing = await this.getSheet(id, ownerId)
    if (existing === null) throw new StoreError('SHEET_NOT_FOUND', `no sheet "${id}"`, 404)
    this.db
      .prepare("UPDATE sheets SET deleted_at = ?, status = 'retired', updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(at, at, id, ownerId)
    const link = this.#append(id, { kind: 'delete', at, actor, payload: { tombstone: true } })
    this.db.prepare('UPDATE sheets SET seal = ?, event_count = ? WHERE id = ?').run(link.seal, link.seq, id)
    const updated = await this.getSheet(id, ownerId)
    if (updated === null) throw new StoreError('WRITE_FAILED', 'sheet vanished after delete', 500)
    return updated
  }

  async eventsFor(sheetId: string): Promise<AuditEvent[]> {
    return this.#loadEvents(sheetId).map((link) => ({
      seq: link.seq,
      sheetId: link.sheetId,
      kind: link.kind,
      at: link.at,
      actor: link.actor,
      payload: link.payload,
      prevSeal: link.prevSeal,
      seal: link.seal,
    }))
  }
}
