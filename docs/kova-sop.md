# Kova SOP

## Purpose

Kova is a multi-tenant AI operator console for professional work. Its job is to understand user intent, prepare or execute actions across connected apps, and keep those actions reviewable, auditable, and safe.

This document is the canonical operating reference for the product. It explains what Kova is, how it works, what is connected, which execution paths exist, what “operational” means, and how to validate the system after changes.

## Product Definition

Kova is not a generic chatbot. It is an action-oriented assistant that works across:

- Gmail
- Google Calendar
- Google Docs
- Google Drive
- Notion

The product surface is:

- `chat`: intent capture, conversation, proposal generation, disambiguation
- `actions`: human approval queue for pending actions
- `history`: execution outcomes and operator trace
- `integrations`: connection state, sync state, reconnect needs
- `settings`: assistant profile and execution policy
- `dashboard`: operational summary across the workspace

## Core Principles

- Governance first: role and policy determine what can run
- Deterministic execution: tools are schema-validated before provider calls
- Approval before risk: ambiguous or sensitive work stays behind review
- Zero unnecessary data movement: Kova should not become a shadow data warehouse
- Explainability: the operator should understand what Kova prepared, what ran, and why

## Tenant Model

Kova is scoped by:

- `workspaceId`
- `userId`

Data is isolated at the workspace/user layer for:

- actions
- messages
- integrations
- contacts
- execution logs
- subscription/quota

Current governance roles:

- `owner`
- `admin`
- `operator`
- `viewer`

Governance currently resolves from workspace preferences and tool allowlists.

## Main Runtime Flow

### 1. Chat request

Entry point:

- [src/app/api/chat/route.ts](/Users/agencybinary/Documents/CODEX/src/app/api/chat/route.ts)

Responsibilities:

- validate body
- apply rate limiting
- consume quota
- run orchestration
- refund quota on server failure

### 2. Orchestration

Core file:

- [src/lib/agent/orchestrator.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/orchestrator.ts)

Responsibilities:

- load recent messages, contacts, assistant profile, governance
- resolve connected workspace context
- resolve contact corrections and recent references
- decide whether to run deterministic or model-assisted planning
- create pending actions
- auto-execute low-risk actions when policy allows it
- persist assistant/user messages and execution outcomes

### 3. Agent planning

Core file:

- [src/lib/agent/v1.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1.ts)

Responsibilities:

- distinguish conversation vs action vs connected-read intent
- propose typed actions
- handle ambiguity and clarification
- combine deterministic planning with OpenAI responses

### 4. Tool execution

Core files:

- [src/lib/agent/tool-execution.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/tool-execution.ts)
- [src/lib/mcp/registry.ts](/Users/agencybinary/Documents/CODEX/src/lib/mcp/registry.ts)
- [src/lib/integrations/google.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/google.ts)
- [src/lib/integrations/notion.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/notion.ts)

Responsibilities:

- validate parameters with zod
- map action types to provider tools
- prepare payloads deterministically
- execute provider calls
- record audit logs

## Connected App Capability Matrix

### Gmail

Current action coverage:

- send email
- reply to thread
- create draft
- forward email
- archive / unarchive thread
- label thread
- mark read / unread
- star / unstar
- trash thread

Read/context coverage:

- inbox listing
- thread summaries
- unread and priority summarization
- contact inference from mailbox context

### Google Calendar

Current action coverage:

- create event
- update event
- delete event

Read/context coverage:

- recent events
- day/week views
- availability windows
- event reference resolution from chat context

### Google Docs

Current action coverage:

- create doc
- update doc

Read/context coverage:

- recent docs
- content preview for matching docs

### Google Drive

Current action coverage:

- create file
- create folder
- delete file
- move file
- rename file
- copy file
- share file
- unshare file

Read/context coverage:

- recent/matching files
- parent folder resolution
- disambiguation when multiple files or folders match

### Notion

Current action coverage:

- create page
- update page content
- update page properties
- archive page

Read/context coverage:

- page search
- database search
- page preview enrichment

## Approval and Execution Modes

User-facing modes:

- `ask`
- `auto`

Actual execution outcome depends on:

- user requested mode
- assistant execution policy
- confidence
- action risk
- governance allowlist

Important rule:

- `auto` is only advisory. Kova can still downgrade execution to review if policy or risk requires it.

## What “Operational” Means

Kova is operational when all of the following are true:

- the target app is connected
- required scopes/permissions are present
- the request resolves to a valid tool/action type
- parameters validate against the tool schema
- governance allows the action
- the execution path either succeeds or returns a clear review/error state

Kova is not operational for a request when:

- the app is disconnected
- permissions are stale and reconnect is required
- the target object cannot be resolved safely
- the action is denied by governance
- the provider call fails and returns a non-recoverable error

## Reliability Controls

Current reliability controls:

- rate limiting
- monthly quotas by plan
- idempotency support for key POST routes via `Idempotency-Key`
- encrypted OAuth tokens at rest
- approval gate for risky actions
- audit logs for visibility
- batch execution with blocked downstream actions after a failure

Important current limitation:

- route-level idempotency is currently memory-backed, not durable across all server instances
- multi-step workflows still execute as action batches, not as a durable workflow engine

## Operator Runbooks

### If chat feels “dumb”

Check:

- connected app state in `/integrations`
- assistant profile and execution policy in `/settings`
- latest execution outcomes in `/history`
- whether the user asked a capability question vs an action request

### If an integration shows connected but actions fail

Check:

- reconnect requirement
- missing scopes
- provider token freshness
- last sync time

### If the user says “it duplicated an action”

Check:

- whether the client sent `Idempotency-Key`
- action history for duplicate executions
- approval message / batch result metadata

### If the user says “it proposed the wrong object”

Check:

- recent connected context
- reference resolution behavior
- disambiguation metadata in the chat message

## Validation Checklist After Changes

Run:

```bash
npm test
npm run lint
npm run build
```

If live workspace validation is configured:

```bash
npm run integration:live
```

## Recommended Manual Prompts

### Gmail

```text
Réponds au dernier thread de Maxime pour confirmer que je reviens vers lui demain matin.
```

### Calendar

```text
Crée un rendez-vous demain à 15h avec Maxime pendant 30 minutes, sans Meet.
```

### Drive

```text
Déplace le fichier “Board Update” dans le dossier “Archive Q1”.
```

### Docs

```text
Crée un Google Doc de note de synthèse sur le lancement produit avec résumé, risques et prochaines étapes.
```

### Notion

```text
Crée une page Notion pour le projet “Launch Ops” avec objectifs, timeline, owners et next steps.
```

### Cross-app

```text
Prépare un rendez-vous avec Maxime demain à 15h puis un email de confirmation à lui envoyer après validation.
```

## Main Files To Know

- [src/app/api/chat/route.ts](/Users/agencybinary/Documents/CODEX/src/app/api/chat/route.ts)
- [src/lib/agent/orchestrator.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/orchestrator.ts)
- [src/lib/agent/v1.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1.ts)
- [src/lib/mcp/registry.ts](/Users/agencybinary/Documents/CODEX/src/lib/mcp/registry.ts)
- [src/lib/integrations/google.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/google.ts)
- [src/lib/integrations/notion.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/notion.ts)
- [src/lib/dashboard/server.ts](/Users/agencybinary/Documents/CODEX/src/lib/dashboard/server.ts)
- [src/components/dashboard/ActionsPageClient.tsx](/Users/agencybinary/Documents/CODEX/src/components/dashboard/ActionsPageClient.tsx)
- [src/components/dashboard/IntegrationsPageClient.tsx](/Users/agencybinary/Documents/CODEX/src/components/dashboard/IntegrationsPageClient.tsx)

## Next Structural Steps

Priority sequence after this SOP baseline:

1. durable workflow runtime for multi-step plans
2. DB-backed idempotency and execution leases
3. per-app capability matrix and richer operator trust surfaces
4. structured governance schema instead of JSON-only storage
5. execution log retention / archival policy

## Continuity Log

This section is the short operational memory for future sessions. Update it when a production issue is closed, a structural refactor ships, or runtime behavior changes materially.

### Current Production Baseline

As of `2026-04-01`:

- GitHub branch: `main`
- current delivery line:
  - `caf019c` `fix: harden app error handling`
  - `16793d3` `fix: polish dashboard workspace ui`
  - `743a45f` `fix: add dashboard error boundary`
- current production deployment:
  - Vercel deployment id: `dpl_5uJzyVzpAWEhuBxNjjMs6kJbGRcU`
  - production URL: [kova.agencybinary.fr](https://kova.agencybinary.fr)
- database: Neon Postgres

### Production Issues Already Closed

#### Dashboard crash on open

Observed symptom:

- `Application error: a client-side exception has occurred`

Root cause:

- production Neon schema drift on `User.activeWorkspaceId`

Resolution already applied:

- production schema synced against Neon
- reconciliation script rerun on production data
- dashboard route error boundary added in [src/app/(dashboard)/error.tsx](/Users/agencybinary/Documents/CODEX/src/app/(dashboard)/error.tsx)
- global app error fallback added in [src/app/error.tsx](/Users/agencybinary/Documents/CODEX/src/app/error.tsx)

Verification result:

- Vercel production error logs were clean after the fix

#### Dashboard visual inconsistency

Observed symptom:

- workspace UI did not match the landing page quality level
- density, glass effects, and spacing felt inconsistent across pages

Resolution already applied:

- shell/layout tightened
- sidebar simplified
- dashboard, actions, history, integrations, settings, and chat visually aligned
- chat/action cards visually reduced and cleaned up

Main files:

- [src/app/(dashboard)/layout.module.css](/Users/agencybinary/Documents/CODEX/src/app/(dashboard)/layout.module.css)
- [src/components/layout/Sidebar.module.css](/Users/agencybinary/Documents/CODEX/src/components/layout/Sidebar.module.css)
- [src/app/(dashboard)/dashboard/page.module.css](/Users/agencybinary/Documents/CODEX/src/app/(dashboard)/dashboard/page.module.css)
- [src/app/(dashboard)/chat/page.module.css](/Users/agencybinary/Documents/CODEX/src/app/(dashboard)/chat/page.module.css)
- [src/components/ui/Card.module.css](/Users/agencybinary/Documents/CODEX/src/components/ui/Card.module.css)

### Neon Notes

Kova runs on Neon. Keep these rules explicit:

- use direct Neon URLs for schema sync / reconciliation work when Prisma needs an unpooled connection
- do not assume local `.env.local` matches production
- if production behavior differs from local behavior, verify Vercel env values first

Useful env shape:

- `DATABASE_URL` can be pooled
- `DATABASE_URL_UNPOOLED` is preferred for direct Prisma maintenance tasks

When production schema drifts:

```bash
npx vercel env pull .env.vercel.production --environment=production
set -a && source .env.vercel.production
export DATABASE_URL="$DATABASE_URL_UNPOOLED"
npx prisma db push --accept-data-loss --skip-generate
npm run db:reconcile
```

Delete the pulled env file afterward. Never commit it.

### Vercel Notes

Before saying production is updated, verify both:

```bash
npx vercel inspect kova.agencybinary.fr
npx vercel logs --environment production --since 20m --level error --no-branch
```

If the new deployment is still queued or building, do not claim the alias has switched until `inspect` on the production domain shows the new deployment id.

### Mandatory Closeout Checklist For Future Sessions

Before ending a substantial session:

1. update this `Continuity Log` when the production state materially changed
2. keep the repo clean or state exactly what remains dirty
3. record the shipped commit(s)
4. record the Vercel production deployment id if a deploy happened
5. mention whether Neon schema changes were applied or not

### Current Immediate Priorities

If work resumes after this point, the next high-value tracks are:

1. continue agent/runtime quality improvements so Kova behaves more like a premium operator and less like a raw tool router
2. keep reducing monoliths in `registry`, `v1`, and remaining integration surfaces
3. strengthen live validation so app-connected behavior is checked more systematically, not only manually
