import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { getErrorStatus } from '@/lib/http/errors'

const requestSchema = z.object({
  workspaceId: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json())
    const { dbUserId } = await getAppContext()

    const membership = await prisma.workspaceMembership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: body.workspaceId,
          userId: dbUserId,
        },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!membership) {
      return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 })
    }

    await prisma.user.update({
      where: { id: dbUserId },
      data: {
        activeWorkspaceId: membership.workspaceId,
      },
    })

    const response = NextResponse.json({
      ok: true,
      workspace: membership.workspace,
      role: membership.role,
    })

    response.cookies.set('kova_workspace_id', membership.workspaceId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })

    return response
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid workspace selection.' }, { status: 400 })
    }

    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
