import { prisma } from '../src/lib/db/prisma'
import { getValidGoogleAccessToken } from '../src/lib/integrations/google-auth'

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
  const response = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=3', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const body = await response.text()

  console.log(JSON.stringify({
    workspaceId,
    userId,
    status: response.status,
    metadata: integration.metadata,
    body,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
