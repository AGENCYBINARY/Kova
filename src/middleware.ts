import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/chat(.*)',
  '/actions(.*)',
  '/history(.*)',
  '/integrations(.*)',
  '/settings(.*)',
  '/api/dashboard(.*)',
  '/api/chat(.*)',
  '/api/actions(.*)',
  '/api/agent(.*)',
  '/api/mcp(.*)',
  '/api/integrations(.*)',
  '/api/settings(.*)',
  '/api/subscription(.*)',
  '/api/workspaces(.*)',
  '/api/stripe/checkout(.*)',
  '/api/stripe/portal(.*)',
])

// auth().protect() in Clerk v5 uses local JWT verification — no network call.
// Logged-in users hitting `/` go straight to the app so the marketing page can be fully static (CDN + better TTFB/LCP).
export default clerkMiddleware((auth, req) => {
  const { userId } = auth()
  if (userId && req.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  if (isProtectedRoute(req)) {
    auth().protect()
  }
})

// Skip Clerk entirely for /api/internal/* so Authorization: Bearer <CRON_SECRET> is not parsed as a Clerk JWT
// (Vercel Cron + curl). Next.js matchers do not support /api/(?!internal) — exclude via single-path lookahead.
export const config = {
  matcher: [
    '/((?!api/internal|_next|[^?]*\\.(?:css|js|json|jpg|jpeg|png|gif|svg|ico|woff2?|ttf|map)).*)',
  ],
}
