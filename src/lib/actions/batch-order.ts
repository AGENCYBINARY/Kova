import { asActionParameters } from '@/lib/actions/parameter-resolution'

const MEET_LINK_PLACEHOLDER = /\{\{\s*meet_?link\s*\}\}/i

function proposalIndexFromParameters(parameters: Record<string, unknown>) {
  return typeof parameters.proposalIndex === 'number' ? parameters.proposalIndex : 0
}

function emailBodyReferencesMeetPlaceholder(parameters: Record<string, unknown>) {
  const body = parameters.body
  return typeof body === 'string' && MEET_LINK_PLACEHOLDER.test(body)
}

/**
 * Ensures stable execution order: proposal creation order first, then calendar before any
 * email/draft that still contains a Meet placeholder (so priorOutputs can inject the real URL).
 */
export function sortBatchActionsForExecution<T extends { type: string; parameters: unknown }>(actions: T[]): T[] {
  if (actions.length < 2) {
    return actions
  }

  const ordered = [...actions].sort((a, b) => {
    const ap = asActionParameters(a.parameters)
    const bp = asActionParameters(b.parameters)
    return proposalIndexFromParameters(ap) - proposalIndexFromParameters(bp)
  })

  const mailI = ordered.findIndex(
    (a) =>
      (a.type === 'send_email' || a.type === 'create_gmail_draft') && emailBodyReferencesMeetPlaceholder(asActionParameters(a.parameters))
  )
  const calI = ordered.findIndex((a) => a.type === 'create_calendar_event')
  if (mailI < 0 || calI < 0 || calI < mailI) {
    return ordered
  }

  const next = [...ordered]
  const [cal] = next.splice(calI, 1)
  next.splice(mailI, 0, cal)
  return next
}
