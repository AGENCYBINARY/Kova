# BMAD - Task 06 Dashboard Pages

## Brief
- Resume the project from the previous agent at task 6: finish the remaining dashboard pages.
- Keep the UI coherent with the existing dark product direction and avoid scattered mock data.

## Map
- Existing completed work: project bootstrap, Prisma schema, UI library, sidebar/layout, chat page.
- Open work resumed here: dashboard overview and the remaining dashboard surfaces (`actions`, `history`, `integrations`, `settings`).
- Constraint observed during takeover: the repo had no git metadata in the current workspace, so change tracking must live in-repo.

## Approach
- Centralize dashboard mock data in `src/lib/dashboard-data.ts` so pages use one source of truth.
- Add a dedicated `/dashboard` overview route instead of overloading the public landing page.
- Clean up fragile React patterns while touching the pages (`selected` on `<option>`, missing CSS import target, unused imports).
- Leave backend wiring mocked, but structure the pages so real data can replace the shared dataset later.

## Decisions
- Public home page stays at `/`; authenticated users are redirected to `/dashboard`.
- Sidebar logo and primary nav now point to `/dashboard` for a proper operator landing surface.
- Page content is intentionally operational: approvals, health, audit, and preferences instead of generic placeholders.

## Validation Plan
- Run `npm run build` after edits.
- Fix any type or App Router issues discovered by the build.

## Handoff Notes
- The next logical step after this task is wiring real API/data fetching into the shared dashboard dataset shape.
- If backend work starts, preserve the shape of `DashboardAction` and `DashboardIntegration` to reduce page churn.

## Extension
- Added Clerk middleware and auth entry pages so `auth()` works locally and protected dashboard routes resolve cleanly.
- Added `src/lib/dashboard/server.ts` as the first server data layer.
- Added dashboard API routes under `src/app/api/dashboard/*`.
- The dashboard pages now read from the server layer, which prefers Prisma data and falls back to the shared mock dataset when the database is empty or unavailable.
- Refocused the product language around an AI operator/agent connected to Gmail, Notion, Google Calendar, and Google Docs.
