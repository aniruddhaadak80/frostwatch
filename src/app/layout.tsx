import type { Metadata, Viewport } from 'next'
import { DM_Mono, Figtree, Instrument_Serif } from 'next/font/google'
import { Nav } from '@/components/Nav'
import { REPO_LABEL, SITE } from '@/lib/site'
import './globals.css'

const display = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-instrument' })
const bodyface = Figtree({ subsets: ['latin'], variable: '--font-bodyface' })
const data = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-data' })

export const metadata: Metadata = {
  metadataBase: new URL(SITE.live),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s — ${SITE.name}` },
  description: SITE.description,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE.live,
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a1620',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${bodyface.variable} ${data.variable}`}>
      <body>
        <div className="shell">
          <Nav />
          <main>
            <div className="wrap">{children}</div>
          </main>
          <footer className="footer">
            <div className="wrap">
              <span>
                {SITE.name} — deterministic frost-risk engine. Forecast data by Open-Meteo, alerts
                by NOAA/NWS.
              </span>
              <a
                href={SITE.repo}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${REPO_LABEL} — ${SITE.name} on GitHub (opens in a new tab)`}
              >
                {REPO_LABEL} on GitHub
              </a>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
