# Stack Decision

## Status

Locked for the current build direction.

## Chosen Stack

- Runtime and server: TypeScript + Node.js
- Repo layout: `pnpm` monorepo
- API/runtime app: `apps/server`
- Core harness package: `packages/agent-core`
- Shared contracts: `packages/shared`
- Model abstraction: Vercel AI SDK
- Primary coding model: Anthropic Claude
- Runtime hosting: Railway
- Run/task persistence: Railway PostgreSQL
- Observability: Langfuse
- Web UI later: Vercel

## Why This Stack

- TypeScript fits typed runtime state, instruction objects, tool schemas, and shared packages.
- A monorepo keeps the server, harness core, and shared types aligned.
- Vercel AI SDK keeps provider integration flexible while avoiding provider-specific logic inside core runtime modules.
- Claude is the primary coding model, but the SDK layer stays provider-agnostic.
- Railway is the simplest fit for a persistent Node runtime plus Postgres in the same project.
- Langfuse is a strong fit for LLM and agent tracing without forcing the runtime into one framework.

## Directional Constraints

- Use a custom harness-first runtime, not LangGraph as the core execution layer.
- Keep builder-agent prompts separate from future runtime prompts.
- Phase 1 runtime loading focuses on `skill.md` only.
- Do not couple core runtime logic directly to one model provider SDK.

## Tradeoffs

- A custom runtime means more implementation work than adopting an agent framework directly.
- Railway plus Vercel is a split deployment model, but it keeps the persistent runtime separate from the future UI.
- Provider abstraction adds a thin integration layer up front, but avoids expensive rewrites later.

## Next Phase Guidance

- Keep using the current root `skill.md` during phase 1.
- Move long-term runtime instructions into `/instructions` only after the loading/parsing path is stable.

