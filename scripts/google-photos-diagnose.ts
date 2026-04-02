import { prisma } from '../src/lib/db/prisma'
import { getValidGoogleAccessToken } from '../src/lib/integrations/google-auth'
import {
  createGooglePhotosPickerSession,
  deleteGooglePhotosPickerSession,
  getGooglePhotosPickerSession,
} from '../src/lib/integrations/google-photos'

async function main() {
  const workspaceId = process.env.KOVA_LIVE_WORKSPACE_ID || 'cmn3sp13d0002l50489gqx2pn'
  const userId = process.env.KOVA_LIVE_USER_ID || 'cmn3sp0rq0000l504y7ztyd9e'

  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId,
      userId,
      type: 'google_photos',
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  if (!integration) {
    throw new Error(`google_photos integration not found for ${workspaceId}/${userId}`)
  }

  const accessToken = await getValidGoogleAccessToken(integration)
  let sessionId: string | null = null

  try {
    const session = await createGooglePhotosPickerSession(accessToken, {
      requestId: `diag-${Date.now()}`,
    })
    sessionId = session.sessionId
    const refreshed = await getGooglePhotosPickerSession(accessToken, session.sessionId)

    console.log(JSON.stringify({
      workspaceId,
      userId,
      ok: true,
      metadata: integration.metadata,
      session,
      refreshed,
    }, null, 2))
  } finally {
    if (sessionId) {
      await deleteGooglePhotosPickerSession(accessToken, sessionId).catch(() => null)
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
