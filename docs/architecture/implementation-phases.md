# Implementation Phases

## Purpose

This document explains the implementation phases for Shipyard in plain language.

Each phase answers:

- what we built
- why it matters
- how it works
- the purpose of the phase
- the outcome it creates
- the architecture it adds

## Phase 1: Instruction Runtime

### What

The runtime loads `skill.md`, parses it, organizes it into sections, and prepares role-specific instruction views.

### Why

The agent needs a real runtime instruction source before it can behave consistently. This turns product guidance into executable runtime context instead of static documentation.

### How

- load `skill.md` at startup
- parse frontmatter and markdown sections
- build planner, executor, and verifier section views
- expose a debug endpoint for inspection

### Purpose

Create a trustworthy instruction layer for the product agent.

### Outcome

The runtime can now understand and expose its operating behavior in a structured way.

### Architecture

- `packages/agent-core` owns instruction loading and parsing
- `apps/server` boots the instruction runtime and exposes inspection endpoints

### Status

Complete

## Phase 2: Persistent Runtime Loop

### What

The server runs a long-lived runtime service that accepts tasks over time, queues them, and tracks run state.

### Why

A coding agent cannot be a one-shot script. It needs to stay alive, accept new work without restarting, and make run state visible.

### How

- boot one runtime service with the server
- accept task submissions through API routes
- track runs as `pending`, `running`, `completed`, or `failed`
- keep a queue and run registry in memory

### Purpose

Establish the always-on execution backbone of the system.

### Outcome

The backend can now receive and process multiple tasks in a single server session.

### Architecture

- `apps/server` owns runtime APIs and task intake
- `packages/agent-core` owns runtime service logic and run-state contracts

### Status

Complete

## Phase 3: Repo Inspection Tools

### What

The runtime can inspect the repository safely through file listing, search, full-file reads, and file-range reads.

### Why

Safe editing starts with correct localization. The system must be able to find the right file and code region before it changes anything.

### How

- list files inside the repo root
- search the repo with structured results
- read full files
- read targeted line ranges

### Purpose

Give the runtime safe repo awareness before mutation exists.

### Outcome

The agent can now inspect code with enough precision to support surgical edits later.

### Architecture

- repo tooling lives in `packages/agent-core`
- runtime and API layers can call those tools without direct shell coupling in higher-level logic

### Status

Complete

## Phase 4: Context Assembler

### What

The runtime can build structured, role-scoped context payloads for planner, executor, and verifier workflows.

### Why

Execution quality depends on getting the right objective, rules, files, failures, and validation targets into the prompt at the right time. Without a dedicated assembler, prompts become inconsistent, noisy, and hard to inspect.

### How

- build a shared runtime context from live run state
- derive role-specific payloads for planner, executor, and verifier
- include only the sections each role needs
- track omitted sections explicitly so missing context is inspectable
- render the assembled payload into a debuggable prompt surface and API view

### Purpose

Create one reusable context layer that keeps prompts structured, inspectable, and role-aware before full orchestration is added.

### Outcome

The backend can now assemble planner, executor, and verifier payloads from live run state and expose them through the runtime API for inspection and debugging.

### Architecture

- shared context derivation lives in `packages/agent-core/src/context`
- role-specific builders live alongside the shared assembler in `packages/agent-core/src/context`
- `apps/server` exposes assembled role payloads through the runtime routes
- prompt wiring can build on this layer instead of reassembling context ad hoc

### Status

Complete as a context and inspection layer. Direct live execution wiring is the next integration step.

## Phase 5: Surgical File Editing Engine

### What

The runtime can make minimal, targeted file edits with validation and rollback.

### Why

This is the core capability of a coding agent. The goal is to change the correct code block while preserving everything else exactly.

### How

- identify a unique anchor and target block
- replace only the intended region
- re-read the file after writing
- validate that the change exists and outside content is unchanged
- restore the original file if validation fails

### Purpose

Introduce controlled, verifiable file mutation.

### Outcome

The system can now create files, delete files, and surgically edit existing files without falling back to whole-file rewrites.

### Architecture

- edit core logic lives in `packages/agent-core/src/tools/repo/editing`
- repo mutation tools live in `packages/agent-core/src/tools/repo`
- `apps/server` can invoke edit tasks through the runtime service

### Status

Complete

## Phase 6: Validation and Recovery Engine

### What

The runtime now validates every meaningful repo mutation, records the result, rolls back invalid changes, and limits retries.

### Why

Editing alone is not enough. The system must be able to prove whether a change landed correctly and recover safely when it does not.

### How

- validate file mutations immediately after write and re-read
- record structured validation results and rollback outcomes
- restore original file contents when validation fails
- classify failures as validation, rollback, or execution failures
- retry validation failures once when rollback succeeds
- expose validation state, retry count, and run events through the runtime API

### Purpose

Turn file mutation into a safe runtime capability instead of a blind write operation.

### Outcome

The backend can now reject invalid edits, restore the repo to its pre-edit state, and make the full recovery path visible to operators.

### Architecture

- validation contracts live in `packages/agent-core/src/validation`
- repo mutation tools attach validation and rollback metadata in `packages/agent-core/src/tools/repo`
- runtime state and retry logic live in `packages/agent-core/src/runtime`
- `apps/server` exposes validation status and recovery events through the API

### Status

Complete

## Phase 7: Planner / Executor / Verifier Orchestration Loop

### What

The runtime now runs a real planner -> executor -> verifier loop inside live execution, while keeping the existing phase/story/task engine as the outer workflow shell.

### Why

The repo already had structured execution through phases, stories, and tasks, but it still lacked true role transitions. A predefined task list is not the same thing as a runtime that can plan a bounded step, execute it, verify it, and branch based on that verification before it advances.

### How

- keep phases, stories, and tasks as the higher-level workflow structure
- invoke a planner step at live runtime to propose one bounded step at a time
- execute the planned step through a real executor step handler
- run a real verifier step that inspects planner intent, executor output, validation state, and retry history
- branch in runtime based on verifier output: continue, retry the step, replan, or fail
- consume planner, executor, and verifier context payloads from the Context Assembler during live execution
- expose orchestration state through runtime task inspection APIs

### Purpose

Close the gap between workflow structure and true orchestration so the runtime only marks work complete after a verifier approves the execution result.

### Outcome

The backend can now:

- plan one bounded step at a time
- execute that step through tools or model execution
- verify whether the step actually matched intent
- retry or replan when the verifier rejects the result
- gate task completion on verifier approval instead of raw execution success alone
- continue to use the existing phase/story/task engine for larger structured delivery work

### Architecture

- orchestration state and branching logic live in `packages/agent-core/src/runtime`
- phase/story/task execution still lives in `packages/agent-core/src/runtime` and now delegates task execution into the orchestration loop
- role-scoped context payloads from `packages/agent-core/src/context` are now consumed during live planner, executor, and verifier execution
- `apps/server` provides the runtime executor and exposes orchestration state through existing task APIs

### Before This Phase

Already present before this phase:

- instruction runtime
- persistent runtime loop
- repo inspection tools
- surgical editing
- validation and recovery
- context assembler
- structured phase/story/task execution

This phase adds the missing live role orchestration on top of those foundations.

### Status

Complete

## Phase 10: Typed Agent Control Plane

### What

The runtime now stores a typed control-plane state for structured delivery runs.

It tracks:

- ownership across orchestrator, production lead, specialist devs, and execution subagents
- typed phase, story, and task state
- handoffs between delivery roles
- control-plane artifacts such as plans, task results, and validation reports
- interventions such as retries and manual review requests
- blockers and their resolution state

### Why

The system already had phase, story, and task execution, but the workflow state still lived mostly inside execution flow and event history.

This phase makes coordination state explicit and inspectable so progress, ownership, retries, blockers, and delivery artifacts are stored as runtime data instead of being inferred later.

### How

- derive a typed control plane from phase execution input
- assign default ownership for each phase, story, and task
- keep control-plane state synchronized with live execution transitions
- record typed handoffs, artifacts, interventions, and blockers as the run progresses
- expose the control plane on runtime task records through the API

### Purpose

Move workflow truth out of prompt behavior and into explicit backend state.

### Outcome

Structured runs can now answer:

- who owns this work right now
- what already completed
- what retried
- what is blocked
- what artifacts and validation outputs were produced

### Architecture

- typed control-plane contracts live in `packages/agent-core/src/runtime/types.ts`
- control-plane lifecycle logic lives in `packages/agent-core/src/runtime/controlPlane.ts`
- phase execution keeps the control plane synchronized in `packages/agent-core/src/runtime/phaseExecution.ts`
- runtime normalization and persistence live in `packages/agent-core/src/runtime/createPersistentRuntimeService.ts`
- `apps/server` exposes the control plane through existing runtime task APIs

### Status

Complete

## What Comes Next

The next major phase should build on these foundations instead of replacing them.

Likely next work:

- richer prompt and context assembly
- richer validation targets such as lint, typecheck, and targeted test execution
- trace-level observability for edit attempts and recovery
- approval and review flows around diffs and execution
