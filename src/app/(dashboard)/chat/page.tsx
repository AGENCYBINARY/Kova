import dynamic from 'next/dynamic'
import { getAppContext } from '@/lib/app-context'
import { getChatPageData } from '@/lib/agent/orchestrator'
import ChatLoading from './loading'

const ChatPageClient = dynamic(
  () => import('@/components/chat/ChatPageClient').then((m) => m.ChatPageClient),
  {
    loading: () => <ChatLoading />,
    ssr: false,
  }
)

export default async function ChatPage() {
  const { dbUserId, workspaceId } = await getAppContext()
  const data = await getChatPageData({
    userId: dbUserId,
    workspaceId,
  })

  return <ChatPageClient initialMessages={data.messages} initialProposals={data.proposals} />
}
