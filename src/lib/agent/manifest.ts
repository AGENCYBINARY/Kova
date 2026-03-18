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
    mcp: {
      endpoint: '/api/mcp',
      standalone: {
        entrypoint: '/mcp',
        manifest: '/manifest',
        health: '/health',
      },
      protocolVersion: '2024-11-05',
      methods: ['initialize', 'manifest/get', 'capabilities/get', 'tools/list', 'tools/call'],
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
    'tool_visibility_filtering',
    'role_based_tool_permissions',
    'risk_labelling',
    'execution_logging',
  ],
  runtimeCapabilities: [
    'conversation',
    'connected_context_reads',
    'tool_preparation',
    'tool_validation',
    'provider_execution',
    'audit_trails',
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
