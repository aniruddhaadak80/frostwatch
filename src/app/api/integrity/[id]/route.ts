import { fail, ok, toErrorResponse } from '@/lib/api'
import { getOwnerId } from '@/lib/session'
import { getStore } from '@/lib/store'
import { replayChain } from '@/lib/integrity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Replays a sheet's hash chain and reports the FIRST broken link, if any.
 *
 * Deliberately scoped to the owner: an integrity endpoint that could be pointed at somebody
 * else's sheet id would leak their history.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const ownerId = await getOwnerId()
    const store = await getStore()
    const sheet = await store.getSheet(id, ownerId)
    if (sheet === null) return fail('SHEET_NOT_FOUND', `No sheet "${id}" for this session.`, 404)

    const events = await store.eventsFor(id)
    const replay = replayChain(events)

    return ok({
      sheetId: id,
      ok: replay.ok,
      length: replay.length,
      headSeal: replay.headSeal,
      brokenAtSeq: replay.brokenAtSeq,
      reason: replay.reason,
      recordedSeal: sheet.seal,
      // The stored head must equal the recomputed head, or the sheet drifted from its own log.
      consistent: replay.ok && replay.headSeal === sheet.seal,
      algorithm: 'SHA-384(prevSeal || canonicalJson(event))',
    })
  } catch (cause) {
    return toErrorResponse(cause)
  }
}
