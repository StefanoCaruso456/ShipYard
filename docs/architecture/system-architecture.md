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

## Execution Lanes

The executor currently uses three practical execution lanes:

- model response for plain reasoning/output work
- repo tools for structured repository inspection and file mutation
- terminal execution for bounded shell, git, CI, and browser-driver commands

The terminal lane is intentionally structured instead of exposing a raw interactive PTY:

- the operator submits a command through terminal mode in the client
- the backend runtime executes the command with an allowlisted command set
- stdout, stderr, exit code, duration, category, and working directory are captured as typed tool output
- traces record terminal start/completion/failure events
- the client renders the command transcript in the thread and execution feed

## End-to-End Request Flow

The current live path is:

1. The React client collects text, files, or a voice note.
2. Voice input is transcribed on the backend first, then merged back into the composer.
3. The client sends `POST /api/runtime/tasks`.
4. The server parses JSON or multipart input and analyzes attachments into structured summaries.
5. The persistent runtime creates a stored `AgentRunRecord`, assigns `threadId`, and queues the run.
6. The worker marks the run `running` and opens trace scope for the run.
7. The runtime chooses one of two execution paths:
   - direct orchestration via `executeOrchestrationLoop`
   - phase/story/task execution via `executePhaseExecutionRun`, which still delegates each task into orchestration
8. Inside orchestration, the coordinator runs:
   - planner
   - executor
   - verifier
9. If the executor is handling a terminal task, it runs the command through the terminal execution lane and records a structured command transcript.
10. The verifier returns the next action:
   - `continue`
   - `retry_step`
   - `replan`
   - `fail`
11. The runtime persists the updated run, events, validation state, terminal metadata, and rolling summary after each meaningful stage.
12. The client polls runtime tasks, status, and traces and renders the current state back to the operator.

Important:

- React is the input and rendering layer, not the reasoning engine.
- The active backend runtime owns execution, branching, persistence, and observability.
- The client can show a terminal-style transcript, but command execution still happens only in the backend runtime.

## Stage Artifacts

The runtime passes structured artifacts between stages rather than loose text.

Coordinator handoff artifacts:

- `AgentHandoff`
- `AgentInvocation`
- `AgentResult`

Role result artifacts:

- `PlannerStepResult`
- `ExecutorStepResult`
- `VerifierStepResult`

Execution artifact:

- `AgentRunResult`

Validation artifact:

- `ValidationResult`

Validation is not guaranteed to be non-null on every stage. The guarantees are:

- every planner/executor/verifier transition has a structured handoff/result artifact
- every meaningful stage persists run state for observability
- validation artifacts are present when a step performs validation-worthy execution such as repo mutation
- model-only response steps may complete without a non-null `ValidationResult`

For terminal execution, the key artifact is the typed `run_terminal_command` tool result. It always carries structured command metadata even when no validation artifact applies.

## Current State

Phases 1 through 7 are now complete in the current backend:

- runtime instruction loading
- persistent runtime loop
- repo inspection tools
- surgical file editing
- validation and recovery
- role-scoped context assembly
- phase/story/task workflow execution
- live planner/executor/verifier orchestration with verifier-gated progression

Still not built:

- durable database-backed runtime state
- richer trace storage and review flows
- automatic policy-driven validation orchestration across lint, typecheck, and targeted test execution
- approval and review flows around diffs and execution
- a typed runtime control plane for orchestrator, production lead, and specialist dev ownership
- the broader agent team model beyond the current planner -> executor -> verifier loop
- the Ship rebuild integration-test framework and intervention logging
- the comparative analysis pipeline
