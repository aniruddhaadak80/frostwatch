import type { AlertItem, Block, ForecastBundle, HourPoint } from './types'

/**
 * Live data with an honest provenance label.
 *
 * Open-Meteo (forecast) and the NWS active-alerts feed are both public, key-free and
 * independently operated. Every response carries `status: 'live' | 'fallback'` plus the fetch
 * time and the upstream URL, so the UI can say where a number came from and whether it is
 * current. A fallback is never presented as live, and a fallback never overwrites user data.
 */

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
const NWS_ALERTS = 'https://api.weather.gov/alerts/active'

export const ATTRIBUTION = {
  forecast: 'Open-Meteo.com — CC BY 4.0',
  alerts: 'NOAA/NWS api.weather.gov — public domain',
} as const

async function fetchJson<T>(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'frostwatch/1.0', ...headers },
      next: { revalidate: 900 },
    })
    if (!response.ok) throw new Error(`upstream ${response.status}`)
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** Bounded retries. Two attempts, so a single 503 does not surface as "no data". */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (cause) {
      lastError = cause
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 350))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

interface OpenMeteoResponse {
  hourly?: {
    time?: string[]
    temperature_2m?: (number | null)[]
    precipitation?: (number | null)[]
    wind_speed_10m?: (number | null)[]
    cloud_cover?: (number | null)[]
  }
}

/**
 * Normalised from the raw Open-Meteo payload. Nasty cases are dropped rather than coerced to
 * zero: a missing cloud_cover must not read as "clear sky", which would fabricate frost risk.
 */
function normaliseHours(raw: OpenMeteoResponse): HourPoint[] {
  const hourly = raw.hourly
  if (hourly?.time === undefined || hourly.temperature_2m === undefined) return []
  const points: HourPoint[] = []
  for (let i = 0; i < hourly.time.length; i += 1) {
    const at = hourly.time[i]!
    const tempC = hourly.temperature_2m[i]
    if (tempC === null || tempC === undefined) continue
    const wind = hourly.wind_speed_10m?.[i]
    if (wind === null || wind === undefined) continue
    const cloud = hourly.cloud_cover?.[i]
    if (cloud === null || cloud === undefined) continue
    points.push({
      at,
      tempC,
      precipMm: hourly.precipitation?.[i] ?? 0,
      windKmh: wind,
      cloudPct: cloud,
    })
  }
  return points
}

/** A sealed offline sample, so the build and first paint never break. */
function fallbackBundle(note: string): ForecastBundle {
  const base = Date.UTC(2026, 0, 15, 18, 0, 0)
  const profile = [-2.4, -4.1, -6.2, -7.4, -6.9, -5.1, -3.2, -1.4]
  const points: HourPoint[] = profile.map((tempC, index) => ({
    at: new Date(base + index * 3600_000).toISOString().slice(0, 13) + ':00',
    tempC,
    precipMm: 0,
    windKmh: 3 + index,
    cloudPct: 10 + index * 4,
  }))
  return {
    status: 'fallback',
    fetchedAt: new Date(0).toISOString(),
    source: 'bundled sample',
    sourceUrl: 'see src/lib/weather.ts',
    attribution: 'Illustrative sample bundled with the app',
    points,
    note,
  }
}

export async function fetchForecast(block: Block, now = new Date()): Promise<ForecastBundle> {
  // Hourly, two days, no key. Starts at the top of the current hour.
  const url =
    `${OPEN_METEO}?latitude=${block.lat}&longitude=${block.lon}` +
    '&hourly=temperature_2m,precipitation,wind_speed_10m,cloud_cover' +
    '&forecast_days=2&timezone=auto'

  try {
    const raw = await withRetry(() => fetchJson<OpenMeteoResponse>(url, 8000))
    const points = normaliseHours(raw)
    if (points.length === 0) {
      return fallbackBundle('The upstream forecast returned no usable hours. Showing the bundled sample.')
    }
    return {
      status: 'live',
      fetchedAt: now.toISOString(),
      source: 'Open-Meteo',
      sourceUrl: url,
      attribution: ATTRIBUTION.forecast,
      points,
    }
  } catch (cause) {
    return fallbackBundle(`Upstream forecast unavailable (${String(cause)}). Showing the bundled sample.`)
  }
}

interface NwsAlert {
  id?: string
  event?: string
  severity?: string
  effective?: string
  headline?: string
}

export async function fetchAlerts(lat: number, lon: number, now = new Date()): Promise<{
  status: 'live' | 'fallback'
  fetchedAt: string
  items: AlertItem[]
  note?: string
}> {
  const url = `${NWS_ALERTS}/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`
  try {
    const raw = await withRetry(() =>
      fetchJson<{ features?: NwsAlert[] }>(url, 8000, { accept: 'application/geo+json' }),
    )
    const items = (raw.features ?? [])
      .map((feature) => ({
        id: feature.id ?? 'unknown',
        event: feature.event ?? 'Weather alert',
        severity: feature.severity ?? 'unknown',
        effective: feature.effective ?? '',
        headline: feature.headline ?? '',
      }))
      .slice(0, 10)
    return { status: 'live', fetchedAt: now.toISOString(), items }
  } catch (cause) {
    return {
      status: 'fallback',
      fetchedAt: now.toISOString(),
      items: [],
      note: `Alerts unavailable (${String(cause)}).`,
    }
  }
}
