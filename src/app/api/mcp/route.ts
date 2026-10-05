import { NextResponse } from 'next/server'
import { createSheetSchema, updateSheetSchema } from '@/lib/api'
import { assessFrostRisk, ENGINE_VERSION } from '@/lib/engine'
import { getOwnerId } from '@/lib/session'
import { getStore, StoreError } from '@/lib/store'
import { fetchAlerts, fetchForecast } from '@/lib/weather'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * MCP-style JSON-RPC 2.0 over HTTP.
 *
 * Three methods: initialize, tools/list, tools/call. Errors use the JSON-RPC error object
 * with real codes (-32602 invalid params, -32601 unknown method, -32603 internal), never a
 * 200 with an error string in the body.
 *
 * Every mutation runs through the same store methods the UI uses and is scoped to the
 * caller's anonymous owner id, so an agent can never reach another session's sheets. The
 * mutating tools accept an idempotency key: replaying the same call returns the sheet that
 * already exists instead of creating a second one.
 */

const PROTOCOL_VERSION = '2025-06-18'

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const TOOLS = [
  {
    name: 'list_blocks',
    description:
      'List the monitored growing blocks with their real coordinates, crop stage and frost threshold. Use this before scoring anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_sheets',
    description:
      'List the frost sheets owned by this session, most recently updated first. Use this to find a sheet id to inspect or update.',
    inputSchema: {
      type: 'object',
      properties: { includeDeleted: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'assess_frost_risk',
    description:
      'Fetch the live forecast for a block and score frost risk with the deterministic engine. Returns a versioned score, itemised factors, cold windows and a recommendation.',
    inputSchema: {
      type: 'object',
      properties: { blockId: { type: 'string' } },
      required: ['blockId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_sheet',
    description:
      'Create a frost sheet for one block and one night. Mutating. Idempotent on (blockId, nightOf): repeating the call returns the existing sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        blockId: { type: 'string' },
        nightOf: { type: 'string', description: 'YYYY-MM-DD' },
        notes: { type: 'string' },
        actor: { type: 'string' },
      },
      required: ['blockId', 'nightOf'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_sheet',
    description:
      'Record a decision or edit notes on an existing sheet. Mutating. Writes an audit event and advances the seal chain.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['watching', 'protected', 'stood-down', 'retired'] },
        notes: { type: 'string' },
        actor: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'replay_sheet',
    description:
      'Recompute a sheet audit chain and report the first broken link, with the algorithm used.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
] as const

function rpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result }
}

export async function POST(request: Request) {
  let body: RpcRequest
  try {
    body = (await request.json()) as RpcRequest
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }

  const id = body.id ?? null
  const method = body.method

  if (body.jsonrpc !== '2.0' || typeof method !== 'string') {
    return NextResponse.json(rpcError(id, -32600, 'Invalid Request'), { status: 400 })
  }

  try {
    if (method === 'initialize') {
      return NextResponse.json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'frostwatch', version: ENGINE_VERSION },
        }),
      )
    }

    if (method === 'tools/list') {
      return NextResponse.json(rpcResult(id, { tools: TOOLS }))
    }

    if (method === 'tools/call') {
      const params = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
      if (typeof params.name !== 'string') {
        return NextResponse.json(rpcError(id, -32602, 'Invalid params: "name" is required'))
      }
      const args = params.arguments ?? {}
      const ownerId = await getOwnerId()
      const store = await getStore()

      switch (params.name) {
        case 'list_blocks':
          return NextResponse.json(
            rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(await store.listBlocks()) }] }),
          )

        case 'list_sheets': {
          const sheets = await store.listSheets(ownerId, {
            includeDeleted: args.includeDeleted === true,
          })
          return NextResponse.json(rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(sheets) }] }))
        }

        case 'assess_frost_risk': {
          const blockId = String(args.blockId ?? '')
          const block = (await store.listBlocks()).find((candidate) => candidate.id === blockId)
          if (block === undefined) {
            return NextResponse.json(rpcError(id, -32602, `Unknown blockId "${blockId}"`))
          }
          const forecast = await fetchForecast(block)
          const alerts = await fetchAlerts(block.lat, block.lon)
          const result = assessFrostRisk({
            points: forecast.points,
            thresholdC: block.thresholdC,
            cropStage: block.cropStage,
          })
          return NextResponse.json(
            rpcResult(id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    version: ENGINE_VERSION,
                    forecastStatus: forecast.status,
                    attribution: forecast.attribution,
                    alertCount: alerts.items.length,
                    result,
                  }),
                },
              ],
            }),
          )
        }

        case 'create_sheet': {
          const parsed = createSheetSchema.parse(args)
          try {
            const sheet = await store.createSheet({
              ownerId,
              blockId: parsed.blockId,
              nightOf: parsed.nightOf,
              notes: parsed.notes,
              actor: parsed.actor,
              at: new Date().toISOString(),
            })
            return NextResponse.json(
              rpcResult(id, {
                content: [{ type: 'text', text: JSON.stringify({ created: true, sheet }) }],
              }),
              { status: 201 },
            )
          } catch (cause) {
            // Idempotency: the same block and night is the same sheet, not a second sheet.
            if (cause instanceof StoreError && cause.code === 'SHEET_EXISTS') {
              const sheets = await store.listSheets(ownerId, { includeDeleted: true })
              const existing = sheets.find(
                (sheet) => sheet.blockId === parsed.blockId && sheet.nightOf === parsed.nightOf,
              )
              if (existing !== undefined) {
                return NextResponse.json(
                  rpcResult(id, {
                    content: [{ type: 'text', text: JSON.stringify({ created: false, idempotent: true, sheet: existing }) }],
                  }),
                )
              }
            }
            throw cause
          }
        }

        case 'update_sheet': {
          const sheetId = String(args.id ?? '')
          const parsed = updateSheetSchema.parse(args)
          const sheet = await store.updateSheet(sheetId, ownerId, {
            ...(parsed.status === undefined ? {} : { status: parsed.status }),
            ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
            actor: parsed.actor,
            at: new Date().toISOString(),
          })
          return NextResponse.json(rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ sheet }) }] }))
        }

        case 'replay_sheet': {
          const sheetId = String(args.id ?? '')
          const sheet = await store.getSheet(sheetId, ownerId)
          if (sheet === null) return NextResponse.json(rpcError(id, -32602, `Unknown sheet "${sheetId}"`))
          const { replayChain } = await import('@/lib/integrity')
          const replay = replayChain(await store.eventsFor(sheetId))
          return NextResponse.json(
            rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(replay) }] }),
          )
        }

        default:
          return NextResponse.json(rpcError(id, -32601, `Unknown tool "${params.name}"`))
      }
    }

    return NextResponse.json(rpcError(id, -32601, `Unknown method "${method}"`))
  } catch (cause) {
    if (cause instanceof StoreError) {
      return NextResponse.json(rpcError(id, -32602, `${cause.code}: ${cause.message}`))
    }
    if (cause instanceof Error && cause.name === 'ZodError') {
      return NextResponse.json(rpcError(id, -32602, 'Invalid params', String(cause.message)))
    }
    return NextResponse.json(rpcError(id, -32603, 'Internal error'))
  }
}
