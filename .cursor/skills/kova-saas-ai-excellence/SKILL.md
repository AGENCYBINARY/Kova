---
name: kova-saas-ai-excellence
description: Maintain and improve Kova SaaS AI quality (chat, tools, CX). Use when changing assistant behavior, prompts, executive skills, or OpenAI integration for AGENCYBINARY/Kova.
---

# Kova SaaS — AI excellence (build skill)

## What actually drives runtime behavior

1. **`src/lib/ai/client.ts`** — `systemPrompt` (voice, CX, omnichannel rules, JSON output). Small copy changes here have large UX impact. **Never put unescaped backticks** inside the template literal (breaks the build).
2. **`src/lib/assistant/profile.ts`** — `executiveAssistantSkills` (injected into `analyzeUserRequest` as skill instructions), `defaultAssistantProfile`.
3. **`src/lib/agent/v1.ts`** — Orchestrates deterministic vs OpenAI path; proposal validation and fallbacks.
4. **`src/lib/mcp/registry-catalog.ts`** — Tool definitions (what the model can propose).

## Environment (production)

- `OPENAI_API_KEY` — required for LLM turns.
- Chat uses **`gpt-4.1`** via `KOVA_CHAT_MODEL` in `src/lib/ai/client.ts` — not overridden by `OPENAI_MODEL`.
- `OPENAI_REASONING_EFFORT` / `OPENAI_TEXT_VERBOSITY` — optional for GPT-5 family.

## When adding “skills” for users

Add objects to `executiveAssistantSkills` with stable `id`, short `title`, and **actionable** `instructions`. They are **runtime** skills passed to the model, not Cursor skills.

## Quality checklist before merge

- `npm test` and `npm run lint`
- Grep `systemPrompt` for stray `` ` `` inside the backtick string
- Manual smoke: one Gmail-ish request, one calendar, one multi-app if possible

## Related docs in repo

- `AGENTS.md` — workflow and safety
