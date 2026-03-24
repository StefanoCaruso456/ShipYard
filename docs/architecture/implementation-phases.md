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

The runtime can assemble role-scoped context payloads for planner, executor, and verifier workflows.

### Why

Good execution depends on the model seeing the right objective, constraints, rules, files, failures, and validation targets at the right time. Without structured context assembly, prompts become noisy, incomplete, or inconsistent across roles.

### How

- build a shared runtime context from live run state
- derive role-specific payloads for planner, executor, and verifier
- include only the sections each role needs
- track omitted sections explicitly so missing context is inspectable
- render the assembled payload into a debuggable prompt surface

### Purpose

Create a reusable context layer that keeps runtime prompts structured, inspectable, and role-aware before full orchestration is added.

### Outcome

The backend can now produce planner, executor, and verifier context payloads from live run state and expose them for inspection through the runtime API.

### Architecture

- shared context derivation lives in `packages/agent-core/src/context`
- role-specific builders live alongside the shared assembler in `packages/agent-core/src/context`
- `apps/server` exposes assembled role payloads through the runtime routes

### Status

Complete

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

## Phase 7: Phase Execution System

### What

The runtime can now execute ordered phases, user stories, and tasks with validation gates between each step.

### Why

Sequential task execution alone is not enough for larger delivery work. The system needs to know what phase it is in, which story is active, which task is next, and whether each step actually satisfied its completion gate before moving forward.

### How

- define phases made of user stories and tasks
- track current phase, story, and task pointers inside runtime state
- execute tasks in order without skipping unfinished work
- validate tasks and stories through structured validation gates
- retry failed task gates and story gates within configured limits
- record phase, story, task, gate, and retry events for inspection

### Purpose

Add a structured execution backbone that prevents the runtime from claiming a larger body of work is complete when only part of it succeeded.

### Outcome

The backend can now run a multi-step implementation plan, validate each task and story before advancing, and fail the run conservatively when retries are exhausted.

### Architecture

- phase execution state lives in `packages/agent-core/src/runtime`
- phase validation gates and retry policy are enforced inside the persistent runtime service
- `apps/server` accepts phase execution plans through the runtime task API
- executor prompts and context payloads can now reflect the active phase, story, and task

### Status

Complete

## What Comes Next

The next major phase should build on these foundations instead of replacing them.

Likely next work:

- planner, executor, and verifier step orchestration
- richer prompt and context assembly
- richer validation targets such as lint, typecheck, and targeted test execution
- trace-level observability for edit attempts and recovery
- approval and review flows around diffs and execution
