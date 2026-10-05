import type { Metadata } from 'next'
import Link from 'next/link'
import { getOwnerId } from '@/lib/session'
import { getStore } from '@/lib/store'
import { ENGINE_VERSION } from '@/lib/engine'
import { replayChain } from '@/lib/integrity'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Export' }

export default async function ExportPage() {
  const ownerId = await getOwnerId()
  const store = await getStore()
  const sheets = await store.listSheets(ownerId, { includeDeleted: true })
  const active = sheets.filter((sheet) => sheet.deletedAt === null)

  const replays = await Promise.all(
    sheets.map(async (sheet) => ({ sheet, replay: replayChain(await store.eventsFor(sheet.id)) })),
  )
  const broken = replays.filter((entry) => !entry.replay.ok)

  return (
    <div className="log">
      <aside className="gutter">
        <h2>Takeaway</h2>
        <p>
          The export is a markdown frost brief you can paste into a group chat or a notes app. It
          carries the forecast timestamps, the itemised factor arithmetic and the chain head.
        </p>
      </aside>

      <div>
        <section className="hero">
          <span className="eyebrow">Export</span>
          <h1>Sealed frost briefs</h1>
          <p>
            Every brief states the engine version ({ENGINE_VERSION}) so a number can always be traced
            back to the algorithm that produced it.
          </p>
          <p>
            <a className="btn" data-variant="primary" href="/api/export">
              Download all-block brief
            </a>
          </p>
        </section>

        <section className="panel">
          <h2>Per-sheet briefs</h2>
          {active.length === 0 ? (
            <div className="state" data-kind="empty">
              <span className="state-title">No active sheets to export.</span>
              The all-block brief above still works and covers every monitored block.
            </div>
          ) : (
            <table className="log-table">
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Block</th>
                  <th>Night</th>
                  <th>Status</th>
                  <th>Brief</th>
                </tr>
              </thead>
              <tbody>
                {active.map((sheet) => (
                  <tr key={sheet.id}>
                    <td className="mono">{sheet.id}</td>
                    <td>{sheet.blockLabel}</td>
                    <td className="mono">{sheet.nightOf}</td>
                    <td>{sheet.status}</td>
                    <td>
                      <a href={`/api/export?sheet=${sheet.id}`}>Download</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>Chain status</h2>
          {replays.length === 0 ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--color-frost-dim)' }}>
              No chains yet.
            </p>
          ) : broken.length === 0 ? (
            <p className="notice" data-tone="ok">
              All {replays.length} chain(s) replay cleanly, including retired sheets.
            </p>
          ) : (
            <div className="state" data-kind="error">
              <span className="state-title">
                {broken.length} chain(s) failed to replay.
              </span>
              {broken.map((entry) => (
                <p key={entry.sheet.id} className="mono" style={{ fontSize: '0.8rem' }}>
                  {entry.sheet.id} — broken at seq {entry.replay.brokenAtSeq}: {entry.replay.reason}
                </p>
              ))}
            </div>
          )}
          <p style={{ fontSize: '0.85rem', marginTop: '0.85rem' }}>
            <Link href="/sheets">Manage sheets →</Link>
          </p>
        </section>
      </div>
    </div>
  )
}
