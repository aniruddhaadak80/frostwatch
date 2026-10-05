import type { CropStage, HourPoint } from './types'

/**
 * The deterministic frost-risk engine.
 *
 * This is the part of the product that must be exactly right, so it is a pure function:
 * same forecast and same block always produce the same verdict, with no clock, no
 * randomness, and no network. The UI, the REST endpoint and the agent tool all call this
 * one function — there is no second implementation.
 *
 * The score is a weighted mean of five sub-scores, each already normalised to 0..100 where
 * 100 means "most frost risk". Weights are fixed integers and sum to 100, so the score reads
 * directly as a percentage. Integer arithmetic throughout: no floating point in the combine
 * step, so the result cannot drift between platforms.
 *
 * Why not "will it frost?" from a raw number: a grower needs to know whether to start
 * wind machines at 04:00, and that depends on how long the air stays cold and whether the sky
 * is clear enough to radiate heat away. A single minimum temperature cannot answer that.
 */

export const ENGINE_VERSION = 'frost-risk@1.0.0'

export interface EngineInput {
  readonly points: readonly HourPoint[]
  readonly thresholdC: number
  readonly cropStage: CropStage
}

export interface EngineFactor {
  readonly id: string
  readonly label: string
  /** Raw observation the factor was computed from, so the maths can be checked by hand. */
  readonly value: string
  readonly weight: number
  /** This factor's contribution to the final score, rounded to 2dp. */
  readonly contribution: number
  readonly rationale: string
}

export type Recommendation = 'run-protection' | 'stand-by' | 'no-action'
export type RiskBand = 'severe' | 'high' | 'moderate' | 'low'

export interface RiskWindow {
  readonly from: string
  readonly to: string
  readonly minTempC: number
  readonly hoursBelow: number
}

export interface EngineResult {
  readonly version: string
  readonly score: number
  readonly band: RiskBand
  readonly recommendation: Recommendation
  readonly headline: string
  readonly minTempC: number
  readonly hoursBelow: number
  readonly coldHours: readonly HourPoint[]
  readonly windows: readonly RiskWindow[]
  readonly factors: readonly EngineFactor[]
  /** Where the numbers came from, so a verdict is never floating free of evidence. */
  readonly disclaimer: string
}

/** Fixed weights. They sum to 100. */
const WEIGHTS = {
  minimum: 40,
  duration: 20,
  radiation: 15,
  wind: 15,
  wetness: 10,
} as const

/** Crop stages differ in how much cold they can absorb before damage. */
const STAGE_TOLERANCE_C: Readonly<Record<CropStage, number>> = {
  'bud-break': 1.5,
  flowering: 0.5,
  'fruit-set': 0.5,
  veraison: 2,
}

const clamp = (value: number, low = 0, high = 100): number =>
  Math.max(low, Math.min(high, value))

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Below-threshold severity, 0..100. Saturates 6 degrees under the threshold. */
function minimumScore(minTempC: number, thresholdC: number): number {
  const deficit = thresholdC - minTempC
  if (deficit <= 0) return 0
  return clamp(Math.round((deficit / 6) * 100))
}

/** Longer cold exposure means more damage. Saturates at 8 hours below threshold. */
function durationScore(hoursBelow: number): number {
  return clamp(Math.round((hoursBelow / 8) * 100))
}

/** Air temperature at or below which an hour counts as night-time for radiation and wind. */
const NIGHT_C = 4

function meanOf(points: readonly HourPoint[], pick: (point: HourPoint) => number): number {
  if (points.length === 0) return 0
  return points.reduce((total, point) => total + pick(point), 0) / points.length
}

/** The hours that actually matter for radiative cooling and wind mixing. */
function nightHours(points: readonly HourPoint[]): readonly HourPoint[] {
  const cold = points.filter((point) => point.tempC <= NIGHT_C)
  return cold.length > 0 ? cold : points
}

/**
 * Radiation and wind are MODIFIERS of frost, not sources of it. On a warm night a clear sky
 * and a still air are irrelevant, so scoring them would report frost risk when the minimum
 * temperature is nowhere near freezing. They therefore only contribute once the night is
 * close enough to freezing for frost to be physically possible.
 */
const COLD_POSSIBLE_MARGIN_C = 3

function coldPossible(minTempC: number, effectiveThreshold: number): boolean {
  return minTempC <= effectiveThreshold + COLD_POSSIBLE_MARGIN_C
}

/**
 * Radiative cooling. A clear, still sky lets heat leave the surface all night, which is
 * exactly when frost happens. An overcast sky insulates.
 */
function radiationScore(points: readonly HourPoint[], possible: boolean): number {
  if (!possible) return 0
  return clamp(Math.round(100 - meanOf(nightHours(points), (point) => point.cloudPct)))
}

/** Wind mixes the boundary layer and fights radiative cooling. Saturates at 20 km/h. */
function windScore(points: readonly HourPoint[], possible: boolean): number {
  if (!possible) return 0
  const meanWind = meanOf(nightHours(points), (point) => point.windKmh)
  if (meanWind <= 4) return 100
  if (meanWind >= 20) return 0
  return clamp(Math.round(((20 - meanWind) / 16) * 100))
}

/** Precipitation wets the ground, and wet ground releases heat slowly: slightly worse. */
function wetnessScore(points: readonly HourPoint[]): number {
  const total = points.reduce((sum, point) => sum + point.precipMm, 0)
  return clamp(Math.round((total / 4) * 100))
}

function bandFor(score: number): RiskBand {
  if (score >= 70) return 'severe'
  if (score >= 45) return 'high'
  if (score >= 25) return 'moderate'
  return 'low'
}

function recommendationFor(score: number): Recommendation {
  if (score >= 45) return 'run-protection'
  if (score >= 25) return 'stand-by'
  return 'no-action'
}

/** Contiguous cold runs, each with its own minimum, for "when do I start the fans". */
function coldWindows(points: readonly HourPoint[], thresholdC: number): RiskWindow[] {
  const windows: RiskWindow[] = []
  let start = -1
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!
    const cold = point.tempC <= thresholdC
    if (cold && start === -1) start = i
    if (!cold && start !== -1) {
      const slice = points.slice(start, i)
      windows.push({
        from: slice[0]!.at,
        to: slice[slice.length - 1]!.at,
        minTempC: round2(Math.min(...slice.map((p) => p.tempC))),
        hoursBelow: slice.length,
      })
      start = -1
    }
  }
  if (start !== -1) {
    const slice = points.slice(start)
    windows.push({
      from: slice[0]!.at,
      to: slice[slice.length - 1]!.at,
      minTempC: round2(Math.min(...slice.map((p) => p.tempC))),
      hoursBelow: slice.length,
    })
  }
  return windows
}

const DISCLAIMER =
  'Automated guidance from a public forecast, not an agronomic recommendation. ' +
  'Confirm with your own field sensors and local extension advice before acting.'

export function assessFrostRisk(input: EngineInput): EngineResult {
  const points = [...input.points].sort((a, b) => a.at.localeCompare(b.at))
  if (points.length === 0) {
    return {
      version: ENGINE_VERSION,
      score: 0,
      band: 'low',
      recommendation: 'no-action',
      headline: 'No forecast hours available for this window.',
      minTempC: 0,
      hoursBelow: 0,
      coldHours: [],
      windows: [],
      factors: [],
      disclaimer: DISCLAIMER,
    }
  }

  // A stage-adjusted threshold: flowering and fruit-set are damaged by less cold than
  // veraison, so the same air temperature is a different risk.
  const effectiveThreshold = input.thresholdC - STAGE_TOLERANCE_C[input.cropStage]

  const minTempC = round2(Math.min(...points.map((point) => point.tempC)))
  const coldHours = points.filter((point) => point.tempC <= effectiveThreshold)
  const possible = coldPossible(minTempC, effectiveThreshold)

  const raw = {
    minimum: minimumScore(minTempC, effectiveThreshold),
    duration: durationScore(coldHours.length),
    radiation: radiationScore(points, possible),
    wind: windScore(points, possible),
    wetness: wetnessScore(points),
  }

  const weighted =
    raw.minimum * WEIGHTS.minimum +
    raw.duration * WEIGHTS.duration +
    raw.radiation * WEIGHTS.radiation +
    raw.wind * WEIGHTS.wind +
    raw.wetness * WEIGHTS.wetness
  const score = clamp(Math.round(weighted / 100))

  const factors: EngineFactor[] = [
    {
      id: 'minimum',
      label: 'Minimum air temperature',
      value: `${minTempC}°C vs ${round2(effectiveThreshold)}°C threshold`,
      weight: WEIGHTS.minimum,
      contribution: round2((raw.minimum * WEIGHTS.minimum) / 100),
      rationale: `A ${input.cropStage.replace('-', ' ')} block at ${input.thresholdC}°C is treated as stressed ${round2(STAGE_TOLERANCE_C[input.cropStage])}°C below that.`,
    },
    {
      id: 'duration',
      label: 'Hours below threshold',
      value: `${coldHours.length} h`,
      weight: WEIGHTS.duration,
      contribution: round2((raw.duration * WEIGHTS.duration) / 100),
      rationale: 'Damage accumulates with exposure, not just depth.',
    },
    {
      id: 'radiation',
      label: 'Clear-sky cooling',
      value: `${raw.radiation}% clear`,
      weight: WEIGHTS.radiation,
      contribution: round2((raw.radiation * WEIGHTS.radiation) / 100),
      rationale: 'A clear night lets surface heat escape; cloud insulates. Only scored when the night is near freezing.',
    },
    {
      id: 'wind',
      label: 'Overnight wind',
      value: `${round2(meanOf(nightHours(points), (point) => point.windKmh))} km/h mean`,
      weight: WEIGHTS.wind,
      contribution: round2((raw.wind * WEIGHTS.wind) / 100),
      rationale: 'Wind above about 20 km/h prevents a damaging inversion forming. Only scored when the night is near freezing.',
    },
    {
      id: 'wetness',
      label: 'Ground wetness',
      value: `${round2(points.reduce((s, p) => s + p.precipMm, 0))} mm precipitation`,
      weight: WEIGHTS.wetness,
      contribution: round2((raw.wetness * WEIGHTS.wetness) / 100),
      rationale: 'Wet ground releases stored heat slowly through the night.',
    },
  ]

  const band = bandFor(score)
  const recommendation = recommendationFor(score)
  const headline =
    recommendation === 'run-protection'
      ? `Start protection before the cold window at ${coldWindows(points, effectiveThreshold)[0]?.from ?? 'the first cold hour'}.`
      : recommendation === 'stand-by'
        ? 'Cold is likely. Hold a decision until the evening update.'
        : 'No damaging cold in this window.'

  return {
    version: ENGINE_VERSION,
    score,
    band,
    recommendation,
    headline,
    minTempC,
    hoursBelow: coldHours.length,
    coldHours,
    windows: coldWindows(points, effectiveThreshold),
    factors,
    disclaimer: DISCLAIMER,
  }
}
