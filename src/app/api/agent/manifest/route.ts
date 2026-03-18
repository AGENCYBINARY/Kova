import { NextResponse } from 'next/server'
import { getAppContext } from '@/lib/app-context'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { buildAgentManifest } from '@/lib/agent/manifest'

export async function GET() {
  try {
    const { dbUserId, workspaceId } = await getAppContext()
    const governance = await getWorkspaceGovernance({
      workspaceId,
      userId: dbUserId,
    })

    return NextResponse.json({
      ...buildAgentManifest(governance.allowedActionTypes),
      workspaceRole: governance.role,
    })
  } catch {
    return NextResponse.json(buildAgentManifest())
  }
}
