import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

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
])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth().protect()
  }
})

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:css|js|json|jpg|jpeg|png|gif|svg|ico|woff2?|ttf|map)).*)', '/(api|trpc)(.*)'],
}
