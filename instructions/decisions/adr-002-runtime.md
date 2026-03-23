# ADR-002: Runtime Architecture

## Status

Accepted

## Context

The main project risks are instruction injection, surgical editing, runtime clarity, traceability, and recovery behavior. These need tighter control than a framework-led runtime gives by default.

## Decision

Adopt a custom harness-first runtime with:

- `apps/server` for boot, API, and runtime endpoints
- `packages/agent-core` for instructions, context, loop logic, tools, and validation
- a sequential `planner -> executor -> verifier` role model first
- instruction precedence of:
  1. runtime/system contract
  2. task prompt
  3. project rules
  4. skill
  5. live execution context

Phase 1 runtime loading is limited to `skill.md` only. Builder-agent prompts remain separate from runtime prompts.

## Consequences

- The runtime is easier to reason about and debug.
- Phase 1 stays small and testable.
- Concurrency, persistent task queues, and richer instruction loading are deferred until the core loop is stable.

