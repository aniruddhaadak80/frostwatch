import { neon } from '@neondatabase/serverless'
import { appendEvent, type ChainLink } from './integrity'
import { StoreError, type Store } from './store'
import { SEED_BLOCKS } from './store-sqlite'
import type { AuditEvent, Block, FrostSheet } from './types'

/** The driver's tagged-template query function. Named via ReturnType so it tracks the version. */
type Sql = ReturnType<typeof neon>

/**
 * The hosted adapter. Postgres in production, SQLite locally, one interface.
 *
 * Multi-statement writes use the driver's non-interactive `sql.transaction([...])` batch, so
 * the sheet row and its chain event commit atomically. The HTTP driver has no interactive
 * transaction, which is why the chain is appended with a single statement rather than a
 * read-then-write.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS blocks (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     lat DOUBLE PRECISION NOT NULL,
     lon DOUBLE PRECISION NOT NULL,
     crop_stage TEXT NOT NULL,
     threshold_c DOUBLE PRECISION NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sheets (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL,
     block_id TEXT NOT NULL REFERENCES blocks(id),
     night_of TEXT NOT NULL,
     crop_stage TEXT NOT NULL,
     threshold_c DOUBLE PRECISION NOT NULL,
     status TEXT NOT NULL,
     notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted_at TEXT,
     seal TEXT NOT NULL,
     event_count INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS sheets_owner_idx ON sheets (owner_id, updated_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sheets_owner_block_night_idx
     ON sheets (owner_id, block_id, night_of)`,
  `CREATE TABLE IF NOT EXISTS audit_events (
     sheet_id TEXT NOT NULL REFERENCES sheets(id),
     seq INTEGER NOT NULL,
     kind TEXT NOT NULL,
     at TEXT NOT NULL,
     actor TEXT NOT NULL,
     payload TEXT NOT NULL,
     prev_seal TEXT NOT NULL,
     seal TEXT NOT NULL,
     PRIMARY KEY (sheet_id, seq)
   )`,
]

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

function toSheet(row: SheetRow, blockLabel: string): FrostSheet {
  return {
    id: row.id,
    ownerId: row.owner_id,
    blockId: row.block_id,
    blockLabel,
    nightOf: row.night_of,
    cropStage: row.crop_stage as FrostSheet['cropStage'],
    thresholdC: Number(row.threshold_c),
    status: row.status as FrostSheet['status'],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    seal: row.seal,
    eventCount: Number(row.event_count),
  }
}

export class NeonStore implements Store {
  readonly kind = 'neon' as const
  #sql: Sql | null = null

  async init(): Promise<void> {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL
    if (typeof url !== 'string' || url.length === 0) {
      throw new StoreError('STORE_UNAVAILABLE', 'DATABASE_URL is not set', 500)
    }
    this.#sql = neon(url)
    // DDL cannot be parameterised, so it goes through the driver's raw query method rather
    // than a tagged template. `CREATE TABLE IF NOT EXISTS` makes this safe to run per cold start.
    for (const statement of SCHEMA) await this.#sql.query(statement)
    await this.#seed()
  }

  get sql(): Sql {
    if (this.#sql === null) throw new StoreError('STORE_UNAVAILABLE', 'store not initialised', 500)
    return this.#sql
  }

  /** Idempotent, and only ever inserts the fixed seed ids, so user rows are untouched. */
  async #seed(): Promise<void> {
    const rows = (await this.sql`SELECT count(*)::int AS n FROM blocks`) as { n: number }[]
    if ((rows[0]?.n ?? 0) > 0) return
    for (const block of SEED_BLOCKS) {
      await this.sql`INSERT INTO blocks (id, label, lat, lon, crop_stage, threshold_c)
        VALUES (${block.id}, ${block.label}, ${block.lat}, ${block.lon}, ${block.cropStage}, ${block.thresholdC})
        ON CONFLICT (id) DO NOTHING`
    }
  }

  async listBlocks(): Promise<Block[]> {
    const rows = (await this.sql`SELECT * FROM blocks ORDER BY label`) as {
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
      lat: Number(row.lat),
      lon: Number(row.lon),
      cropStage: row.crop_stage as Block['cropStage'],
      thresholdC: Number(row.threshold_c),
    }))
  }

  async listSheets(ownerId: string, options: { includeDeleted?: boolean } = {}): Promise<FrostSheet[]> {
    // Two statements rather than one conditional fragment: a nullable filter inside a tagged
    // template is easy to get subtly wrong, and this keeps each query readable.
    const rows = (
      options.includeDeleted === true
        ? await this.sql`
            SELECT s.*, b.label AS b_label
            FROM sheets s JOIN blocks b ON b.id = s.block_id
            WHERE s.owner_id = ${ownerId}
            ORDER BY s.updated_at DESC
            LIMIT 200`
        : await this.sql`
            SELECT s.*, b.label AS b_label
            FROM sheets s JOIN blocks b ON b.id = s.block_id
            WHERE s.owner_id = ${ownerId} AND s.deleted_at IS NULL
            ORDER BY s.updated_at DESC
            LIMIT 200`
    ) as (SheetRow & { b_label: string })[]
    return rows.map((row) => toSheet(row, row.b_label))
  }

  async getSheet(id: string, ownerId: string): Promise<FrostSheet | null> {
    const rows = (await this.sql`
      SELECT s.*, b.label AS b_label
      FROM sheets s JOIN blocks b ON b.id = s.block_id
      WHERE s.id = ${id} AND s.owner_id = ${ownerId}`) as (SheetRow & { b_label: string })[]
    const row = rows[0]
    return row === undefined ? null : toSheet(row, row.b_label)
  }

  async #loadEvents(sheetId: string): Promise<ChainLink[]> {
    const rows = (await this.sql`
      SELECT * FROM audit_events WHERE sheet_id = ${sheetId} ORDER BY seq`) as {
      seq: number
      sheet_id: string
      kind: string
      at: string
      actor: string
      payload: string
      prev_seal: string
      seal: string
    }[]
    return rows.map((row) => ({
      seq: Number(row.seq),
      sheetId: row.sheet_id,
      kind: row.kind as ChainLink['kind'],
      at: row.at,
      actor: row.actor,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      prevSeal: row.prev_seal,
      seal: row.seal,
    }))
  }

  async createSheet(input: {
    ownerId: string
    blockId: string
    nightOf: string
    notes: string
    actor: string
    at: string
  }): Promise<FrostSheet> {
    const blocks = await this.listBlocks()
    const block = blocks.find((b) => b.id === input.blockId)
    if (block === undefined) {
      throw new StoreError('BLOCK_UNKNOWN', `no block with id "${input.blockId}"`, 422)
    }
    const existing = (await this.sql`
      SELECT id FROM sheets WHERE owner_id = ${input.ownerId} AND block_id = ${input.blockId} AND night_of = ${input.nightOf}`) as {
      id: string
    }[]
    if (existing.length > 0) {
      throw new StoreError('SHEET_EXISTS', 'a sheet already exists for this block and night', 409)
    }

    const id = `sh_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    const link = appendEvent([], {
      sheetId: id,
      kind: 'create',
      at: input.at,
      actor: input.actor,
      payload: {
        blockId: block.id,
        nightOf: input.nightOf,
        cropStage: block.cropStage,
        thresholdC: block.thresholdC,
      },
    })

    await this.sql.transaction([
      this.sql`INSERT INTO sheets
           (id, owner_id, block_id, night_of, crop_stage, threshold_c, status, notes, created_at, updated_at, deleted_at, seal, event_count)
           VALUES (${id}, ${input.ownerId}, ${block.id}, ${input.nightOf}, ${block.cropStage}, ${block.thresholdC},
                   'watching', ${input.notes}, ${input.at}, ${input.at}, NULL, ${link.seal}, ${link.seq})`,
      this.sql`INSERT INTO audit_events (sheet_id, seq, kind, at, actor, payload, prev_seal, seal)
           VALUES (${id}, ${link.seq}, ${link.kind}, ${link.at}, ${link.actor}, ${JSON.stringify(link.payload)}, ${link.prevSeal}, ${link.seal})`,
    ])

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
    if (patch.status !== undefined && patch.status === existing.status && patch.notes === undefined) {
      return existing
    }

    const notes = patch.notes ?? existing.notes
    const status = patch.status ?? existing.status
    const events = await this.#loadEvents(id)
    const link = appendEvent(events, {
      sheetId: id,
      kind: patch.status !== undefined && patch.status !== existing.status ? 'decision' : 'update',
      at: patch.at,
      actor: patch.actor,
      payload: { status, notes },
    })

    await this.sql.transaction([
      this.sql`UPDATE sheets SET notes = ${notes}, status = ${status}, updated_at = ${patch.at},
              seal = ${link.seal}, event_count = ${link.seq}
           WHERE id = ${id} AND owner_id = ${ownerId}`,
      this.sql`INSERT INTO audit_events (sheet_id, seq, kind, at, actor, payload, prev_seal, seal)
           VALUES (${id}, ${link.seq}, ${link.kind}, ${link.at}, ${link.actor}, ${JSON.stringify(link.payload)}, ${link.prevSeal}, ${link.seal})
           ON CONFLICT (sheet_id, seq) DO NOTHING`,
    ])

    const updated = await this.getSheet(id, ownerId)
    if (updated === null) throw new StoreError('WRITE_FAILED', 'sheet vanished after update', 500)
    return updated
  }

  async deleteSheet(id: string, ownerId: string, at: string, actor: string): Promise<FrostSheet> {
    const existing = await this.getSheet(id, ownerId)
    if (existing === null) throw new StoreError('SHEET_NOT_FOUND', `no sheet "${id}"`, 404)
    const events = await this.#loadEvents(id)
    const link = appendEvent(events, {
      sheetId: id,
      kind: 'delete',
      at,
      actor,
      payload: { tombstone: true },
    })

    await this.sql.transaction([
      this.sql`UPDATE sheets SET deleted_at = ${at}, status = 'retired', updated_at = ${at},
              seal = ${link.seal}, event_count = ${link.seq}
           WHERE id = ${id} AND owner_id = ${ownerId}`,
      this.sql`INSERT INTO audit_events (sheet_id, seq, kind, at, actor, payload, prev_seal, seal)
           VALUES (${id}, ${link.seq}, ${link.kind}, ${link.at}, ${link.actor}, ${JSON.stringify(link.payload)}, ${link.prevSeal}, ${link.seal})
           ON CONFLICT (sheet_id, seq) DO NOTHING`,
    ])

    const updated = await this.getSheet(id, ownerId)
    if (updated === null) throw new StoreError('WRITE_FAILED', 'sheet vanished after delete', 500)
    return updated
  }

  async eventsFor(sheetId: string): Promise<AuditEvent[]> {
    const events = await this.#loadEvents(sheetId)
    return events.map((link) => ({
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
