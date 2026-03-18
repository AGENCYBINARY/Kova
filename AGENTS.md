# AGENTS.md

## Purpose

This Codex setup is configured for high-autonomy execution while staying reviewable and recoverable.

Codex should optimize for:

- finishing substantial end-to-end tasks with minimal user intervention
- delegating bounded work to subagents when that improves speed or clarity
- keeping changes easy to review, test, and revert

## Working Mode

Default operating model:

- one main thread owns the overall plan and final integration
- subagents handle bounded tasks such as exploration, frontend implementation, backend implementation, tests, or bug triage
- keep subagent scopes narrow and explicit
- avoid having multiple agents edit the same file at the same time unless explicitly requested

## Permissions

Preferred session settings:

- approval mode: `Auto` when the repository is trusted
- experimental features: enable `Multi-agents`
- recommended for long tasks: enable `Prevent sleep while running`
- optionally enable `Automatic approval review` if fewer interruptions are desired

If permissions are tighter than expected, adapt and continue with the highest-confidence path available instead of stalling.

## Planning

For any non-trivial task:

1. establish the goal, constraints, and done criteria
2. inspect relevant files before editing
3. produce a short execution plan
4. delegate only bounded subtasks
5. integrate results in the main thread
6. verify behavior before considering the task complete

Use planning by default for:

- multi-file changes
- architecture changes
- UI redesigns
- debugging with unclear root cause
- migrations, refactors, or external integrations

## Git Safety

Create frequent checkpoints so work can be recovered cleanly.

Rules:

- create a git checkpoint before large or risky changes when the repo is clean enough
- create another checkpoint after a meaningful milestone if the task is long-running
- never rewrite or discard user changes unless explicitly asked
- never use destructive git commands such as hard reset without explicit approval

Suggested checkpoint rhythm:

- before starting a major task
- after scaffolding or structural setup
- after a working implementation
- after tests pass

## Execution Rules

Codex should:

- prefer completing the task instead of stopping at analysis
- make reasonable assumptions and state them briefly after the work is done
- preserve existing project conventions unless a redesign or migration is requested
- keep edits focused on the requested outcome
- add tests when behavior changes and the project already uses tests
- run the smallest relevant validation first, then broaden if needed

Codex should not:

- make unrelated refactors without a clear payoff for the task
- leave partially applied changes without explaining the state
- claim completion without verification

## Multi-Agent Guidance

Use subagents only when they create real leverage.

Good subagent tasks:

- scan the codebase for relevant files
- compare implementation options
- implement a self-contained component or module
- write or update tests
- review the diff for bugs, regressions, and missing validation

Bad subagent tasks:

- broad overlapping edits across the same files
- vague goals like "fix the app"
- work that depends on constant back-and-forth with the main thread

The main agent remains responsible for:

- the final plan
- conflict resolution
- final integration
- validation
- the final answer to the user

## Done Criteria

A task is not done until all applicable items below are satisfied:

- the requested behavior or deliverable exists
- changed code is internally consistent
- relevant tests, lint, typecheck, or build steps were run when available
- any skipped verification is explicitly called out
- major assumptions, risks, or follow-ups are stated briefly

## Prompting Pattern

When the user gives a broad task, interpret it in this structure:

- goal: what outcome should exist at the end
- context: which files, folders, docs, errors, or examples matter
- constraints: architecture, style, safety, and tool limits
- done when: what must be true before the task is considered complete

If those are missing, infer the most reasonable version from the repository and continue.
