# CODEAGENT

## Purpose

Shipyard is a harness-first coding agent built to make targeted repository changes safely, keep runtime state visible, and remain explainable through traceable execution. The current implementation favors reliability over breadth: persistent runtime service, role-scoped context assembly, surgical file editing, validation and rollback, and observable planner/executor/verifier flow.

## Agent Architecture

### Design Goal

Build a persistent coding agent that can accept new work without restart, localize the right code before editing, validate each meaningful change, and explain why a run succeeded, retried, or failed.

### System Shape

- `apps/server` boots the runtime, accepts tasks, exposes runtime, context, and trace APIs, and hosts model and observability adapters.
- `packages/agent-core` owns instruction loading, context assembly, persistent runtime state, orchestration, repo tools, validation, rollback, and trace contracts.
- `packages/shared` keeps shared contracts and metadata centralized.
- `apps/client` is the operator-facing shell for runtime status, threads, and trace views.

### Runtime Loop

1. A task is submitted to the runtime service.
2. The runtime normalizes task input, attachments, and injected context.
3. A planner proposes one bounded next step.
4. An executor performs that step through repo tools or the model path.
5. Validation and recovery rules run around meaningful mutations.
6. A verifier checks whether the result matched intent and validation evidence.
7. The runtime either continues, retries, replans, or fails.
8. Trace and run state are recorded for inspection.

### Roles

- Planner: chooses the next bounded step and keeps execution scoped.
- Executor: performs repo reads, tool calls, edits, and validation work.
- Verifier: checks whether the result matches the planned intent and whether it is safe to advance.

### State and Context

The runtime owns persistent run state. Each run records:

- task instruction and title
- current status and retry count
- structured context such as objective, constraints, relevant files, and validation targets
- tool results, events, rolling summary, and error state
- orchestration and phase-execution progress

Instruction precedence is:

1. runtime/system contract
2. task objective and current task input
3. project rules
4. skill/runtime behavior guidance
5. live execution context
6. rolling summary / prior step state

### Observability

Shipyard traces the runtime through local structured logs with optional LangSmith spans. A complete run should capture:

- run and task identity
- planner, executor, verifier, and context spans
- selected files and why they were chosen
- tool calls and tool outputs
- edit attempts, validation, retries, and rollback events
- final outcome, timing, and token metadata when available

### Current Implementation Status

Implemented now:

- persistent runtime queue and run registry
- planner -> executor -> verifier orchestration
- role-scoped context assembly
- anchor-based surgical editing
- validation and rollback on failed mutations
- trace service with local logs and LangSmith integration

Deferred or intentionally limited:

- durable database-backed run persistence
- broader validation orchestration such as full lint and test routing by default
- richer approval workflows around diffs
- more complex parallel sub-agent coordination as the default path

## File Editing Strategy

### Default Policy

Shipyard uses a patch-first editing policy:

1. Search the repo for the right symbol, file, or error.
2. Read the narrowest useful region.
3. Build a minimal targeted edit.
4. Apply the edit at an anchored location.
5. Re-read the edited region.
6. Validate the change.
7. Retry localization once if the edit target was wrong.
8. Roll back or re-plan on failed validation.
9. Use guarded full-file rewrite only when precise patching is not viable and the fallback is lower risk.

### Why This Strategy

Patch-first editing keeps diffs smaller, makes review easier, and reduces unintended changes outside the target region. It is strict by design, which is a good trade when the goal is safe repository mutation rather than approximate editing.

### Supported Mutation Operations

- `edit_file_region`
- `create_file`
- `delete_file`

### Failure Modes

Common editing failures are:

- wrong file selected
- wrong anchored region selected
- stale context around the target block
- duplicate or ambiguous matches
- syntax or type breakage after the edit
- validation regressions outside the immediate target
- permission or write failures

### Recovery Rules

- Do not keep guessing after one bad localization.
- Re-localize using a different signal before a second patch attempt.
- Preserve original content so rollback is possible.
- Reject invalid edits and restore the original file when validation fails.
- Escalate or re-plan instead of stacking speculative edits on top of a failing state.

### Validation Rules

Every meaningful mutation should be followed by:

- re-read of the changed content
- structural validation that the intended change landed
- confirmation that unrelated regions stayed unchanged when expected
- the narrowest useful typecheck, lint, or test command when available

### Full Rewrite Fallback

Full-file rewrite is not the default strategy. It is allowed only when:

- patch anchoring remains brittle after re-localization
- the file is small or otherwise low-risk to rewrite
- the runtime can still validate and review the result safely

## Multi-Agent Design

### Current Coordination Model

Shipyard currently uses an explicit coordinator-owned runtime loop rather than a parallel swarm. The active execution path is:

1. `createPersistentRuntimeService` accepts and persists the run.
2. `executeOrchestrationLoop` acts as the coordinator for the live step.
3. Planner, executor, and verifier run as bounded role agents under that coordinator.
4. The verifier decides whether the runtime should continue, retry, replan, or fail.
5. When a phase/story/task plan is active, `phaseExecution` wraps the same orchestration loop per task instead of bypassing it.

### Role Boundaries

- Planner: proposes one bounded next step and keeps the scope narrow.
- Executor: performs the planned step through repo tools or the model path.
- Verifier: checks intent match, validation evidence, and whether progression is safe.

### Coordinator Responsibilities

The coordinator owns:

- role handoff creation
- role invocation order
- merge of planner, executor, and verifier results back into canonical run state
- retry and replan counters
- conflict recording
- final branch decisions

### Shared State

The system does not introduce a second orchestration state model. Canonical shared state remains:

- `AgentRunRecord`
- nested `OrchestrationState`
- optional `PhaseExecutionState` when a structured workflow is active

### Deliberate Limits

Current multi-agent behavior is intentionally constrained:

- no peer-to-peer agent messaging
- no parallel execution
- no independent specialist agent registry
- no hidden side channels outside coordinator-owned state updates

This keeps execution deterministic and traceable while still making the planner/executor/verifier collaboration explicit.

## Trace Links

### Primary Docs

- [`README.md`](./README.md)
- [`docs/architecture/observability.md`](./docs/architecture/observability.md)
- [`docs/architecture/system-architecture.md`](./docs/architecture/system-architecture.md)

### Runtime Inspection Endpoints

- `GET /api/runtime/status`
- `GET /api/runtime/tasks`
- `GET /api/runtime/tasks/:id`
- `GET /api/runtime/context/:role/:id`
- `GET /api/runtime/traces/:id`

These routes are registered in [`apps/server/src/routes/runtime.ts`](./apps/server/src/routes/runtime.ts).

### Trace and Runtime Wiring

- Runtime boot and trace-log path resolution: [`apps/server/src/runtime/bootRuntimeService.ts`](./apps/server/src/runtime/bootRuntimeService.ts)
- Trace service implementation: [`apps/server/src/observability/createTraceService.ts`](./apps/server/src/observability/createTraceService.ts)
- Trace scope propagation: [`packages/agent-core/src/observability/traceScope.ts`](./packages/agent-core/src/observability/traceScope.ts)
- Trace contracts and span types: [`packages/agent-core/src/observability/types.ts`](./packages/agent-core/src/observability/types.ts)

### Default Trace Locations

- Local trace log: `.shipyard/runtime/traces.jsonl`
- Production-style fallback path: `/tmp/shipyard/runtime/traces.jsonl`
- Optional override: `SHIPYARD_TRACE_LOG_PATH`

### What To Attach In A Submission

For a reviewable submission, include:

- the relevant CODEAGENT section references
- the run id under review
- the matching trace endpoint or trace log excerpt
- any context payload links used to inspect planner, executor, or verifier inputs
- the PR link that contains the implementation being described

## Local Use

The repo runs locally with:

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Primary supporting docs:

- [`README.md`](./README.md)
- [`docs/architecture/system-architecture.md`](./docs/architecture/system-architecture.md)
- [`docs/architecture/editing-strategy.md`](./docs/architecture/editing-strategy.md)
- [`docs/architecture/implementation-phases.md`](./docs/architecture/implementation-phases.md)
- [`docs/architecture/observability.md`](./docs/architecture/observability.md)
