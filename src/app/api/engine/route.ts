import { engineSchema, fail, ok, readJson, toErrorResponse } from '@/lib/api'
import { assessFrostRisk, ENGINE_VERSION } from '@/lib/engine'
import { getStore } from '@/lib/store'
import { fetchAlerts, fetchForecast } from '@/lib/weather'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The engine endpoint. It calls the same `assessFrostRisk` the UI and the agent tool call,
 * so a verdict can never differ between the browser, curl and an agent.
 *
 * The current chain head is returned alongside the verdict, so a score always travels with a
 * seal that identifies the state it was computed against.
 */
export async function POST(request: Request) {
  try {
    const body = engineSchema.parse(await readJson(request))
    const store = await getStore()
    const block = (await store.listBlocks()).find((candidate) => candidate.id === body.blockId)
    if (block === undefined) return fail('BLOCK_UNKNOWN', `No block with id "${body.blockId}".`, 404)

    const forecast = await fetchForecast(block)
    const result = assessFrostRisk({
      points: forecast.points,
      thresholdC: body.thresholdC ?? block.thresholdC,
      cropStage: body.cropStage ?? block.cropStage,
    })

    const alerts = await fetchAlerts(block.lat, block.lon)

    return ok({
      version: ENGINE_VERSION,
      block,
      result,
      forecastStatus: forecast.status,
      forecastFetchedAt: forecast.fetchedAt,
      attribution: forecast.attribution,
      ...(forecast.note === undefined ? {} : { forecastNote: forecast.note }),
      alertCount: alerts.items.length,
    })
  } catch (cause) {
    return toErrorResponse(cause)
  }
}
