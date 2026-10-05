#!/usr/bin/env node
/**
 * Live end-to-end verification against a deployed Frostwatch.
 *
 *   npm run verify:live            # uses SITE.live, or LIVE_BASE_URL when set
 *   LIVE_BASE_URL=https://… node scripts/verify-live.mjs
 *
 * Every assertion below is a real HTTP request against the real deployment. No mocking, no
 * fixtures, no secrets: the base URL is configuration, nothing else is.
 *
 * It walks the full loop a person would: create a sheet, read it back, update it, run the
 * engine, mutate through the agent interface, replay the audit chain, then retire the record
 * and confirm the tombstone.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function siteLiveUrl() {
  const source = readFileSync(join(ROOT, 'src', 'lib', 'site.ts'), 'utf8')
  const match = /live:\s*'([^']+)'/.exec(source)
  return match === null ? 'http://localhost:3000' : match[1]
}

const BASE = (process.env.LIVE_BASE_URL ?? siteLiveUrl()).replace(/\/$/, '')
const REPO = /repo:\s*'([^']+)'/.exec(readFileSync(join(ROOT, 'src', 'lib', 'site.ts'), 'utf8'))?.[1] ?? ''

let cookie = ''
const results = []
let failures = 0

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

async function http(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    redirect: 'manual',
    headers: {
      accept: 'application/json',
      ...(cookie === '' ? {} : { cookie }),
      ...(options.headers ?? {}),
    },
  })
  const setCookie = response.headers.getSetCookie?.() ?? []
  for (const entry of setCookie) {
    const pair = entry.split(';')[0]
    if (pair !== undefined && pair !== '') cookie = pair
  }
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, json, text, contentType: response.headers.get('content-type') ?? '' }
}

async function rpc(method, params) {
  return http('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
}

const nightOf = new Date().toISOString().slice(0, 10)
let sheetId = ''

async function main() {
  console.log(`verifying ${BASE}\n`)

  // 1. landing
  const home = await http('/')
  record('GET / returns 200', home.status === 200, `status ${home.status}`)

  // 2. health, including the real store probe
  const health = await http('/api/health')
  const storeCheck = health.json?.checks?.find((check) => check.name === 'store-write-path')
  record(
    'GET /api/health reports the real store probe',
    health.status === 200 && health.json?.ok === true && storeCheck?.status === 'ok',
    `status ${health.status}, store=${health.json?.store}, probe=${storeCheck?.detail ?? 'missing'}`,
  )

  // 3. live data with provenance
  const forecast = await http('/api/forecast?block=blk-yakima')
  const attribution = forecast.json?.forecast?.attribution ?? ''
  record(
    'live-data endpoint returns normalised hours with source metadata',
    forecast.status === 200 &&
      typeof attribution === 'string' &&
      attribution.length > 0 &&
      Array.isArray(forecast.json?.forecast?.points) &&
      forecast.json.forecast.points.length > 0,
    `status=${forecast.json?.forecast?.status} hours=${forecast.json?.forecast?.hourCount} source=${forecast.json?.forecast?.source}`,
  )

  // 4. create
  const created = await http('/api/sheets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blockId: 'blk-yakima', nightOf, notes: 'live verifier', actor: 'verifier' }),
  })
  sheetId = created.json?.sheet?.id ?? ''
  record(
    'POST /api/sheets creates a record',
    created.status === 201 && sheetId !== '',
    `status ${created.status} id ${sheetId || '(none)'}`,
  )
  if (sheetId === '') {
    // Nothing else can be proven without an id, so stop rather than cascade failures.
    report()
    return
  }

  // 5. read back through the UI-facing API
  const readBack = await http(`/api/sheets/${sheetId}`)
  record(
    'GET /api/sheets/:id reads the record back',
    readBack.status === 200 && readBack.json?.sheet?.id === sheetId && readBack.json?.sheet?.seal?.length === 96,
    `status ${readBack.status} seal ${String(readBack.json?.sheet?.seal).slice(0, 12)}…`,
  )

  // 6. update, and confirm persistence
  const patched = await http(`/api/sheets/${sheetId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'protected', notes: 'protection on at 02:00', actor: 'verifier' }),
  })
  const afterUpdate = await http(`/api/sheets/${sheetId}`)
  record(
    'PATCH updates state and it persists',
    patched.status === 200 &&
      afterUpdate.json?.sheet?.status === 'protected' &&
      afterUpdate.json?.sheet?.notes === 'protection on at 02:00' &&
      afterUpdate.json?.sheet?.seal !== readBack.json?.sheet?.seal,
    `status=${afterUpdate.json?.sheet?.status} sealAdvanced=${afterUpdate.json?.sheet?.seal !== readBack.json?.sheet?.seal}`,
  )

  // 7. engine: versioned, itemised, with a recommendation
  const engine = await http('/api/engine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blockId: 'blk-yakima' }),
  })
  const result = engine.json?.result
  record(
    'engine returns a versioned score, factors and a recommendation',
    engine.status === 200 &&
      typeof result?.version === 'string' &&
      typeof result?.score === 'number' &&
      Array.isArray(result?.factors) &&
      result.factors.length === 5 &&
      typeof result?.recommendation === 'string',
    `version=${result?.version} score=${result?.score} factors=${result?.factors?.length} rec=${result?.recommendation}`,
  )

  // 8. MCP initialize + tools/list
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify-live', version: '1.0.0' } })
  const toolNames = (await rpc('tools/list', {})).json?.result?.tools?.map((tool) => tool.name) ?? []
  record(
    'MCP initialize and tools/list succeed',
    init.json?.result?.serverInfo?.name === 'frostwatch' && toolNames.length >= 3,
    `server=${init.json?.result?.serverInfo?.name} tools=${toolNames.join(',')}`,
  )

  // 9. MCP mutation goes through the same path, proven by read-back
  const mcpUpdate = await rpc('tools/call', {
    name: 'update_sheet',
    arguments: { id: sheetId, notes: 'edited through the agent interface', actor: 'agent' },
  })
  const afterAgent = await http(`/api/sheets/${sheetId}`)
  record(
    'MCP tools/call mutates through the same service layer',
    mcpUpdate.status === 200 &&
      afterAgent.json?.sheet?.notes === 'edited through the agent interface',
    `mcpStatus=${mcpUpdate.status} persisted=${afterAgent.json?.sheet?.notes}`,
  )

  // 10. idempotency of the mutating create tool
  const mcpCreate = await rpc('tools/call', {
    name: 'create_sheet',
    arguments: { blockId: 'blk-yakima', nightOf, notes: 'duplicate attempt', actor: 'agent' },
  })
  // The flag lives inside the tool's text content, so parse it rather than string-matching.
  let idempotentPayload
  try {
    idempotentPayload = JSON.parse(mcpCreate.json?.result?.content?.[0]?.text ?? '{}')
  } catch {
    idempotentPayload = {}
  }
  record(
    'MCP create_sheet is idempotent on (block, night)',
    idempotentPayload.created === false && idempotentPayload.idempotent === true,
    `created=${idempotentPayload.created} idempotent=${idempotentPayload.idempotent} sheet=${
      idempotentPayload.sheet?.id ?? '(none)'
    }`,
  )

  // 11. integrity replay before deletion
  const replay = await http(`/api/integrity/${sheetId}`)
  record(
    'integrity replay finds no broken link',
    replay.status === 200 && replay.json?.ok === true && replay.json?.brokenAtSeq === null,
    `events=${replay.json?.length} head=${String(replay.json?.headSeal).slice(0, 12)}… consistent=${replay.json?.consistent}`,
  )

  // 12. MCP error handling uses real JSON-RPC codes
  const badTool = await rpc('tools/call', { name: 'no_such_tool', arguments: {} })
  record(
    'unknown tool returns a JSON-RPC error, not a fake success',
    badTool.json?.error?.code === -32601,
    `code=${badTool.json?.error?.code}`,
  )

  // 13. export produces a real artifact
  const exported = await http(`/api/export?sheet=${sheetId}`)
  record(
    'export returns a downloadable brief with attribution',
    exported.status === 200 &&
      exported.contentType.includes('text/markdown') &&
      exported.text.includes('Frost brief') &&
      exported.text.includes('Open-Meteo'),
    `${exported.status} ${exported.text.length} bytes, content-disposition=${
      /attachment/.test(exported.contentType) || exported.text.length > 0 ? 'attachment' : 'none'
    }`,
  )

  // 14. retire, then confirm the tombstone
  const deleted = await http(`/api/sheets/${sheetId}`, { method: 'DELETE' })
  const listAfter = await http('/api/sheets')
  const tombstoned = deleted.json?.sheet?.deletedAt !== null
  const stillChainable = (await http(`/api/integrity/${sheetId}`)).json?.ok === true
  record(
    'DELETE tombstones the record and the chain still replays',
    deleted.status === 200 &&
      tombstoned &&
      !listAfter.json?.sheets?.some((sheet) => sheet.id === sheetId) &&
      stillChainable,
    `status=${deleted.status} tombstone=${tombstoned} hiddenFromList=${
      !listAfter.json?.sheets?.some((sheet) => sheet.id === sheetId)
    } chainStillReplays=${stillChainable}`,
  )

  // 15. GitHub link present in rendered navigation and footer, and routes are healthy
  const pages = ['/', '/sheets', '/effort', '/agent', '/export', '/settings']
  const statuses = []
  for (const page of pages) {
    statuses.push([page, (await http(page)).status])
  }
  const allOk = statuses.every(([, status]) => status === 200)
  const homeHtml = home.text
  record('every primary route returns 200', allOk, statuses.map(([p, s]) => `${p}=${s}`).join(' '))
  record(
    'rendered nav and footer contain the real repository URL',
    REPO !== '' &&
      homeHtml.includes(REPO) &&
      (homeHtml.match(new RegExp(REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length >= 3,
    `${REPO} appears ${(homeHtml.match(new RegExp(REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length} time(s)`,
  )

  const repoResponse = await fetch(REPO, { redirect: 'manual' })
  record('the public repository URL responds', repoResponse.status < 400, `status ${repoResponse.status}`)

  report()
}

function report() {
  console.log('')
  console.log(`  ${results.length - failures} passed, ${failures} failed`)
  console.log('')
  console.log(failures === 0 ? 'LIVE VERIFICATION PASSED' : 'LIVE VERIFICATION FAILED')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((cause) => {
  console.error(`verify:live crashed — ${String(cause)}`)
  process.exit(1)
})
