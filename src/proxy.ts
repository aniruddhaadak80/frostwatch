import { NextResponse, type NextRequest } from 'next/server'
import { isValidOwnerId, newOwnerId, OWNER_COOKIE, OWNER_COOKIE_MAX_AGE } from '@/lib/session'

/**
 * Issues the anonymous owner cookie.
 *
 * This has to live in the proxy rather than in a page: a Server Component cannot set cookies,
 * so the first render of /sheets would throw if the id were minted during render. The proxy
 * runs before rendering, so by the time any page or route handler reads the cookie it is
 * already there.
 *
 * The new value is written to BOTH the forwarded request headers and the response, so the
 * current render and the browser agree on the same owner.
 */
export function proxy(request: NextRequest) {
  const existing = request.cookies.get(OWNER_COOKIE)?.value
  if (isValidOwnerId(existing)) return NextResponse.next()

  const ownerId = newOwnerId()

  const headers = new Headers(request.headers)
  headers.set('cookie', `${OWNER_COOKIE}=${ownerId}`)

  const response = NextResponse.next({ request: { headers } })
  response.cookies.set({
    name: OWNER_COOKIE,
    value: ownerId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: OWNER_COOKIE_MAX_AGE,
  })
  return response
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|mcp.json|sitemap.xml|robots.txt).*)'],
}
