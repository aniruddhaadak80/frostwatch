import type { Metadata } from 'next'
import { adapterName } from '@/lib/store'
import { getOwnerId } from '@/lib/session'
import { ATTRIBUTION } from '@/lib/weather'
import { SITE } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const ownerId = await getOwnerId()
  const store = adapterName()

  const rows: { label: string; value: string; note: string }[] = [
    {
      label: 'Store adapter',
      value: store,
      note:
        store === 'neon'
          ? 'Hosted Postgres. Survives redeploys and cold starts.'
          : 'Embedded SQLite. Zero-config for local development; production refuses to select it.',
    },
    {
      label: 'Owner scope',
      value: ownerId,
      note: 'Anonymous HTTP-only session cookie. Every query is scoped by it; there are no accounts.',
    },
    {
      label: 'Forecast source',
      value: 'Open-Meteo',
      note: `${ATTRIBUTION.forecast}. No API key required. Two bounded retries, 8s timeout, 15-minute revalidation.`,
    },
    {
      label: 'Alert source',
      value: 'NOAA / NWS',
      note: `${ATTRIBUTION.alerts}. No API key required.`,
    },
    {
      label: 'Engine',
      value: 'frost-risk@1.0.0',
      note: 'Fixed integer weights summing to 100. Same function in the UI, the API and the agent tool.',
    },
    {
      label: 'Integrity',
      value: 'SHA-384 chain',
      note: 'seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n)). Retired sheets are tombstoned, never removed.',
    },
  ]

  return (
    <div className="log">
      <aside className="gutter">
        <h2>Configuration</h2>
        <p>
          There are no secrets to configure for local development. Production needs one variable,
          <span className="mono"> DATABASE_URL</span>.
        </p>
      </aside>

      <div>
        <section className="hero">
          <span className="eyebrow">Configuration</span>
          <h1>Settings</h1>
          <p>Read-only. These values are reported by the running application, not declared.</p>
        </section>

        <section className="panel">
          <h2>Active configuration</h2>
          <table className="log-table">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Value</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>
                    {row.value}
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Safety</h2>
          <p className="notice">
            Frostwatch is automated guidance derived from a public forecast. It is not an
            agronomic recommendation and it is not a substitute for your own field sensors.
            Confirm before acting.
          </p>
          <p style={{ marginTop: '0.85rem', fontSize: '0.9rem' }}>
            Health check: <a href="/api/health">/api/health</a> · Agent endpoint:{' '}
            <span className="mono">{SITE.live}/api/mcp</span>
          </p>
        </section>
      </div>
    </div>
  )
}
