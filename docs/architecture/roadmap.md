# Roadmap

## Purpose

This document is the canonical guide for what Shipyard has already satisfied, what is only partial, and what must be built next.

It exists so implementation follows one sequence and does not drift across sessions.

## Requirement Status

| Requirement | Status | Notes |
|---|---|---|
| Continuous operation | Complete | Persistent runtime loop exists and accepts work without restart. |
| Basic tool calls | Partial | `edit_file` is end-to-end; `read_file`, `read_file_range`, and `search_repo` are not yet fully routed through the runtime task path. |
| Surgical file editing | Complete | Anchor-based editing is implemented with validation and rollback. |
| Context injection | Partial | Role-scoped context assembly exists, but external runtime context and stronger budget/truncation policy still need work. |
| Multi-agent coordination | Partial | Planner/executor/verifier orchestration is real, but the broader orchestrator -> production lead -> specialist dev model is not yet implemented. |
| Observability | Complete for core tracing | LangSmith plus local logs exist, but richer operator-facing query and evaluation flows can improve. |
| Ship rebuild | Missing | No first-class rebuild execution or intervention logging exists yet. |
| Comparative analysis | Missing | No report generation pipeline exists yet. |

## Current Principles

- Do not move forward based on roadmap language alone. Move forward only when the requirement is implemented and testable.
- Keep the runtime control plane in TypeScript. Prompts and skills describe behavior, but typed state defines truth.
- Keep file editing surgical and validated before expanding coordination complexity.
- Treat the Ship rebuild as an integration test and data source, not just a demo.

## Phase Order

The next phases should be implemented in this order.

## Phase 8: End-to-End Tooling

### Goal

Close the current gap between the repo tool library and the live runtime.

### Build

- expose `read_file` through the runtime task path
- expose `read_file_range` through the runtime task path
- expose `search_repo` through the runtime task path
- add end-to-end tests proving `read_file` and `edit_file` both work through the runtime API
- align `PRESEARCH.md` with the actual anchor-based editing strategy already accepted in ADR-003

### Why this comes first

The runtime should not grow into a richer multi-agent system while the most basic read/edit loop is still uneven.

### Exit Criteria

- `read_file`, `read_file_range`, `search_repo`, and `edit_file` are all callable end-to-end through runtime APIs
- tests prove the live path, not only library behavior
- `PRESEARCH.md` and ADR-003 describe the same editing strategy

## Phase 9: External Context Injection

### Goal

Make runtime context injection explicit, typed, bounded, and inspectable.

### Build

- accept external context payloads at task submission
- support context kinds such as spec, schema, prior output, test result, diff summary, and validation target
- ensure planner, executor, and verifier all consume role-scoped payloads in live execution
- add context budget and truncation rules
- record omitted sections and truncation decisions in traces

### Why this comes second

Role execution quality depends on good context shaping. This should be hardened before the orchestration model grows more complex.

### Exit Criteria

- runtime accepts external context without prompt hacks
- all role invocations consume the assembled payloads
- context omission and truncation are deterministic and inspectable

## Phase 10: Typed Runtime Control Plane

### Goal

Move the workflow model from implicit prompt behavior into explicit TypeScript state.

### Build

- add typed workflow entities for phase, story, task, artifact, handoff, and intervention
- add typed orchestration ownership for orchestrator, production lead, specialist devs, and execution subagents
- define allowed state transitions and retry policies in TypeScript
- store progress, blockers, ownership, and validation state in the runtime

### Why this comes third

This is the foundation for objective coordination. Without it, the broader agent team model will be fuzzy and fragile.

### Exit Criteria

- runtime execution is backed by a typed control plan
- ownership and handoffs are explicit state, not inferred from prompts
- validation gates block progression objectively

## Phase 11: Agent Team Model

### Goal

Implement the broader agent-team workflow on top of the control plane.

### Build

- orchestrator role that turns user intent into a requirements artifact, stories, and tasks
- production lead role that assigns stories and tasks to specialist devs
- specialist dev agent registry with role-specific skills and allowed tool scopes
- execution subagent creation for narrow implementation work
- explicit merge and conflict resolution rules for cross-agent output

### Why this comes fourth

The control plane must exist before the team model can be implemented safely.

### Exit Criteria

- at least two specialist agents can be delegated work through the production lead
- handoffs, ownership, merge decisions, and conflicts are traceable
- specialist roles are defined by typed runtime contracts plus skills

## Phase 12: Ship Rebuild Framework

### Goal

Turn the Ship rebuild into the real system integration test.

### Build

- a first-class rebuild run type
- rebuild target metadata
- intervention log schema
- rebuild artifact log schema
- rebuild-specific tracing and summaries

### Why this comes fifth

The rebuild only becomes valuable when the runtime can capture intervention data and execution evidence cleanly.

### Exit Criteria

- the runtime can launch and track a Ship rebuild
- every intervention is recorded
- rebuild outputs and validation results are preserved as evidence

## Phase 13: Comparative Analysis

### Goal

Generate the final analysis from real rebuild data.

### Build

- a structured report generator
- a seven-section comparison output
- summaries driven by runs, traces, interventions, validation outcomes, and rebuild artifacts

### Why this comes last

The analysis must be derived from real data, not planned in advance and filled in later.

### Exit Criteria

- the final report is generated from real rebuild runs and intervention logs
- the report clearly documents strengths, failures, interventions, and follow-up improvements

## Implementation Discipline

- Do not widen scope early.
- Do not start Ship rebuild before intervention logging exists.
- Do not treat prompt text as the source of workflow truth.
- Do not change the file-editing strategy casually after ADR-003 without a new decision record.
