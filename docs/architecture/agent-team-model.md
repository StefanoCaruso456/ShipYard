# Agent Team Model

## Purpose

This document defines the intended team structure for Shipyard's broader multi-agent workflow.

It clarifies who does what, how work is handed off, and where skills fit into the system.

## Team Structure

The system should operate with this hierarchy:

```text
User
-> Orchestrator
-> Production Lead
-> Specialist Dev Agent
-> Execution Subagent
```

## Role Responsibilities

## Orchestrator

Owns:

- intake
- requirement analysis
- scoped planning
- turning user intent into artifacts

Output:

- requirements artifact
- phase plan
- user-flow spec
- data-flow spec
- user stories
- tasks
- constraints
- validation targets

The orchestrator should not directly own all implementation work.

## Production Lead

Owns:

- delegation
- sequencing
- dependency handling
- acceptance criteria enforcement
- cross-agent conflict resolution

The production lead receives orchestrator artifacts and decides which specialist dev should own each task.
It should also reject or block delegation when required flow artifacts are missing from the handoff.

The production lead should use a dedicated skill that emphasizes:

- task routing
- dependency awareness
- release discipline
- validation gating

## Specialist Dev Agents

Own bounded implementation areas.

Examples:

- `frontend_dev`
- `backend_dev`
- `repo_tools_dev`
- `observability_dev`
- `rebuild_dev`

Each specialist dev should have:

- a clear ownership boundary
- a typed specialist identity in the runtime registry
- a role-specific skill
- a defined tool scope
- allowed handoff targets

The intent is similar to specialized agency-style agents: each dev has a narrow working style and responsibility set instead of trying to be the whole team.

## Execution Subagents

Execution subagents are short-lived workers spawned by a specialist dev for narrow, concrete tasks.

Examples:

- add one runtime route
- patch one module
- write one test file
- adjust one trace schema

Rules:

- execution subagents should have the narrowest possible scope
- they should return artifacts or code changes, not own long-term workflow state
- the parent specialist dev remains accountable for validation

## Handoff Model

All handoffs should be explicit.

Each handoff should include:

- source role
- target role
- reason
- task ids
- artifact ids
- correlation id

Examples:

- orchestrator -> production lead
- production lead -> backend dev
- backend dev -> execution subagent
- execution subagent -> backend dev
- backend dev -> production lead

## Merge and Conflict Rules

Outputs should not be merged implicitly.

The production lead should own final merge decisions between specialist agents.

Conflict examples:

- two agents propose incompatible code changes
- one agent satisfies scope but breaks validation
- one agent edits outside its assigned boundary
- rebuild progress conflicts with runtime stability

Resolution strategies:

- accept one output and reject the other
- request a retry from the same owner
- reassign the task
- escalate back to orchestrator for re-planning

## Skills and Runtime State

The runtime separates three concerns:

- workflow role
- specialist identity
- skill guidance

Example:

- workflow role: `specialist_dev`
- specialist identity: `backend_dev`
- skill ids: `["backend_dev"]`

For execution workers:

- workflow role: `execution_subagent`
- specialist identity: `execution_subagent`
- inherited specialist skills: `["execution_subagent", "backend_dev"]`

Skills should shape how a role behaves.

The runtime control plane should determine:

- what the role is allowed to own
- which task is active
- whether a handoff is valid
- whether validation passed

In other words:

- skills define behavior
- the typed runtime control plan defines truth

## Registry Model

The specialist registry should be the canonical place for:

- specialist label
- description
- domain tags
- skill references
- allowed tool names
- allowed handoff targets
- default validation focus

That lets the production lead and runtime assign work objectively instead of relying on prompt-time naming conventions.

## Required Observability

The trace system should make the team model visible.

Trace at minimum:

- which role created the artifact
- which role accepted the handoff
- which role executed the task
- what validation happened
- why a retry or reassignment occurred
- where a human intervention changed the outcome

## Why This Model

This structure keeps the system from collapsing into one role pretending to be many.

It supports:

- bounded ownership
- better traces
- cleaner retries
- clearer intervention logging
- more defensible multi-agent claims
