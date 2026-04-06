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
- Google Photos
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
- Model-first planning: the LLM should own interpretation, sequencing, and reformulation
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
- let the model lead planning by default
- keep deterministic rescue only for malformed model output, missing facts, or safety-critical repair paths
- create pending actions
- auto-execute low-risk actions when policy allows it
- persist assistant/user messages and execution outcomes

### 3. Agent planning

Core file:

- [src/lib/agent/v1.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1.ts)

Responsibilities:

- distinguish conversation vs action vs connected-read intent
- let OpenAI generate response, plan, and typed actions first when a real action request is present
- validate, enrich, and reference-resolve those proposals safely
- fall back to deterministic planning only when the model is unavailable, low-value, or structurally invalid
- handle ambiguity and clarification
- keep multi-step planning explicit through a structured plan array

### 4. Tool execution

Core files:

- [src/lib/agent/tool-execution.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/tool-execution.ts)
- [src/lib/mcp/registry.ts](/Users/agencybinary/Documents/CODEX/src/lib/mcp/registry.ts)
- [src/lib/integrations/google-calendar.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/google-calendar.ts)
- [src/lib/integrations/google-docs.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/google-docs.ts)
- [src/lib/integrations/google-drive.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/google-drive.ts)
- [src/lib/integrations/google-gmail.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/google-gmail.ts)
- [src/lib/integrations/google-photos.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/google-photos.ts)
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

As of `2026-04-06`:

- GitHub branch: `main`
- current delivery line:
  - `ce3d26b` `feat(agent): keep OpenAI voice when merging deterministic proposals`
  - `0ae5c11` `fix: harden provider refresh and live coverage`
- current production deployment:
  - Vercel deployment id: `dpl_7MtbWq4QAHmkdbg4kd8VfAntkfCq`
  - production URL: [kova.agencybinary.fr](https://kova.agencybinary.fr)
- database: Neon Postgres
- current validation baseline:
  - `npm test` -> `87/87`
  - `npm run lint` -> OK
  - `npm run build` -> OK
  - `npm run integration:smoke:prod` -> OK on Gmail, Calendar, Google Docs, Google Drive, Notion, Google Photos
  - `npm run integration:live:prod` -> OK `LIVE_RUNNER_OK 23`
  - `npm run integration:live:execute:prod` -> OK on Gmail, Calendar, Google Drive, Google Docs, Notion, Google Photos

### Latest Local Candidate

As of `2026-04-06`, not yet promoted as a new production baseline in this document:

- theme: AI-first planning pass on the agent core
- status:
  - model-first planning path strengthened in [src/lib/agent/v1.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1.ts)
  - structured `plan` array added to the OpenAI contract in [src/lib/ai/client.ts](/Users/agencybinary/Documents/CODEX/src/lib/ai/client.ts)
  - assistant message metadata now persists plan steps in [src/lib/agent/orchestrator.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/orchestrator.ts)
  - deterministic rescue for calendar update flows hardened in [src/lib/agent/v1-deterministic.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1-deterministic.ts)
  - overly broad email intent detection narrowed in [src/lib/workspace-context/intents.ts](/Users/agencybinary/Documents/CODEX/src/lib/workspace-context/intents.ts)
- local validation:
  - `npm test` -> `125/125`
  - `npm run build` -> OK
- current prod-runner validation on the configured target:
  - `npm run integration:smoke:prod` -> OK on Gmail, Calendar, Google Docs, Google Drive, Google Photos
  - `npm run integration:live:prod` -> OK `LIVE_RUNNER_OK 20`
- honest note:
  - this pass makes the model more central in planning, but Kova is still not a free-form agent runtime. Deterministic guards remain intentionally present for capability answers, reference resolution, malformed model output, and safe execution repair.

### Production Issues Already Closed

#### Provider refresh was optimistic and OAuth errors were opaque

Observed symptom:

- `/integrations` could show a provider as healthy even if the provider call would fail
- Google and Notion callback failures surfaced as generic integration errors
- live validation covered previews well, but not enough write-path execution

Resolution already applied:

- refresh route now performs real provider probes per connected integration instead of trusting scope metadata alone
- Notion refresh now calls a real probe (`/v1/users/me`)
- Google and Notion OAuth callbacks now redirect with explicit error codes
- integrations page translates those codes into user-facing messages
- production live runner now covers preview plus write-path execution, including approval-gated Google Docs updates

Main files:

- [src/app/api/integrations/[provider]/refresh/route.ts](/Users/agencybinary/Documents/CODEX/src/app/api/integrations/[provider]/refresh/route.ts)
- [src/app/api/integrations/callback/google/route.ts](/Users/agencybinary/Documents/CODEX/src/app/api/integrations/callback/google/route.ts)
- [src/app/api/integrations/callback/notion/route.ts](/Users/agencybinary/Documents/CODEX/src/app/api/integrations/callback/notion/route.ts)
- [src/components/dashboard/IntegrationsPageClient.tsx](/Users/agencybinary/Documents/CODEX/src/components/dashboard/IntegrationsPageClient.tsx)
- [scripts/integration-live-runner.ts](/Users/agencybinary/Documents/CODEX/scripts/integration-live-runner.ts)

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

### Google Photos Notes

Since March 31, 2025, Kova must not rely on the old Google Photos Library browsing model.

Important product rule:

- do not promise "browse recent library photos/albums" server-side
- use Google Photos Picker for user-library selection
- only work with media explicitly selected in the picker session

Current implementation baseline:

- required scope: `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`
- validate Google Photos by creating a Picker session, not by calling old Library `mediaItems` listing
- if production still reports insufficient scopes after enabling the API, reconnect Google to mint a fresh token with Picker scope

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

## Continuity Update — 2026-04-06 (AI-first planning pivot)

Commits after this continuity note should reflect a targeted runtime change, not a broad integration pass.

What changed:

- `runAgentTurn()` was shifted further toward a model-first flow.
- Deterministic proposal building no longer short-circuits the model by default for:
  - early disambiguation
  - capability-question handling
- Deterministic logic remains in three places only:
  - explicit shortcut mode when `KOVA_PREFER_DETERMINISTIC_ACTIONS=true`
  - safety fallback when the model returns no usable proposals or fails
  - final validation/repair of model proposals before execution
- The OpenAI system prompt now explicitly instructs Kova to return small ordered multi-step plans when a workflow spans multiple apps or steps.

Validation baseline for this tranche:

- `npm test` -> pass (`121/121`)
- `npm run lint` -> pass
- `npm run build` -> pass
- `npm run integration:live:prod` -> pass (`LIVE_RUNNER_OK 20`)
- `npm run integration:live:execute:prod` -> pass (`LIVE_RUNNER_OK 20`)

Files changed in this slice:

- [src/lib/agent/v1.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1.ts)
- [src/lib/ai/client.ts](/Users/agencybinary/Documents/CODEX/src/lib/ai/client.ts)
- [tests/agent-actions.test.ts](/Users/agencybinary/Documents/CODEX/tests/agent-actions.test.ts)

Tests added:

- model can drive an ordered multi-step plan across apps
- capability questions stay conversational even if the model over-eagerly proposes an action
- deterministic fallback still rescues execution when the model claims success without a valid proposal
- calendar update requests stay on the calendar path instead of drifting into email help
- fallback calendar updates can carry `relativeShiftMinutes` when a selected event must move

Remaining honest gap after this slice:

- Kova is now more model-led in `runAgentTurn`, but the orchestration layer still contains deterministic follow-up builders and connected-context fallbacks.
- For a deeper AI-first architecture, the next big refactor targets are:
  - [src/lib/agent/orchestrator.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/orchestrator.ts)
  - [src/lib/agent/v1-deterministic.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1-deterministic.ts)
  - connected read / follow-up planning paths that still bypass model reasoning in some cases

## Continuity Update — 2026-04-06 (persistent action plans + broader live execute)

This slice moved Kova from “plan text in message metadata” to a real persisted multi-step object that can anchor execution state and follow-ups.

What changed:

- Added persistent plan models in Neon:
  - `ActionPlan`
  - `ActionPlanStep`
  - `Action.planId`
  - `Action.planStepIndex`
- Agent proposal persistence now creates an `ActionPlan` when:
  - the model returns a structured multi-step plan, or
  - a turn generates multiple linked actions
- Batch execution, rejection, expiration, and superseding now resynchronize plan/step lifecycle state from action statuses.
- Follow-up bundle refinement now prefers `planId` grouping before looser `requestGroupId` heuristics.
- Chat runtime state now keeps recent completed/compensated actions in memory so follow-up logic can stay anchored to the latest actual workflow, not only pending items.
- Production live execute coverage was expanded on the configured Google-heavy target with more reversible write paths:
  - Gmail: archive, label/remove label, unread/read, star/unstar, create+update draft
  - Drive: rename, create folder, copy file, share/unshare
  - Calendar: create+cleanup
  - Docs: create+update+cleanup
  - Photos: picker create/delete

Validation baseline for this tranche:

- `npm test` -> pass (`129/129`)
- `npm run lint` -> pass
- `npm run build` -> pass
- `npm run integration:smoke:prod` -> pass on Gmail, Calendar, Google Docs, Google Drive, Google Photos
- `npm run integration:live:prod` -> pass (`LIVE_RUNNER_OK 20`)
- `npm run integration:live:execute:prod` -> pass on Gmail, Calendar, Drive, Docs, Photos
- Prisma schema push applied to Neon:
  - local Neon maintenance target
  - production Neon target

Files changed in this slice:

- [prisma/schema.prisma](/Users/agencybinary/Documents/CODEX/prisma/schema.prisma)
- [src/lib/actions/action-plans.ts](/Users/agencybinary/Documents/CODEX/src/lib/actions/action-plans.ts)
- [src/lib/agent/orchestrator-actions.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/orchestrator-actions.ts)
- [src/lib/actions/execute-persisted-batch.ts](/Users/agencybinary/Documents/CODEX/src/lib/actions/execute-persisted-batch.ts)
- [src/lib/actions/review-batch.ts](/Users/agencybinary/Documents/CODEX/src/lib/actions/review-batch.ts)
- [src/lib/actions/pending-expiration.ts](/Users/agencybinary/Documents/CODEX/src/lib/actions/pending-expiration.ts)
- [src/lib/actions/supersede-pending.ts](/Users/agencybinary/Documents/CODEX/src/lib/actions/supersede-pending.ts)
- [src/lib/agent/chat-state.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/chat-state.ts)
- [src/lib/agent/follow-up.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/follow-up.ts)
- [scripts/integration-live-runner.ts](/Users/agencybinary/Documents/CODEX/scripts/integration-live-runner.ts)

Tests added:

- plan lifecycle derivation
- follow-up bundle preference by `planId` before `requestGroupId`

Remaining honest gap after this slice:

- The configured production execute target for this session still does not have `notion` connected, so the broadened write-path validation is excellent on Google surfaces but not yet mirrored by a live execute pass on Notion from this exact target.
- The product now has a persistent multi-step workflow spine, but it is still not a durable resumable state machine with retries, waits, and long-lived steps.

## Continuity Update — 2026-04-06 (agent regression: literal email leakage + wrong Massarelli contact)

This slice fixed a real regression in the AI workflow, not a cosmetic issue.

Observed failure:

- Kova could accept a bundled “calendar invite + Gmail message” request and still output:
  - a single `send_email` proposal instead of a paired calendar+email workflow
  - the wrong Massarelli contact (`Tristan`) when the request targeted `Paula`
  - the user’s own instruction text inside the email subject/body

Root causes closed in this slice:

- Contact extraction was too loose on courtesy titles such as `Madame Paula Massarelli`.
- Gmail contact lookup could over-score surname-only matches from sent mail and return the wrong homonym.
- Repeat-meeting replay text still looked too much like literal mail content.
- Model rescue logic did not replace obviously broken bundled meeting/email outputs when the model returned a corrupted `send_email`.
- Low-value model wording could still remain visible even when deterministic fallback proposals were the ones actually used.

What changed:

- `sanitizeContactNameCandidate()` now strips leading honorifics before contact matching.
- Gmail lookup now requires a first-name anchor for multi-token names, preventing surname-only false positives like `Paula Massarelli` -> `Tristan Massarelli`.
- The replay prompt for “same invite as before” is now phrased as an internal workflow request, not as literal mail copy.
- `runAgentTurn()` now treats bundled meeting+email outputs as broken when:
  - the calendar step is missing
  - the email step is missing
  - or the mail subject/body clearly repeats user-instruction text
- When fallback proposals are used to rescue a broken model answer, Kova now uses the deterministic workflow narration instead of a generic model-flavored sentence.
- Deterministic email subject/body builders now downgrade obvious prompt-instruction text to a safe placeholder instead of copying the raw instruction into an outgoing email.

Validation baseline for this tranche:

- `npm test` -> pass (`132/132`)
- `npm run lint` -> pass
- `npm run build` -> pass

Files changed in this slice:

- [src/lib/contacts-utils.ts](/Users/agencybinary/Documents/CODEX/src/lib/contacts-utils.ts)
- [src/lib/integrations/google-gmail.ts](/Users/agencybinary/Documents/CODEX/src/lib/integrations/google-gmail.ts)
- [src/lib/agent/meeting-invite-repeat.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/meeting-invite-repeat.ts)
- [src/lib/agent/v1-deterministic.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1-deterministic.ts)
- [src/lib/agent/v1.ts](/Users/agencybinary/Documents/CODEX/src/lib/agent/v1.ts)
- [tests/contacts.test.ts](/Users/agencybinary/Documents/CODEX/tests/contacts.test.ts)
- [tests/google-gmail.test.ts](/Users/agencybinary/Documents/CODEX/tests/google-gmail.test.ts)
- [tests/meeting-invite-repeat.test.ts](/Users/agencybinary/Documents/CODEX/tests/meeting-invite-repeat.test.ts)
- [tests/agent-actions.test.ts](/Users/agencybinary/Documents/CODEX/tests/agent-actions.test.ts)

Remaining honest gap after this slice:

- This closes the concrete “wrong Massarelli + literal prompt in outgoing email” regression, but it does not mean every long ambiguous follow-up is now perfect.
- The AI path is much safer again, but the deepest remaining product work is still around richer multi-step reasoning and broader live execution coverage across more complex user conversations.

Addendum after live prod verification:

- The first prod rerun exposed another classifier bug: Gmail thread actions such as archive / unarchive / label / star could still be hijacked by the calendar branch when the quoted Gmail subject itself contained meeting words.
- That ordering bug is now fixed by prioritizing explicit Gmail thread intents before meeting/calendar branches in the deterministic router.
