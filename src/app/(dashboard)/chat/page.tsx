import { ChatPageClient } from '@/components/chat/ChatPageClient'

export default function ChatPage() {
  return (
    <ChatPageClient
      initialMessages={[]}
      initialProposals={[]}
      userFallback="You"
      bootstrapFromApi
    />
  )
}
