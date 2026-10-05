'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Block } from '@/lib/types'

/**
 * Create form. Real POST to /api/sheets, with truthful loading, success and failure states.
 * On success it navigates to the new sheet, so the user always lands on the persisted result.
 */
export function CreateSheetForm({ blocks }: { blocks: readonly Block[] }) {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)
  const [blockId, setBlockId] = useState(blocks[0]?.id ?? '')
  const [nightOf, setNightOf] = useState(today)
  const [notes, setNotes] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setState('busy')
    setError('')
    try {
      const response = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockId, nightOf, notes, actor: 'grower' }),
      })
      const body = (await response.json()) as {
        sheet?: { id: string }
        error?: { code: string; message: string }
      }
      if (!response.ok || body.sheet === undefined) {
        setState('error')
        setError(body.error?.message ?? `Request failed with status ${response.status}.`)
        return
      }
      setState('idle')
      setNotes('')
      router.push(`/sheets/${body.sheet.id}`)
      router.refresh()
    } catch (cause) {
      setState('error')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="block">Block</label>
        <select id="block" value={blockId} onChange={(e) => setBlockId(e.target.value)} required>
          {blocks.map((block) => (
            <option key={block.id} value={block.id}>
              {block.label} — {block.cropStage}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="night">Night of</label>
        <input
          id="night"
          type="date"
          value={nightOf}
          onChange={(e) => setNightOf(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          value={notes}
          maxLength={600}
          placeholder="Anything the morning crew should know."
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <button className="btn" data-variant="primary" type="submit" disabled={state === 'busy'}>
        {state === 'busy' ? 'Creating…' : 'Create frost sheet'}
      </button>

      {state === 'error' && (
        <p className="notice" data-tone="error" style={{ marginTop: '0.85rem' }} role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
