import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/site'

/** Built from the same SITE module as the header, footer and metadata. */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['/', '/sheets', '/effort', '/agent', '/export', '/settings']
  return routes.map((route) => ({
    url: `${SITE.live}${route === '/' ? '' : route}`,
    lastModified: new Date(),
    changeFrequency: route === '/' ? ('hourly' as const) : ('daily' as const),
    priority: route === '/' ? 1 : 0.7,
  }))
}
