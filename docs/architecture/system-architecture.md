# System Architecture

## Goal

Build a persistent coding-agent harness that can accept tasks, assemble instruction context, run a planner/executor/verifier loop, perform surgical edits, validate results, and produce traceable runs.

## Ownership Boundaries

### `apps/server`

Owns:

- runtime boot
- API routes
- task intake
- debug endpoints
- runtime health
- coordination with persistence and tracing

### `packages/agent-core`

Owns:

- instruction loading and parsing
- role-specific context assembly
- planner/executor/verifier loop logic
- tool schemas and execution contracts
- edit strategy logic
- validation and recovery flow
- runtime state types

### `packages/shared`

Owns:

- shared types
- shared project metadata
- contracts reused across server and future UI

### Later Additions

- `packages/db` for persistence
- `apps/web` for runtime inspection and task submission

## Initial Orchestration Model

Use a sequential role model first:

1. planner
2. executor
3. verifier

Do not start with parallel sub-agents. Get the simple loop reliable before adding concurrency.

## Instruction Precedence

Use this conceptual order:

1. runtime/system contract
2. task prompt
3. project rules
4. skill
5. live execution context

Meaning:

- runtime/system contract defines hard safety and tool/runtime constraints
- task prompt defines the current assignment
- project rules define repo boundaries and development guardrails
- skill defines operating method
- live execution context carries files, outputs, failures, and current run state

## Execution Flow

1. task submitted
2. runtime creates run state
3. instruction context assembled
4. planner creates the next step
5. executor runs tools and edits
6. verifier checks diff and validation output
7. runtime either continues, retries, or stops
8. trace and run state persisted

## Current Phase Boundary

Phase 1 is intentionally smaller than the full architecture:

- runtime loads `skill.md`
- role-specific skill views are compiled and cached
- debug endpoint exposes the compiled result
- builder-agent prompts remain separate from runtime prompts
- no persistent task queue yet
- no Postgres-backed run state yet
- no full planner/executor/verifier model loop yet

