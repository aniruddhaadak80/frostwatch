import { fail, ok, readJson, toErrorResponse, updateSheetSchema } from '@/lib/api'
import { getOwnerId } from '@/lib/session'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** In Next 16, route context params are a Promise. */
type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params
    const ownerId = await getOwnerId()
    const store = await getStore()
    const sheet = await store.getSheet(id, ownerId)
    // Scoped by owner on purpose: a valid sheet id belonging to somebody else is a 404, not a 403.
    if (sheet === null) return fail('SHEET_NOT_FOUND', `No sheet "${id}" for this session.`, 404)
    const events = await store.eventsFor(id)
    return ok({ sheet, events })
  } catch (cause) {
    return toErrorResponse(cause)
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params
    const body = updateSheetSchema.parse(await readJson(request))
    const ownerId = await getOwnerId()
    const store = await getStore()
    const sheet = await store.updateSheet(id, ownerId, {
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(body.notes === undefined ? {} : { notes: body.notes }),
      actor: body.actor,
      at: new Date().toISOString(),
    })
    return ok({ sheet })
  } catch (cause) {
    return toErrorResponse(cause)
  }
}

/** Tombstones rather than removing the row, so the audit chain still replays. */
export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params
    const ownerId = await getOwnerId()
    const store = await getStore()
    const sheet = await store.deleteSheet(id, ownerId, new Date().toISOString(), 'grower')
    return ok({ sheet, tombstone: true })
  } catch (cause) {
    return toErrorResponse(cause)
  }
}
