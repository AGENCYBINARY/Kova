# Kova Agent Platform

Kova is moving from a chat-first integration layer to an agent platform with deterministic tool execution, approval policy, and embed-ready APIs.

## Product Principles

- AI Agents for Data Prep
- Zero Data Movement
- Governance-First Security
- Deterministic Results
- APIs & SDKs for Embedding
- MCP Integration

## Current Architecture

### 1. Agent orchestration

- `src/app/api/chat/route.ts`
- `src/lib/agent/v1.ts`
- `src/lib/ai/client.ts`

The chat route analyzes the user message, separates conversation from action intent, and creates proposals only when the request is explicit enough.

### 2. Data preparation

- `src/lib/agent/data-prep.ts`

Before a tool executes, Kova normalizes and prepares action payloads so the execution layer receives stable input rather than raw model output.

### 3. Governance and approval

- `src/lib/agent/policy.ts`
- `src/app/api/actions/[id]/approve/route.ts`
- `src/app/api/actions/[id]/reject/route.ts`

Kova resolves ask-vs-auto mode through policy rather than UI intent alone. Confidence, profile policy, recipient safety, and risk level affect execution.

### 4. MCP-style tool registry

- `src/lib/mcp/types.ts`
- `src/lib/mcp/registry.ts`

Integrations are exposed as typed tools with:

- action type mapping
- risk labels
- provider ownership
- zod input validation
- deterministic execution metadata

### 5. Embed/API surface

- `GET /api/agent/manifest`
- `GET /api/agent/execute`
- `POST /api/agent/execute`
- `POST /api/mcp`
- `src/lib/sdk/kova-agent-client.ts`
- `src/lib/sdk/v1/index.ts`

This provides a stable entry point for internal embeds, external apps, or future public SDK usage.

## Workspace Governance

- `src/lib/agent/governance.ts`

Kova now resolves a workspace role before exposing or executing tools:

- `owner`: full access
- `admin`: full access
- `operator`: safe creation flows
- `viewer`: no execution tools

The current implementation reads role and optional tool overrides from `workspace.preferences.agentGovernance`, so it works without a Prisma migration.

Example shape:

```json
{
  "agentGovernance": {
    "memberRoles": {
      "user_cuid_1": "admin",
      "user_cuid_2": "viewer"
    },
    "toolPermissions": {
      "operator": ["send_email", "create_calendar_event", "create_google_doc"]
    }
  }
}
```

## Zero Data Movement Model

Kova should not become a data warehouse. The intended storage model is:

- provider OAuth tokens and integration state
- action metadata
- execution logs
- explicit user-approved outputs

Kova should avoid copying provider datasets into its own database unless a feature explicitly requires it.

## Deterministic Execution Model

To reduce hallucinated or unsafe execution:

- tools use typed schemas
- payloads are prepared before execution
- execution returns structured output
- audit logs store action result metadata
- approval policy can force review when confidence or risk is insufficient

## Near-Term Roadmap

1. Finish migrating all integration execution through the tool registry.
2. Add richer policy rules per tool and per workspace role.
3. Expand data-prep capabilities for docs, notes, and structured summaries.
4. Expose a versioned external SDK package if Kova becomes embeddable outside this repo.
5. Expand the new MCP endpoint into a standalone dedicated server if Kova needs external tool hosting.
