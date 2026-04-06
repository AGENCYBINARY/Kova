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
        ? 'I mapped the sequence cleanly and prepared the linked actions in the right order. Everything is ready for your review.'
        : 'I mapped the action cleanly and prepared it for your review.'
    }

    return params.proposalCount > 1
      ? `I’m handling this in ${steps.length} steps: ${steps.join(' -> ')}. I prepared the matching actions in that order so you can review the whole sequence cleanly.`
      : `I’m handling this as ${steps.join(' -> ')}. The matching action is ready for your review.`
  }

  if (steps.length === 0) {
    return params.proposalCount > 1
      ? 'J’ai cadré la séquence proprement et préparé les actions liées dans le bon ordre. Tout est prêt à relire.'
      : 'J’ai cadré l’action proprement et je l’ai préparée pour relecture.'
  }

  return params.proposalCount > 1
    ? `Je te l’ai structuré en ${steps.length} temps : ${steps.join(' -> ')}. J’ai préparé les actions correspondantes dans cet ordre pour que tu puisses valider l’ensemble proprement.`
    : `Je pars là-dessus : ${steps.join(' -> ')}. L’action correspondante est prête à valider.`
}
