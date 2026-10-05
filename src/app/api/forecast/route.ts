import { fail, ok, toErrorResponse } from '@/lib/api'
import { getStore } from '@/lib/store'
import { assessFrostRisk } from '@/lib/engine'
import { fetchAlerts, fetchForecast } from '@/lib/weather'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The live-data endpoint.
 *
 * Returns a real forecast for a real block, normalised, with provenance that says plainly
 * whether it is live or a fallback, plus the engine verdict computed from it. User sheets are
 * never touched by this route: fallback data can never overwrite anything a person created.
 */
export async function GET(request: Request) {
  try {
    const blockId = new URL(request.url).searchParams.get('block')
    if (blockId === null) return fail('VALIDATION_FAILED', 'Query parameter "block" is required.', 400)

    const store = await getStore()
    const block = (await store.listBlocks()).find((candidate) => candidate.id === blockId)
    if (block === undefined) return fail('BLOCK_UNKNOWN', `No block with id "${blockId}".`, 404)

    const [forecast, alerts] = await Promise.all([
      fetchForecast(block),
      fetchAlerts(block.lat, block.lon),
    ])

    const result = assessFrostRisk({
      points: forecast.points,
      thresholdC: block.thresholdC,
      cropStage: block.cropStage,
    })

    return ok({
      block,
      forecast: {
        status: forecast.status,
        fetchedAt: forecast.fetchedAt,
        source: forecast.source,
        sourceUrl: forecast.sourceUrl,
        attribution: forecast.attribution,
        hourCount: forecast.points.length,
        ...(forecast.note === undefined ? {} : { note: forecast.note }),
        points: forecast.points,
      },
      alerts,
      result,
    })
  } catch (cause) {
    return toErrorResponse(cause)
  }
}
