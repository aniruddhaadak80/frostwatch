import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SheetActions } from '@/components/SheetActions'
import { assessFrostRisk } from '@/lib/engine'
import { getOwnerId } from '@/lib/session'
import { getStore } from '@/lib/store'
import { fetchAlerts, fetchForecast } from '@/lib/weather'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return { title: `Sheet ${id}` }
}

export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ownerId = await getOwnerId()
  const store = await getStore()
  const sheet = await store.getSheet(id, ownerId)
  if (sheet === null) notFound()

  const blocks = await store.listBlocks()
  const block = blocks.find((candidate) => candidate.id === sheet.blockId)
  const forecast = block === undefined ? null : await fetchForecast(block)
  const alerts = block === undefined ? null : await fetchAlerts(block.lat, block.lon)
  const result =
    forecast === null || block === undefined
      ? null
      : assessFrostRisk({
          points: forecast.points,
          thresholdC: sheet.thresholdC,
          cropStage: sheet.cropStage,
        })

  return (
    <div className="log">
      <aside className="gutter">
        <h2>Record</h2>
        <p className="mono">{sheet.id}</p>
        <p>
          Created {sheet.createdAt}
          <br />
          Updated {sheet.updatedAt}
        </p>
        <p className="mono">seal {sheet.seal.slice(0, 20)}…</p>
        <p>{sheet.eventCount} audit event(s)</p>
      </aside>

      <div>
        <section className="hero">
          <span className="eyebrow">
            {sheet.blockLabel} · night of {sheet.nightOf}
          </span>
          <h1>{sheet.blockLabel}</h1>
          <p>
            <Link href="/sheets">← all sheets</Link>
          </p>
        </section>

        <section className="panel">
          <h2>Decision</h2>
          <SheetActions sheet={sheet} />
          {sheet.notes.trim() !== '' && (
            <p className="notice" style={{ marginTop: '0.85rem' }}>
              {sheet.notes}
            </p>
          )}
        </section>

        {result !== null && forecast !== null && (
          <>
            <section className="panel">
              <h2>
                Engine verdict · {result.score}/100 ({result.band})
              </h2>
              <p style={{ fontSize: '1.05rem', marginTop: 0 }}>{result.headline}</p>
              <div className="grid grid-3" style={{ marginBottom: '1rem' }}>
                <div className="stat">
                  <span className="stat-label">Minimum</span>
                  <p className="stat-value">{result.minTempC}°C</p>
                </div>
                <div className="stat">
                  <span className="stat-label">Hours below</span>
                  <p className="stat-value">{result.hoursBelow}</p>
                </div>
                <div className="stat">
                  <span className="stat-label">Recommendation</span>
                  <p className="stat-value" style={{ fontSize: '1rem' }}>
                    {result.recommendation}
                  </p>
                </div>
              </div>

              <div className="grid grid-3" style={{ marginBottom: '1rem' }}>
                {result.factors.map((factor) => (
                  <div className="factor" key={factor.id}>
                    <span className="factor-name">{factor.label}</span>
                    <span className="factor-value">+{factor.contribution}</span>
                    <span className="factor-why">
                      {factor.value} · weight {factor.weight}
                    </span>
                    <span className="factor-bar" data-tone={factor.id === 'radiation' ? 'cold' : 'warm'}>
                      <span style={{ width: `${Math.min(100, factor.contribution * 4)}%` }} />
                    </span>
                  </div>
                ))}
              </div>

              <p className="notice">{result.disclaimer}</p>
            </section>

            <section className="panel">
              <h2>Forecast provenance</h2>
              <p style={{ fontSize: '0.9rem' }}>
                <span className="tag" data-tone={forecast.status === 'live' ? 'live' : 'fallback'}>
                  {forecast.status}
                </span>{' '}
                {forecast.source} · fetched {forecast.fetchedAt} · {forecast.points.length} hours
              </p>
              {forecast.note !== undefined && (
                <p className="notice" data-tone="error" style={{ marginTop: '0.5rem' }}>
                  {forecast.note}
                </p>
              )}
              <p style={{ fontSize: '0.78rem', color: 'var(--color-frost-faint)' }}>
                {forecast.attribution} ·{' '}
                <a href={forecast.sourceUrl} target="_blank" rel="noopener noreferrer">
                  upstream request
                </a>
              </p>
              {alerts !== null && alerts.items.length > 0 && (
                <ul style={{ marginTop: '0.75rem', paddingLeft: '1.1rem' }}>
                  {alerts.items.map((alert) => (
                    <li key={alert.id} style={{ fontSize: '0.85rem' }}>
                      <strong>{alert.event}</strong> — {alert.headline}
                    </li>
                  ))}
                </ul>
              )}
              {alerts?.items.length === 0 && (
                <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  No active NWS alerts for this point.
                </p>
              )}
            </section>
          </>
        )}

        <section className="panel">
          <h2>Audit trail</h2>
          <table className="log-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Kind</th>
                <th>At</th>
                <th>Actor</th>
                <th>Seal</th>
              </tr>
            </thead>
            <tbody>
              {(await store.eventsFor(sheet.id)).map((event) => (
                <tr key={event.seq}>
                  <td className="mono">{event.seq}</td>
                  <td>{event.kind}</td>
                  <td className="mono">{event.at}</td>
                  <td>{event.actor}</td>
                  <td className="mono" title={event.seal}>
                    {event.seal.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
