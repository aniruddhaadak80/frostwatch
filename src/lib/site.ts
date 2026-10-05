/**
 * The single source of truth for product identity and links.
 *
 * The header, the mobile menu, the landing CTA, the footer, the OpenGraph metadata, the
 * sitemap and the MCP manifest all read from here. Nothing else may hardcode the repository
 * URL, because a second copy is a link that silently rots.
 */

export const SITE = {
  name: 'Frostwatch',
  tagline: 'Know whether to start the wind machines — before dawn, not after.',
  description:
    'Pull the real overnight forecast for a vineyard or orchard block, score the frost risk hour by hour with a deterministic engine, and seal a frost brief you can defend.',
  repo: 'https://github.com/aniruddhaadak80/frostwatch',
  live: 'https://frostwatch.vercel.app',
  locale: 'en_GB',
} as const

export const NAV = [
  { href: '/sheets', label: 'Frost sheets' },
  { href: '/effort', label: 'Effort engine' },
  { href: '/agent', label: 'Agent' },
  { href: '/export', label: 'Export' },
  { href: '/settings', label: 'Settings' },
] as const

export const REPO_LABEL = 'View source'
