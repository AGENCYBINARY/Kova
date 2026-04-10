/**
 * Compact, live snapshot for the model: role, allowed action types, OAuth rows.
 * Injected every turn so the agent grounds answers in real connectivity — not generic capability lists.
 */
export function formatAgentRuntimeBrief(params: {
  role: string
  allowedActionTypes: readonly string[]
  integrations: Array<{ type: string; status: string }>
}): string {
  const types = params.allowedActionTypes
  const typePreview =
    types.length <= 80 ? types.join(', ') : `${types.slice(0, 80).join(', ')} … (+${types.length - 80} more)`

  const integrationLines =
    params.integrations.length > 0
      ? params.integrations.map((row) => `- ${row.type}: ${row.status}`).join('\n')
      : '- (no integration rows yet — user should connect apps under Integrations)'

  return [
    `Workspace role: ${params.role}`,
    `Executable action types enabled for this user (${types.length}): ${typePreview}`,
    'OAuth integrations (type → status):',
    integrationLines,
    'Product: sensitive proposals go to the in-app approval queue; execution follows workspace policy (ask vs auto) and integration health.',
  ].join('\n')
}
