# Roadmap

## Purpose

This document is the canonical guide for what Shipyard has already satisfied, what is only partial, and what must be built next.

It exists so implementation follows one sequence and does not drift across sessions.

## Requirement Status

| Requirement | Status | Notes |
|---|---|---|
| Continuous operation | Complete | Persistent runtime loop exists and accepts work without restart. |
| Basic tool calls | Complete | `read_file`, `read_file_range`, `search_repo`, and surgical edit tools are all routed through the live runtime task path. |
| Surgical file editing | Complete | Anchor-based editing is implemented with validation and rollback. |
| Context injection | Complete | External context is accepted at task submission, assembled per role, bounded by deterministic budgets, and exposed through traces/debug payloads. |
| Multi-agent coordination | Partial | Planner/executor/verifier orchestration is real and specialist registry/skills now exist, but the broader orchestrator artifact and production-lead delegation flow is not fully implemented yet. |
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

### Status

Complete

## Phase 10: Typed Runtime Control Plane

Detailed phase guide:

- [phase-10-typed-control-plane.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-10-typed-control-plane.md)

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

## Phase 11: Specialist Agent Registry + Skills

Detailed phase guide:

- [phase-11-specialist-agent-registry.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-11-specialist-agent-registry.md)

### Goal

Make specialist developers and their skills first-class runtime entities.

### Build

- add a typed specialist dev registry
- load specialist skill documents at runtime
- attach specialist identity, tool scope, and skill ids to control-plane agents
- inject assigned specialist guidance into planner/executor/verifier payloads
- enforce delegated tool scope during execution

### Why this comes fourth

The control plane must exist before specialist identity and tool permissions can be implemented safely.

### Exit Criteria

- a typed specialist registry exists
- runtime loads specialist skill documents
- control-plane ownership resolves specialist identity for stories and tasks
- delegated tool scope is enforced objectively

### Status

Complete

## Phase 12: Production Lead Delegation Flow

### Goal

Implement the production-lead workflow that turns orchestrator artifacts into delegated specialist work.

### Build

- orchestrator artifact handoff into the production lead
- production-lead routing rules for stories and tasks
- bounded specialist delegation artifacts
- explicit merge and conflict resolution rules
- validation gating at specialist delivery boundaries

### Why this comes fifth

Specialist agents exist after Phase 11, but the production lead still needs to govern how their work is assigned and merged.

### Exit Criteria

- orchestrator output can be handed to the production lead as a typed artifact
- specialist assignments are traceable and deterministic
- merge/conflict decisions are explicit runtime state

## Phase 12.5: Memory and Context Hardening

Detailed phase guide:

- [phase-12-5-memory-context-hardening.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-12-5-memory-context-hardening.md)

### Goal

Harden working context and runtime memory before the Ship rebuild begins.

### Build

- add token-aware context budgeting
- add explicit output token caps for model-backed roles
- add runtime schemas for context, artifacts, and handoffs
- define richer episodic-memory and retrieval contracts
- add artifact compression and summarization rules
- keep prompt context, durable runtime state, and memory retrieval as separate layers

### Why this comes next

Shipyard has structured context assembly, but its current memory model is still too shallow for a
long-running rebuild workflow. This phase closes the highest-risk context and memory gaps before Phase 13.

### Exit Criteria

- role payload budgets are token-aware and observable
- model-backed execution uses explicit output caps
- runtime boundary objects are validated at runtime
- retrieval and memory layers are defined clearly enough to build Phase 13 safely

### Status

In progress

## Phase 13: Ship Rebuild Framework

### Goal

Turn the Ship rebuild into the real system integration test.

### Build

- a first-class rebuild run type
- rebuild target metadata
- intervention log schema
- rebuild artifact log schema
- rebuild-specific tracing and summaries

### Why this comes sixth

The rebuild only becomes valuable when the runtime can capture intervention data and execution evidence cleanly.

### Exit Criteria

- the runtime can launch and track a Ship rebuild
- every intervention is recorded
- rebuild outputs and validation results are preserved as evidence

## Phase 14: Comparative Analysis

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

## Roadmap Enhancements

These phases extend Shipyard's current runtime with a clearer operator workflow and a more legible
factory experience.

They are intended as additive improvements on top of the existing typed runtime, not a return to
prompt-only orchestration.

## Phase 15: Operator Workflow Foundation

Detailed phase guide:

- [phase-15-operator-workflow-foundation.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-15-operator-workflow-foundation.md)

### Goal

Make active runs understandable to an operator without reading traces, prompts, or raw runtime state.

### Build

- a clear stage model such as `Spec`, `Arch`, `Dev`, `QA`, and `Deploy`
- an operator-facing run view with stage, owner, blockers, retries, and next action
- a human-readable run journal derived from typed runtime state
- clearer blocked and retry summaries

### Why this comes next

Shipyard already has a stronger runtime core than the MVP repo. The immediate gap is operational
clarity.

### Exit Criteria

- an operator can tell what stage a run is in
- current owner and blockers are visible without inspecting raw traces
- retry and failure reasons are visible in a clear run journal

### Status

Complete

## Phase 16: Human Approval Gates

Detailed phase guide:

- [phase-16-human-approval-gates.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-16-human-approval-gates.md)

### Goal

Add explicit human checkpoints before architecture, implementation, and deployment.

### Build

- typed approval gates in the control plane
- pause and resume behavior at gate boundaries
- approval, rejection, and rejection-reason records
- operator actions for approve, reject, and request retry

### Why this comes after Phase 15

The operator view should exist before the runtime starts depending on human approvals.

### Exit Criteria

- the runtime cannot cross defined gates without an explicit decision
- approval and rejection history is preserved as runtime data
- blocked and rejected work is visible to operators immediately

### Status

Planned

## Phase 17: Orchestrator Artifacts and Structured Decomposition

Detailed phase guide:

- [phase-17-orchestrator-artifacts-and-structured-decomposition.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-17-orchestrator-artifacts-and-structured-decomposition.md)

### Goal

Turn planning outputs into first-class typed artifacts that the production lead can route
deterministically.

### Build

- typed requirements artifacts
- typed architecture-decision artifacts
- typed subtask breakdown artifacts
- explicit acceptance and validation targets for delegated work
- deterministic decomposition contracts instead of loose text parsing

### Why this comes after approvals

Approval gates are more meaningful when the reviewed object is a typed artifact instead of only a
prompt-shaped result.

### Exit Criteria

- orchestrator outputs are stored as typed artifacts
- production lead handoffs can reference those artifacts directly
- decomposition produces structured work packets that can be delegated safely

### Status

Planned

## Phase 18: External Record Sync

Detailed phase guide:

- [phase-18-external-record-sync.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-18-external-record-sync.md)

### Goal

Mirror runtime progress into external record systems without making them the source of truth.

### Build

- external progress updates for stages, blockers, approvals, and completions
- child work-item sync for stories or stages
- PR and deploy link sync
- idempotent retry-safe sync behavior

### Why this comes after artifact hardening

External systems should reflect runtime truth, not invent it.

### Exit Criteria

- external progress updates do not duplicate on resume or retry
- PR and deploy links stay aligned with runtime state
- operators can follow a run from outside the core runtime UI

### Status

Planned

## Phase 19: Factory Mode

Detailed phase guide:

- [phase-19-factory-mode.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-19-factory-mode.md)

### Goal

Offer a higher-level greenfield factory workflow on top of Shipyard's typed runtime.

### Build

- request intake for greenfield app creation
- repo bootstrap flow
- staged implementation flow from plan to PR
- deploy handoff and delivery summary

### Why this comes after external sync

Factory mode is a product workflow. It should sit on top of clearer runtime artifacts and operator
surfaces, not replace them.

### Exit Criteria

- Shipyard can run a greenfield workflow from intake to deliverable output
- repo, PR, and deploy surfaces are visible as part of the run
- factory mode reuses the typed runtime instead of bypassing it

### Status

Planned

## Phase 20: Merge and Conflict Governance

Detailed phase guide:

- [phase-20-merge-and-conflict-governance.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-20-merge-and-conflict-governance.md)

### Goal

Make merge decisions, conflicts, retries, and reassignments explicit runtime behavior.

### Build

- conflict records for parallel specialist output
- merge decision records owned by the production lead
- reassignment and retry rules after failed integration
- specialist boundary enforcement at merge time

### Why this comes after factory mode

The system should first prove the higher-level workflow before hardening the most complex merge
cases.

### Exit Criteria

- conflicting specialist output is recorded explicitly
- merge, retry, and reassign decisions are inspectable in runtime state
- the production lead governs integration outcomes objectively

### Status

Planned

## Phase 21: Delivery Summary and Operator Evaluation

Detailed phase guide:

- [phase-21-delivery-summary-and-operator-evaluation.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-21-delivery-summary-and-operator-evaluation.md)

### Goal

Turn each run into a reviewable delivery artifact and a source of operational learning.

### Build

- final delivery summaries with outputs, links, risks, and follow-ups
- operator scorecards for blockers, retries, approvals, and interventions
- bottleneck and failure-pattern reporting

### Why this comes last

Evaluation is most useful after the operator workflow and factory flow produce consistent artifacts.

### Exit Criteria

- every completed run can produce a delivery summary
- operators can review intervention and blocker patterns across runs
- improvement opportunities are visible without replaying traces manually

### Status

Planned

## Implementation Discipline

- Do not widen scope early.
- Do not start Ship rebuild before intervention logging exists.
- Do not treat prompt text as the source of workflow truth.
- Do not change the file-editing strategy casually after ADR-003 without a new decision record.
