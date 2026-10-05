import Link from 'next/link'
import { assessFrostRisk } from '@/lib/engine'
import { getStore } from '@/lib/store'
import { fetchAlerts, fetchForecast } from '@/lib/weather'
import { SITE } from '@/lib/site'

export const dynamic = 'force-dynamic'

/**
 * The landing page carries real data, not a marketing hero: the first three blocks are scored
 * from the actual forecast on every request, so a visitor lands on live state.
 */
export default async function HomePage() {
  const store = await getStore()
  const blocks = (await store.listBlocks()).slice(0, 3)

  const scored = await Promise.all(
    blocks.map(async (block) => {
      const forecast = await fetchForecast(block)
      const alerts = await fetchAlerts(block.lat, block.lon)
      return {
        block,
        forecast,
        alerts,
        result: assessFrostRisk({
          points: forecast.points,
          thresholdC: block.thresholdC,
          cropStage: block.cropStage,
        }),
      }
    }),
  )

  const needsAction = scored.filter((row) => row.result.recommendation !== 'no-action')

  return (
    <div className="log">
      <aside className="gutter">
        <h2>Tonight&rsquo;s watch</h2>
        <p>
          {needsAction.length === 0
            ? 'No monitored block is expecting damaging cold in the current window.'
            : `${needsAction.length} of ${scored.length} monitored blocks are expecting damaging cold.`}
        </p>
        <p>
          Scores are recomputed from the public forecast on every page load, and the engine
          version is printed with every verdict.
        </p>
        <Link className="btn" data-variant="primary" href="/sheets">
          Start a frost sheet
        </Link>
      </aside>

      <div>
        <section className="hero">
          <span className="eyebrow">Frost decision desk</span>
          <h1>{SITE.tagline}</h1>
          <p>{SITE.description}</p>
          <p>
            <Link className="btn" data-variant="primary" href="/sheets">
              Create a frost sheet
            </Link>{' '}
            <a
              className="repo-link"
              href={SITE.repo}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View source — ${SITE.name} on GitHub (opens in a new tab)`}
            >
              View source on GitHub
            </a>
          </p>
        </section>

        <section className="panel">
          <h2>Live state — {scored[0]?.forecast.source ?? 'forecast'}</h2>
          <div className="grid grid-2">
            {scored.map(({ block, forecast, alerts, result }) => (
              <article key={block.id} className="stat">
                <span className="stat-label">{block.label}</span>
                <p className="stat-value" style={{ color: toneFor(result.band) }}>
                  {result.score}
                  <span style={{ fontSize: '0.9rem', color: 'var(--color-frost-faint)' }}>/100</span>
                </p>
                <p style={{ margin: '0.35rem 0', fontSize: '0.85rem' }}>
                  {result.recommendation} · min {result.minTempC}°C
                </p>
                <span className="tag" data-tone={forecast.status === 'live' ? 'live' : 'fallback'}>
                  {forecast.status}
                </span>{' '}
                {alerts.items.length > 0 && (
                  <span className="tag" data-tone="risk">
                    {alerts.items.length} NWS alert{alerts.items.length === 1 ? '' : 's'}
                  </span>
                )}
              </article>
            ))}
          </div>
          <p className="notice" style={{ marginTop: '1rem' }}>
            Automated guidance from a public forecast, not an agronomic recommendation. Confirm with
            your own field sensors before acting.
          </p>
        </section>

        <section className="grid grid-2" style={{ marginTop: '1rem' }}>
          <article className="panel">
            <h2>What it does</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-frost-dim)' }}>
              Every score is a weighted mean of five sub-scores — minimum temperature, hours below
              threshold, clear-sky cooling, wind mixing and ground wetness — each itemised so you
              can disagree with one number instead of the whole verdict.
            </p>
          </article>
          <article className="panel">
            <h2>Why it is sealed</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-frost-dim)' }}>
              Each sheet keeps a SHA-384 hash chain over its own decisions, so a recommendation made
              at 21:00 can be replayed later and shown not to have been quietly edited.
            </p>
          </article>
        </section>
      </div>
    </div>
  )
}

function toneFor(band: string): string {
  if (band === 'severe' || band === 'high') return 'var(--color-risk)'
  if (band === 'moderate') return 'var(--color-lamp)'
  return 'var(--color-clear)'
}
