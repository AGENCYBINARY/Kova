import { listMcpTools } from '@/lib/mcp/registry'
import type { DashboardAction } from '@/lib/dashboard-data'

export const agentPlatformManifest = {
  name: 'Kova Agent Platform',
  version: '2026-03-17',
  transport: 'https',
  principles: {
    aiAgentsForDataPrep: true,
    zeroDataMovement: true,
    governanceFirstSecurity: true,
    deterministicResults: true,
    apisAndSdksForEmbedding: true,
    mcpIntegration: true,
  },
  guarantees: {
    zeroDataMovement:
      'Kova executes actions against connected providers and stores only operational metadata, audit logs, and explicit action results.',
    deterministicResults:
      'Kova validates every tool payload against typed schemas before execution and returns structured outputs.',
    governanceFirstSecurity:
      'Kova enforces ask-vs-auto policy, risk-aware approval routing, workspace scoping, and execution audit trails.',
  },
  embedding: {
    rest: {
      execute: '/api/agent/execute',
      manifest: '/api/agent/manifest',
    },
    sdk: {
      javascript: '@/lib/sdk/v1',
      version: '1.0.0',
    },
  },
  dataPrepCapabilities: [
    'normalize_text',
    'clean_structured_payloads',
    'prepare_email_bodies',
    'prepare_document_sections',
    'prepare_drive_payloads',
  ],
  governanceCapabilities: [
    'approval_routing',
    'workspace_scoping',
    'risk_labelling',
    'execution_logging',
  ],
} as const

export function buildAgentManifest(allowedActionTypes?: DashboardAction['type'][]) {
  const tools = listMcpTools().filter((tool) =>
    allowedActionTypes ? allowedActionTypes.includes(tool.actionType as DashboardAction['type']) : true
  )

  return {
    ...agentPlatformManifest,
    tools,
  }
}
