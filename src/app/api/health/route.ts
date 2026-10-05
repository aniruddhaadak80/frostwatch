import { NextResponse } from 'next/server'
import { fail, ok } from '@/lib/api'
import { adapterName, getStore } from '@/lib/store'
import { ENGINE_VERSION } from '@/lib/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Health that checks the real store.
 *
 * It runs a query rather than returning a static object, because a health endpoint that
 * cannot fail is decoration. A production build with no DATABASE_URL is reported as a
 * failure, not silently downgraded to the embedded adapter.
 */
export async function GET() {
  const checks: { name: string; status: 'ok' | 'warn' | 'fail'; detail: string }[] = []

  let storeKind = 'unknown'
  try {
    storeKind = adapterName()
    checks.push({ name: 'adapter', status: 'ok', detail: storeKind })
  } catch (cause) {
    checks.push({ name: 'adapter', status: 'fail', detail: String(cause) })
    return NextResponse.json(
      { ok: false, version: ENGINE_VERSION, store: storeKind, checks },
      { status: 503 },
    )
  }

  try {
    const store = await getStore()
    const started = Date.now()
    const blocks = await store.listBlocks()
    checks.push({
      name: 'store-write-path',
      status: 'ok',
      detail: `${store.kind} responded in ${Date.now() - started}ms with ${blocks.length} blocks`,
    })
  } catch (cause) {
    checks.push({ name: 'store-write-path', status: 'fail', detail: String(cause) })
  }

  const okAll = checks.every((check) => check.status !== 'fail')
  if (!okAll) return fail('STORE_UNAVAILABLE', 'One or more health checks failed.', 503)
  return ok({
    ok: true,
    name: 'frostwatch',
    version: ENGINE_VERSION,
    store: storeKind,
    node: process.versions.node,
    checks,
  })
}
