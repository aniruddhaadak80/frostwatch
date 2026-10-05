'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FrostSheet } from '@/lib/types'

/**
 * Every control here hits the real API and then refreshes from the server, so what the page
 * shows afterwards is persisted state rather than an optimistic guess. A failed call leaves the
 * sheet untouched and says why.
 */
export function SheetActions({ sheet }: { sheet: FrostSheet }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [replay, setReplay] = useState<string | null>(null)

  async function call(label: string, run: () => Promise<Response>) {
    setBusy(label)
    setError('')
    try {
      const response = await run()
      const body = (await response.json()) as { error?: { code: string; message: string } }
      if (!response.ok) {
        setError(body.error?.message ?? `Request failed with status ${response.status}.`)
        return
      }
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  function decide(status: FrostSheet['status']) {
    return call(status, () =>
      fetch(`/api/sheets/${sheet.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, actor: 'grower' }),
      }),
    )
  }

  async function verify() {
    setBusy('verify')
    setError('')
    try {
      const response = await fetch(`/api/integrity/${sheet.id}`, { cache: 'no-store' })
      const body = (await response.json()) as {
        ok?: boolean
        length?: number
        headSeal?: string
        reason?: string | null
        error?: { message: string }
      }
      if (!response.ok) {
        setError(body.error?.message ?? 'Replay request failed.')
        return
      }
      setReplay(
        body.ok === true
          ? `Verified ${body.length ?? 0} event(s). Head ${(body.headSeal ?? '').slice(0, 16)}…`
          : `Chain broken: ${body.reason ?? 'unknown reason'}`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <p style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          className="btn"
          data-variant="primary"
          disabled={busy !== null || sheet.deletedAt !== null}
          onClick={() => decide('protected')}
        >
          {busy === 'protected' ? 'Saving…' : 'Record: protection on'}
        </button>
        <button
          className="btn"
          disabled={busy !== null || sheet.deletedAt !== null}
          onClick={() => decide('stood-down')}
        >
          {busy === 'stood-down' ? 'Saving…' : 'Record: stood down'}
        </button>
        <button className="btn" data-variant="quiet" disabled={busy !== null} onClick={verify}>
          {busy === 'verify' ? 'Replaying…' : 'Replay audit chain'}
        </button>
        <a className="btn" data-variant="quiet" href={`/api/export?sheet=${sheet.id}`}>
          Download brief
        </a>
        <button
          className="btn"
          data-variant="danger"
          disabled={busy !== null || sheet.deletedAt !== null}
          onClick={() =>
            call('retire', () => fetch(`/api/sheets/${sheet.id}`, { method: 'DELETE' }))
          }
        >
          {busy === 'retire' ? 'Retiring…' : 'Retire sheet'}
        </button>
      </p>

      {replay !== null && (
        <p className="notice" data-tone={replay.startsWith('Verified') ? 'ok' : 'error'} role="status">
          {replay}
        </p>
      )}
      {error !== '' && (
        <p className="notice" data-tone="error" role="alert" style={{ marginTop: '0.5rem' }}>
          {error}
        </p>
      )}
      {sheet.deletedAt !== null && (
        <p className="notice" style={{ marginTop: '0.5rem' }}>
          Retired {sheet.deletedAt}. The row is kept as a tombstone so the audit chain still
          replays.
        </p>
      )}
    </div>
  )
}
