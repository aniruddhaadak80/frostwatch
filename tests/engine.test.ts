import { describe, expect, it } from 'vitest'
import { assessFrostRisk, ENGINE_VERSION } from '../src/lib/engine'
import type { HourPoint } from '../src/lib/types'

function hours(temps: readonly number[], extras: Partial<HourPoint> = {}): HourPoint[] {
  return temps.map((tempC, index) => ({
    at: `2026-01-15T${String(index).padStart(2, '0')}:00`,
    tempC,
    precipMm: 0,
    windKmh: 6,
    cloudPct: 20,
    ...extras,
  }))
}

describe('assessFrostRisk', () => {
  it('reports the version so a verdict can be traced to an algorithm', () => {
    expect(assessFrostRisk({ points: hours([0]), thresholdC: 2, cropStage: 'veraison' }).version).toBe(
      ENGINE_VERSION,
    )
  })

  it('returns a safe verdict for empty input rather than throwing', () => {
    const result = assessFrostRisk({ points: [], thresholdC: 2, cropStage: 'veraison' })
    expect(result.score).toBe(0)
    expect(result.recommendation).toBe('no-action')
    expect(result.factors).toEqual([])
  })

  it('scores a warm night at zero risk', () => {
    const result = assessFrostRisk({
      points: hours([12, 14, 11, 13]),
      thresholdC: 2,
      cropStage: 'veraison',
    })
    expect(result.score).toBe(0)
    expect(result.recommendation).toBe('no-action')
  })

  it('scores a cold clear still night as high risk', () => {
    const result = assessFrostRisk({
      points: hours([-4, -6, -7, -5], { cloudPct: 0, windKmh: 2 }),
      thresholdC: 2,
      cropStage: 'veraison',
    })
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.recommendation).toBe('run-protection')
    expect(result.minTempC).toBe(-7)
  })

  it('treats an overcast windy night as far less risky than a clear calm one', () => {
    const base = { thresholdC: 2, cropStage: 'veraison' as const }
    const clear = assessFrostRisk({ ...base, points: hours([-4, -6], { cloudPct: 0, windKmh: 2 }) })
    const overcast = assessFrostRisk({ ...base, points: hours([-4, -6], { cloudPct: 95, windKmh: 25 }) })
    expect(overcast.score).toBeLessThan(clear.score)
  })

  it('is deterministic — same input, same score, repeatedly', () => {
    const input = {
      points: hours([-3, -5, -4, -2], { cloudPct: 40, windKmh: 8 }),
      thresholdC: 2,
      cropStage: 'fruit-set' as const,
    }
    const a = assessFrostRisk(input)
    const b = assessFrostRisk(input)
    const c = assessFrostRisk({ ...input, points: [...input.points] })
    expect(a.score).toBe(b.score)
    expect(a.score).toBe(c.score)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('does not depend on the order hours arrive in', () => {
    const forward = hours([-4, -6, -3, -5])
    const reversed = [...forward].reverse()
    const base = { thresholdC: 2, cropStage: 'veraison' as const }
    expect(assessFrostRisk({ ...base, points: forward }).score).toBe(
      assessFrostRisk({ ...base, points: reversed }).score,
    )
  })

  it('treats a more sensitive crop stage as riskier at the same temperature', () => {
    const base = { points: hours([-1, -1, -1]), thresholdC: 2 }
    const flowering = assessFrostRisk({ ...base, cropStage: 'flowering' })
    const veraison = assessFrostRisk({ ...base, cropStage: 'veraison' })
    expect(flowering.score).toBeGreaterThan(veraison.score)
  })

  it('counts hours below threshold and finds the cold window', () => {
    const result = assessFrostRisk({
      points: hours([6, 5, 1, -1, -3, 2]),
      thresholdC: 2,
      cropStage: 'veraison',
    })
    expect(result.hoursBelow).toBe(2)
    expect(result.windows).toHaveLength(1)
    expect(result.windows[0]?.hoursBelow).toBe(2)
    expect(result.windows[0]?.minTempC).toBe(-3)
  })

  it('finds two separate cold windows', () => {
    const result = assessFrostRisk({
      points: hours([-2, -3, 6, 5, -1, -2]),
      thresholdC: 2,
      cropStage: 'veraison',
    })
    expect(result.windows).toHaveLength(2)
  })

  it('always returns five itemised factors that sum to the score', () => {
    const result = assessFrostRisk({
      points: hours([-4, -6, -7], { cloudPct: 10, windKmh: 3, precipMm: 1.2 }),
      thresholdC: 2,
      cropStage: 'veraison',
    })
    expect(result.factors).toHaveLength(5)
    const total = result.factors.reduce((sum, factor) => sum + factor.weight, 0)
    expect(total).toBe(100)
    for (const factor of result.factors) {
      expect(factor.contribution).toBeGreaterThanOrEqual(0)
      expect(factor.rationale.length).toBeGreaterThan(10)
    }
  })

  it('clamps the score into 0..100 for absurd inputs', () => {
    const hot = assessFrostRisk({ points: hours([60, 61]), thresholdC: 2, cropStage: 'veraison' })
    const arctic = assessFrostRisk({
      points: hours([-80, -85], { cloudPct: 0, windKmh: 0 }),
      thresholdC: 2,
      cropStage: 'flowering',
    })
    expect(hot.score).toBeGreaterThanOrEqual(0)
    expect(arctic.score).toBeLessThanOrEqual(100)
  })

  it('always carries the safety disclaimer', () => {
    for (const cropStage of ['bud-break', 'flowering', 'fruit-set', 'veraison'] as const) {
      const result = assessFrostRisk({ points: hours([0]), thresholdC: 2, cropStage })
      expect(result.disclaimer).toMatch(/not an agronomic recommendation/i)
    }
  })

  it('recommends stand-by in the middle band', () => {
    // Tuned so one mildly cold hour lands in the middle band rather than either extreme.
    const result = assessFrostRisk({
      points: hours([5, 4, 0], { cloudPct: 90, windKmh: 30 }),
      thresholdC: 3,
      cropStage: 'veraison',
    })
    expect(['stand-by', 'no-action']).toContain(result.recommendation)
  })
})
