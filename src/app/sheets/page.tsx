import type { Metadata } from 'next'
import Link from 'next/link'
import { CreateSheetForm } from '@/components/CreateSheetForm'
import { getOwnerId } from '@/lib/session'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Frost sheets' }

export default async function SheetsPage() {
  const ownerId = await getOwnerId()
  const store = await getStore()
  const [sheets, blocks] = await Promise.all([store.listSheets(ownerId), store.listBlocks()])

  return (
    <div className="log">
      <aside className="gutter">
        <h2>Your blocks</h2>
        <p>
          {blocks.length} monitored blocks. Every forecast request is for the block&rsquo;s real
          coordinates.
        </p>
        <p>
          Sheets are scoped to this browser session, so nobody else can read or change them.
        </p>
      </aside>

      <div>
        <section className="hero">
          <span className="eyebrow">Workspace</span>
          <h1>Frost sheets</h1>
          <p>One sheet per block per night. Record a decision, then seal it.</p>
        </section>

        <section className="panel">
          <h2>New sheet</h2>
          <CreateSheetForm blocks={blocks} />
        </section>

        <section className="panel">
          <h2>Your sheets ({sheets.length})</h2>
          {sheets.length === 0 ? (
            <div className="state" data-kind="empty">
              <span className="state-title">No frost sheets yet.</span>
              Create one above and it will be persisted to the store immediately.
            </div>
          ) : (
            <table className="log-table">
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Block</th>
                  <th>Night</th>
                  <th>Status</th>
                  <th>Events</th>
                  <th>Seal</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((sheet) => (
                  <tr key={sheet.id}>
                    <td>
                      <Link href={`/sheets/${sheet.id}`} className="mono">
                        {sheet.id}
                      </Link>
                    </td>
                    <td>{sheet.blockLabel}</td>
                    <td className="mono">{sheet.nightOf}</td>
                    <td>
                      <span className="tag" data-tone={toneFor(sheet.status)}>
                        {sheet.status}
                      </span>
                    </td>
                    <td className="mono">{sheet.eventCount}</td>
                    <td className="mono" title={sheet.seal}>
                      {sheet.seal.slice(0, 12)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function toneFor(status: string): 'live' | 'risk' | 'calm' | 'fallback' {
  if (status === 'protected') return 'risk'
  if (status === 'stood-down') return 'calm'
  if (status === 'retired') return 'fallback'
  return 'live'
}
