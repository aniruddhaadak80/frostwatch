import { createSheetSchema, ok, readJson, toErrorResponse } from '@/lib/api'
import { getOwnerId } from '@/lib/session'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const ownerId = await getOwnerId()
    const includeDeleted = new URL(request.url).searchParams.get('deleted') === '1'
    const store = await getStore()
    const [sheets, blocks] = await Promise.all([
      store.listSheets(ownerId, { includeDeleted }),
      store.listBlocks(),
    ])
    return ok({ sheets, blocks, ownerId })
  } catch (cause) {
    return toErrorResponse(cause)
  }
}

export async function POST(request: Request) {
  try {
    const body = createSheetSchema.parse(await readJson(request))
    const ownerId = await getOwnerId()
    const store = await getStore()
    const sheet = await store.createSheet({
      ownerId,
      blockId: body.blockId,
      nightOf: body.nightOf,
      notes: body.notes,
      actor: body.actor,
      at: new Date().toISOString(),
    })
    return ok({ sheet }, 201)
  } catch (cause) {
    return toErrorResponse(cause)
  }
}
