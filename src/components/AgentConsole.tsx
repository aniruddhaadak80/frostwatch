'use client'

import { useState } from 'react'

interface Preset {
  readonly label: string
  readonly tool: string
  readonly args: Record<string, unknown>
}

/**
 * Live agent console.
 *
 * Every button issues a real JSON-RPC 2.0 request to /api/mcp and shows the raw response,
 * including JSON-RPC error objects. Nothing here is simulated.
 */
export function AgentConsole({ blockId, blockLabel }: { blockId: string; blockLabel: string }) {
  const [log, setLog] = useState<{ label: string; ok: boolean; body: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  async function rpc(method: string, params: Record<string, unknown>) {
    const response = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    })
    return (await response.json()) as Record<string, unknown>
  }

  async function run(label: string, tool: string, args: Record<string, unknown>) {
    setBusy(label)
    try {
      const body = await rpc('tools/call', { name: tool, arguments: args })
      const isError = body.error !== undefined
      setLog((entries) =>
        [{ label, ok: !isError, body: JSON.stringify(body, null, 2) }, ...entries].slice(0, 8),
      )
    } catch (cause) {
      setLog((entries) =>
        [
          {
            label,
            ok: false,
            body: JSON.stringify({ transportError: String(cause) }, null, 2),
          },
          ...entries,
        ].slice(0, 8),
      )
    } finally {
      setBusy(null)
    }
  }

  const presets: Preset[] = [
    { label: 'initialize', tool: 'list_blocks', args: {} },
    { label: 'assess_frost_risk', tool: 'assess_frost_risk', args: { blockId } },
    { label: 'create_sheet (mutating)', tool: 'create_sheet', args: { blockId, nightOf: new Date().toISOString().slice(0, 10), notes: 'Created from the agent console.', actor: 'agent' } },
    { label: 'list_sheets', tool: 'list_sheets', args: {} },
  ]

  return (
    <div>
      <p style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {presets.map((preset) => (
          <button
            key={preset.label}
            className="btn"
            disabled={busy !== null}
            onClick={() => run(preset.label, preset.tool, preset.args)}
          >
            {busy === preset.label ? 'Calling…' : preset.label}
          </button>
        ))}
        <button className="btn" data-variant="quiet" disabled={busy !== null} onClick={() => setLog([])}>
          Clear
        </button>
      </p>

      <p className="notice" style={{ marginTop: '0.85rem' }}>
        Target block: <span className="mono">{blockId}</span> — {blockLabel}. The mutating preset
        is idempotent on (block, night), so clicking it twice will not create a second sheet.
      </p>

      <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
        {log.length === 0 ? (
          <div className="state" data-kind="empty">
            <span className="state-title">No calls yet.</span>
            Run a preset above; the raw JSON-RPC response appears here.
          </div>
        ) : (
          log.map((entry, index) => (
            <div key={`${entry.label}-${index}`}>
              <p style={{ margin: '0 0 0.35rem' }}>
                <span className="tag" data-tone={entry.ok ? 'live' : 'risk'}>
                  {entry.ok ? 'result' : 'error'}
                </span>{' '}
                <span className="mono" style={{ fontSize: '0.85rem' }}>
                  {entry.label}
                </span>
              </p>
              <pre className="json">{entry.body}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
