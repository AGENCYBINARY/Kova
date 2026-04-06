export interface AgentPlanStepCondition {
  type: 'always' | 'if_previous_step_succeeded' | 'if_previous_output_exists'
  key?: string
}

export interface AgentPlanStep {
  title: string
  detail: string
  app?: string
  kind?: 'action' | 'wait'
  waitUntil?: string
  retryLimit?: number
  retryBackoffSeconds?: number
  condition?: AgentPlanStepCondition
}

export function buildPlanBackedNarration(params: {
  language: 'fr' | 'en'
  plan: AgentPlanStep[]
  proposalCount: number
}) {
  const steps = params.plan
    .slice(0, 4)
    .map((step) => {
      const prefix = step.app ? `${step.app} · ` : ''
      return `${prefix}${step.title}`
    })

  if (params.language === 'en') {
    if (steps.length === 0) {
      return params.proposalCount > 1
        ? 'I mapped out the sequence and prepared the linked actions.'
        : 'I mapped out the action cleanly and prepared it.'
    }

    return params.proposalCount > 1
      ? `I mapped this in ${steps.length} steps: ${steps.join(' -> ')}. The matching actions are prepared in that order.`
      : `I mapped the action cleanly: ${steps.join(' -> ')}. The matching action is ready.`
  }

  if (steps.length === 0) {
    return params.proposalCount > 1
      ? 'J’ai cadré la séquence et préparé les actions liées.'
      : 'J’ai cadré l’action proprement et je l’ai préparée.'
  }

  return params.proposalCount > 1
    ? `J’ai structuré ça en ${steps.length} temps : ${steps.join(' -> ')}. Les actions correspondantes sont prêtes dans cet ordre.`
    : `J’ai cadré l’action proprement : ${steps.join(' -> ')}. L’action correspondante est prête.`
}
