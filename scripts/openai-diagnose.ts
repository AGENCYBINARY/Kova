import { KOVA_CHAT_MODEL, analyzeUserRequest, isOpenAiConfigured } from '../src/lib/ai/client'
import { resolveLiveTarget } from './live-targets'
import { getAssistantProfile } from '../src/lib/assistant/store'
import { getWorkspaceGovernance } from '../src/lib/agent/governance'
import { listKnownContacts } from '../src/lib/contacts'
import { resolveConnectedWorkspaceContext } from '../src/lib/workspace-context/service'
import { runAgentTurn } from '../src/lib/agent/v1'

async function main() {
  const inspectWorkspace = process.argv.includes('--workspace')
  console.log(JSON.stringify({
    kova: 'openai.diagnose',
    configured: isOpenAiConfigured(),
    model: KOVA_CHAT_MODEL,
  }))

  const greeting = await analyzeUserRequest('Bonjour, réponds juste bonjour en une phrase.', [], {
    behaviorMode: 'conversation',
  })
  console.log(JSON.stringify({
    check: 'conversation',
    response: greeting.response,
    proposalCount: greeting.proposals.length,
    planCount: greeting.plan.length,
  }, null, 2))

  const task = await analyzeUserRequest(
    'Prépare un mail professionnel pour reporter une réunion à vendredi à 10h et ajoute un Google Meet.',
    [],
    { behaviorMode: 'default' }
  )
  console.log(JSON.stringify({
    check: 'task',
    response: task.response,
    proposalTypes: task.proposals.map((proposal) => proposal.type),
    planCount: task.plan.length,
  }, null, 2))

  if (!inspectWorkspace) {
    return
  }

  const prompt =
    "Rédige un mail à Maxime Neveu pour lui dire que j'ai un rendez-vous jeudi à 15h, donc on doit annuler notre réunion de jeudi et la reporter à vendredi à 10h. Prépare aussi l'invitation agenda avec Google Meet et le mail avec le lien."
  const target = await resolveLiveTarget()
  const [assistantProfile, governance, knownContacts, connected] = await Promise.all([
    getAssistantProfile(target.workspaceId),
    getWorkspaceGovernance({ workspaceId: target.workspaceId, userId: target.userId }),
    listKnownContacts({ workspaceId: target.workspaceId, userId: target.userId }),
    resolveConnectedWorkspaceContext({ content: prompt, workspaceId: target.workspaceId, userId: target.userId }),
  ])

  const result = await runAgentTurn(prompt, [], knownContacts, assistantProfile, governance.allowedActionTypes, {
    workspaceContext: connected?.workspaceContext,
    connectedContextMetadata: connected?.metadata,
  })

  console.log(JSON.stringify({
    check: 'workspace-agent',
    workspaceId: target.workspaceId,
    userId: target.userId,
    response: result.response,
    proposalTypes: result.proposals.map((proposal) => proposal.type),
    disambiguationCount: result.disambiguations?.length || 0,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
