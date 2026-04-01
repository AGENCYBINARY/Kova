import { orchestrateChatTurn } from '../src/lib/agent/orchestrator'
import { prisma } from '../src/lib/db/prisma'

async function main() {
  const workspaceId = process.env.KOVA_LIVE_WORKSPACE_ID || 'cmn3sp13d0002l50489gqx2pn'
  const userId = process.env.KOVA_LIVE_USER_ID || 'cmn3sp0rq0000l504y7ztyd9e'
  const content =
    process.env.KOVA_AUTO_MODE_PROMPT ||
    'Prépare un brouillon Gmail pour contact@agencybinary.fr à propos de "test auto mode kova"'

  const result = await orchestrateChatTurn({
    content,
    executionMode: 'auto',
    context: {
      userId,
      workspaceId,
    },
  })

  console.log(JSON.stringify({
    workspaceId,
    userId,
    content,
    effectiveExecutionMode: result.effectiveExecutionMode,
    executionModeReason: result.executionModeReason,
    proposalCount: result.proposals.length,
    proposalTypes: result.proposals.map((proposal) => proposal.type),
    executionMessages: result.executionMessages.map((item) => ({
      id: item.id,
      content: item.content,
    })),
    assistantMessage: result.assistantMessage?.content,
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
