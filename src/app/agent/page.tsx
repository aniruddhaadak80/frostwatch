import type { Metadata } from 'next'
import { AgentConsole } from '@/components/AgentConsole'
import { getStore } from '@/lib/store'
import { SITE } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Agent' }

export default async function AgentPage() {
  const store = await getStore()
  const blocks = await store.listBlocks()
  const block = blocks[0]

  return (
    <div className="log">
      <aside className="gutter">
        <h2>Transport</h2>
        <p className="mono" style={{ wordBreak: 'break-all' }}>
          POST {SITE.live}/api/mcp
        </p>
        <p>
          JSON-RPC 2.0. Methods: <span className="mono">initialize</span>,{' '}
          <span className="mono">tools/list</span>, <span className="mono">tools/call</span>.
        </p>
        <p>Six tools: two read, one analysis, two mutating, one integrity replay.</p>
      </aside>

      <div>
        <section className="hero">
          <span className="eyebrow">Agent interface</span>
          <h1>Agent console</h1>
          <p>
            The mutating tools call the same store methods the UI does and are scoped to this
            browser session, so an agent can never reach another visitor&rsquo;s sheets.
          </p>
        </section>

        <section className="panel">
          <h2>Tools</h2>
          <table className="log-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Kind</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <ToolRow name="list_blocks" kind="read" purpose="Real coordinates, crop stage and thresholds." />
              <ToolRow name="list_sheets" kind="read" purpose="This session's sheets." />
              <ToolRow
                name="assess_frost_risk"
                kind="analysis"
                purpose="Live forecast scored by the deterministic engine."
              />
              <ToolRow name="create_sheet" kind="mutating" purpose="Idempotent on block and night." />
              <ToolRow name="update_sheet" kind="mutating" purpose="Records a decision, extends the chain." />
              <ToolRow name="replay_sheet" kind="read" purpose="Recomputes the SHA-384 chain." />
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Try it</h2>
          {block === undefined ? (
            <div className="state" data-kind="error">
              <span className="state-title">No blocks available.</span>
            </div>
          ) : (
            <AgentConsole blockId={block.id} blockLabel={block.label} />
          )}
        </section>
      </div>
    </div>
  )
}

function ToolRow({ name, kind, purpose }: { name: string; kind: string; purpose: string }) {
  return (
    <tr>
      <td className="mono">{name}</td>
      <td>
        <span className="tag" data-tone={kind === 'mutating' ? 'risk' : kind === 'analysis' ? 'fallback' : 'live'}>
          {kind}
        </span>
      </td>
      <td>{purpose}</td>
    </tr>
  )
}
