# ADR-001: Stack Decision

## Status

Accepted

## Context

The project needs a persistent coding-agent harness, typed runtime contracts, provider flexibility, and a clear path to a future UI and persistence layer.

## Decision

Use:

- TypeScript + Node.js
- `pnpm` monorepo
- `apps/server` for the runtime/API app
- `packages/agent-core` for the harness core
- Vercel AI SDK as the model abstraction layer
- provider-agnostic model access through the SDK
- Railway for runtime hosting
- Railway PostgreSQL for persistence
- Langfuse for tracing

## Consequences

- The repo stays TypeScript-first across runtime, server, and shared packages.
- Provider-specific logic stays out of core runtime modules.
- The current runtime can use OpenAI without changing the core architecture.
- Infrastructure remains simple enough for the sprint while leaving room to scale later.
- The future UI can be added without changing the runtime ownership model.
