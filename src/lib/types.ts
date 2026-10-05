/**
 * Domain types. External weather data is normalised into these before anything else
 * touches it, so an upstream schema change can never leak into the engine or the UI.
 */

export type CropStage = 'bud-break' | 'flowering' | 'fruit-set' | 'veraison'

export const CROP_STAGES: readonly CropStage[] = [
  'bud-break',
  'flowering',
  'fruit-set',
  'veraison',
]

export interface Block {
  readonly id: string
  readonly label: string
  readonly lat: number
  readonly lon: number
  readonly cropStage: CropStage
  /** Air temperature at or below which this block needs protection, in degrees C. */
  readonly thresholdC: number
}

export interface HourPoint {
  readonly at: string
  readonly tempC: number
  readonly precipMm: number
  readonly windKmh: number
  /** 0 = clear sky, 100 = overcast. */
  readonly cloudPct: number
}

/** Where the forecast came from, honestly. Never present fallback data as live. */
export type SourceStatus = 'live' | 'fallback'

export interface ForecastBundle {
  readonly status: SourceStatus
  readonly fetchedAt: string
  readonly source: string
  readonly sourceUrl: string
  readonly attribution: string
  readonly points: readonly HourPoint[]
  /** Present when status is "fallback", so the UI can say why. */
  readonly note?: string
}

export interface AlertItem {
  readonly id: string
  readonly event: string
  readonly severity: string
  readonly effective: string
  readonly headline: string
}

/** A user-visible sheet: one block, one night, one decision. */
export interface FrostSheet {
  readonly id: string
  readonly ownerId: string
  readonly blockId: string
  readonly blockLabel: string
  readonly nightOf: string
  readonly cropStage: CropStage
  readonly thresholdC: number
  readonly status: 'watching' | 'protected' | 'stood-down' | 'retired'
  readonly notes: string
  readonly createdAt: string
  readonly updatedAt: string
  /** Present when the sheet is tombstoned; the row is kept so the chain still replays. */
  readonly deletedAt: string | null
  readonly seal: string
  readonly eventCount: number
}

export interface AuditEvent {
  readonly seq: number
  readonly sheetId: string
  readonly kind: 'create' | 'update' | 'decision' | 'delete'
  readonly at: string
  readonly actor: string
  readonly payload: Record<string, unknown>
  readonly prevSeal: string
  readonly seal: string
}

export interface ApiError {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: Record<string, unknown>
  }
}
