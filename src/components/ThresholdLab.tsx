'use client'

import { useMemo, useState } from 'react'
import { assessFrostRisk, type EngineResult } from '@/lib/engine'
import type { HourPoint } from '@/lib/types'

/**
 * THE SIGNATURE INTERACTION — the threshold lamp.
 *
 * Dragging the threshold re-derives the entire verdict client-side from the same engine the
 * API uses, so you can feel how much a single degree is worth. It is not decoration: the
 * verdict updates live, and the "record this" control writes the chosen threshold into a real
 * sheet through the real API.
 *
 * The chart is a hand-ruled hourly trace. Bars below the threshold line turn to risk colour,
 * which is the whole visual argument of the product in one row.
 */
export function ThresholdLab({
  points,
  baseThreshold,
  cropStage,
  blockLabel,
  blockId,
}: {
  points: readonly HourPoint[]
  baseThreshold: number
  cropStage: 'bud-break' | 'flowering' | 'fruit-set' | 'veraison'
  blockLabel: string
  blockId: string
}) {
  const [threshold, setThreshold] = useState(baseThreshold)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const result: EngineResult = useMemo(
    () => assessFrostRisk({ points, thresholdC: threshold, cropStage }),
    [points, threshold, cropStage],
  )

  const temps = points.map((point) => point.tempC)
  const floor = Math.min(...temps, 0) - 2
  const ceiling = Math.max(...temps, 1) + 2
  const span = Math.max(1, ceiling - floor)

  async function record() {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const nightOf = new Date().toISOString().slice(0, 10)
      const response = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blockId,
          nightOf,
          notes: `Threshold set to ${threshold}°C at ${result.score}/100 by the threshold lamp.`,
          actor: 'grower',
        }),
      })
      const body = (await response.json()) as {
        sheet?: { id: string }
        error?: { message: string }
      }
      if (!response.ok || body.sheet === undefined) {
        setError(body.error?.message ?? `Request failed with status ${response.status}.`)
        return
      }
      await fetch(`/api/sheets/${body.sheet.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: result.recommendation === 'run-protection' ? 'protected' : 'watching',
          actor: 'grower',
        }),
      })
      setSaved(`Recorded on sheet ${body.sheet.id}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const trace = points.slice(0, 36)

  return (
    <div>
      <div className="ruler" role="img" aria-label={`Hourly temperature trace for ${blockLabel}`}>
        {trace.map((point) => {
          const height = Math.max(3, ((point.tempC - floor) / span) * 100)
          return (
            <span className="ruler-hour" key={point.at} title={`${point.at} · ${point.tempC}°C`}>
              <span
                className="ruler-bar"
                data-below={String(point.tempC <= threshold)}
                style={{ height: `${height}%` }}
              />
            </span>
          )
        })}
      </div>
      <div className="ruler-axis">
        <span>{trace[0]?.at.replace('T', ' ').slice(0, 16) ?? ''}</span>
        <span>
          threshold {threshold}°C · trace spans {floor.toFixed(1)}°C to {ceiling.toFixed(1)}°C
        </span>
        <span>{trace[trace.length - 1]?.at.replace('T', ' ').slice(0, 16) ?? ''}</span>
      </div>

      <div className="field" style={{ marginTop: '1.25rem' }}>
        <label htmlFor="threshold">
          Frost threshold — {threshold}°C (block default {baseThreshold}°C)
        </label>
        <input
          id="threshold"
          type="range"
          min={Number(floor.toFixed(1))}
          max={Number(ceiling.toFixed(1))}
          step={0.5}
          value={threshold}
          onChange={(event) => setThreshold(Number(event.target.value))}
          style={{ width: '100%', accentColor: 'var(--color-lamp)' }}
        />
      </div>

      <div className="grid grid-3">
        <div className="stat">
          <span className="stat-label">Score</span>
          <p className="stat-value" style={{ color: tone(result.band) }}>
            {result.score}
          </p>
        </div>
        <div className="stat">
          <span className="stat-label">Band</span>
          <p className="stat-value" style={{ fontSize: '1.1rem' }}>
            {result.band}
          </p>
        </div>
        <div className="stat">
          <span className="stat-label">Recommendation</span>
          <p className="stat-value" style={{ fontSize: '1.1rem' }}>
            {result.recommendation}
          </p>
        </div>
      </div>

      <p style={{ fontSize: '0.95rem', marginTop: '0.85rem' }}>{result.headline}</p>

      <div className="grid grid-2" style={{ marginTop: '0.5rem' }}>
        {result.factors.map((factor) => (
          <div className="factor" key={factor.id}>
            <span className="factor-name">{factor.label}</span>
            <span className="factor-value">
              +{factor.contribution} / {factor.weight}
            </span>
            <span className="factor-why">{factor.value}</span>
            <span className="factor-bar">
              <span style={{ width: `${Math.min(100, (factor.contribution / factor.weight) * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>

      <p style={{ marginTop: '1rem' }}>
        <button className="btn" data-variant="primary" onClick={record} disabled={busy}>
          {busy ? 'Recording…' : 'Record this threshold on a real sheet'}
        </button>
      </p>

      {saved !== null && (
        <p className="notice" data-tone="ok" role="status">
          {saved}
        </p>
      )}
      {error !== null && (
        <p className="notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
      <p className="notice" style={{ marginTop: '0.85rem' }}>{result.disclaimer}</p>
    </div>
  )
}

function tone(band: string): string {
  if (band === 'severe' || band === 'high') return 'var(--color-risk)'
  if (band === 'moderate') return 'var(--color-lamp)'
  return 'var(--color-clear)'
}
