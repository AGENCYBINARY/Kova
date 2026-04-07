import { getAppContext } from '@/lib/app-context'
import { getChatPageData } from '@/lib/agent/orchestrator'
import { ChatPageClient } from '@/components/chat/ChatPageClient'

export default async function ChatPage() {
  const { dbUserId, workspaceId } = await getAppContext()
  const data = await getChatPageData({
    userId: dbUserId,
    workspaceId,
  })

  return <ChatPageClient initialMessages={data.messages} initialProposals={data.proposals} />
}
