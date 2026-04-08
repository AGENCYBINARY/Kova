import { getAppContext } from '@/lib/app-context'
import { getChatPageData } from '@/lib/agent/orchestrator'
import { ChatPageClient } from '@/components/chat/ChatPageClient'

export default async function ChatPage() {
  const { dbUserId, workspaceId, userName, userEmail } = await getAppContext()
  const data = await getChatPageData({
    userId: dbUserId,
    workspaceId,
  })
  const userFallback = userName || userEmail || 'User'

  return <ChatPageClient initialMessages={data.messages} initialProposals={data.proposals} userFallback={userFallback} />
}
