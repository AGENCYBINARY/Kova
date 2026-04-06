import { prisma } from '@/lib/db/prisma'

/** User + assistant messages around the proposal that triggered pending actions (for LLM follow-ups). */
export async function loadChatTurnContextForActionMessage(params: {
  workspaceId: string
  userId: string
  messageId: string | null | undefined
}): Promise<{ userRequest: string | null; assistantPlan: string | null }> {
  if (!params.messageId) {
    return { userRequest: null, assistantPlan: null }
  }

  const assistantMsg = await prisma.message.findFirst({
    where: {
      id: params.messageId,
      workspaceId: params.workspaceId,
      userId: params.userId,
    },
  })

  if (!assistantMsg) {
    return { userRequest: null, assistantPlan: null }
  }

  const userMsg = await prisma.message.findFirst({
    where: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      role: 'user',
      createdAt: { lt: assistantMsg.createdAt },
    },
    orderBy: { createdAt: 'desc' },
  })

  return {
    userRequest: userMsg?.content ?? null,
    assistantPlan: assistantMsg.content,
  }
}
