import { describe, expect, it } from 'vitest'
import { currentLocalHour, normaliseHours } from '../src/lib/weather'

const HOURS = [
  '2026-01-15T00:00',
  '2026-01-15T01:00',
  '2026-01-15T02:00',
  '2026-01-15T03:00',
]

function payload() {
  return {
    hourly: {
      time: HOURS,
      temperature_2m: [-1, -2, -3, -4],
      precipitation: [0, 0, 0, 0],
      wind_speed_10m: [4, 5, 6, 7],
      cloud_cover: [10, 20, 30, 40],
    },
  }
}

describe('currentLocalHour', () => {
  it('is the local hour of the block, not of UTC', () => {
    // 2026-01-15T12:00Z is 04:00 in UTC-08:00.
    const now = new Date('2026-01-15T12:00:00Z')
    expect(currentLocalHour(now, -8 * 3600)).toBe('2026-01-15T04:00')
  })

  it('is empty when the response carries no offset', () => {
    expect(currentLocalHour(new Date('2026-01-15T12:00:00Z'), undefined)).toBe('')
  })
})

describe('normaliseHours', () => {
  it('drops the hours that have already happened', () => {
    const points = normaliseHours(payload(), '2026-01-15T02:00')
    expect(points.map((p) => p.at)).toEqual(['2026-01-15T02:00', '2026-01-15T03:00'])
  })

  it('keeps every hour when there is no cutoff', () => {
    const points = normaliseHours(payload())
    expect(points).toHaveLength(4)
  })

  it('keeps the hour that is exactly the cutoff', () => {
    const points = normaliseHours(payload(), '2026-01-15T01:00')
    expect(points.map((p) => p.at)).toEqual(['2026-01-15T01:00', '2026-01-15T02:00', '2026-01-15T03:00'])
  })

  it('returns nothing when every hour is in the past', () => {
    expect(normaliseHours(payload(), '2026-01-15T04:00')).toHaveLength(0)
  })
})
