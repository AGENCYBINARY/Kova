# BMAD - Task 07 Product V1

## Brief
- Move from static SaaS shell to a real V1 agent workflow.
- Keep provider execution abstracted so the product works before OAuth/provider SDK wiring is finished.

## Built
- Added a V1 agent layer in `src/lib/agent/v1.ts`.
- Added current user/workspace bootstrap logic in `src/lib/app-context.ts`.
- Added chat API in `src/app/api/chat/route.ts`.
- Added action approval and rejection APIs in:
  - `src/app/api/actions/[id]/approve/route.ts`
  - `src/app/api/actions/[id]/reject/route.ts`
- Connected the dashboard chat page to those APIs.

## Workflow
1. User sends a message in chat.
2. Agent interprets the request and creates a structured proposal for Gmail, Google Calendar, Notion, or Google Docs.
3. Proposal is stored as a pending `Action`.
4. User approves or rejects.
5. Approval executes through a V1 adapter and writes an `ExecutionLog`.
6. Result is reflected back into chat and dashboard data.

## Current Reality
- The execution layer is still simulated, but the product loop is real.
- Prisma persistence is now part of the path when the database is available.
- If Anthropic is configured later, the agent layer can use it; otherwise it falls back to deterministic heuristics.

## Next Step
- Replace the simulated execution adapters with real provider adapters:
  - Gmail
  - Google Calendar
  - Notion
  - Google Docs
