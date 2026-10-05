import type { Metadata } from 'next'
import Link from 'next/link'
import { ThresholdLab } from '@/components/ThresholdLab'
import { getStore } from '@/lib/store'
import { fetchForecast } from '@/lib/weather'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Effort engine' }

export default async function EffortPage({
  searchParams,
}: {
  searchParams: Promise<{ block?: string }>
}) {
  const { block: requested } = await searchParams
  const store = await getStore()
  const blocks = await store.listBlocks()
  const block = blocks.find((candidate) => candidate.id === requested) ?? blocks[0]

  if (block === undefined) {
    return (
      <div className="state" data-kind="error">
        <span className="state-title">No blocks are configured.</span>
      </div>
    )
  }

  const forecast = await fetchForecast(block)

  return (
    <div className="log">
      <aside className="gutter">
        <h2>Threshold lamp</h2>
        <p>
          Drag the threshold and watch the verdict re-derive. Every number comes from the same
          engine the API and the agent tool call.
        </p>
        <nav className="nav" aria-label="Choose a block">
          {blocks.map((candidate) => (
            <Link
              key={candidate.id}
              href={`/effort?block=${candidate.id}`}
              aria-current={candidate.id === block.id ? 'page' : undefined}
              style={{ display: 'block', fontSize: '0.82rem' }}
            >
              {candidate.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div>
        <section className="hero">
          <span className="eyebrow">Analysis</span>
          <h1>Effort engine</h1>
          <p>
            {block.label} at {block.lat}, {block.lon}. Forecast is{' '}
            <span className="tag" data-tone={forecast.status === 'live' ? 'live' : 'fallback'}>
              {forecast.status}
            </span>{' '}
            from {forecast.source}, fetched {forecast.fetchedAt}.
          </p>
          {forecast.note !== undefined && (
            <p className="notice" data-tone="error">
              {forecast.note}
            </p>
          )}
        </section>

        <section className="panel">
          <h2>Hourly trace · {forecast.points.length} hours</h2>
          {forecast.points.length === 0 ? (
            <div className="state" data-kind="error">
              <span className="state-title">No usable forecast hours.</span>
              Nothing to score.
            </div>
          ) : (
            <ThresholdLab
              points={forecast.points}
              baseThreshold={block.thresholdC}
              cropStage={block.cropStage}
              blockLabel={block.label}
              blockId={block.id}
            />
          )}
        </section>
      </div>
    </div>
  )
}
