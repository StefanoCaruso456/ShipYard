# Phase 10: Typed Runtime Control Plane

## Purpose

Move workflow truth out of prompts and into explicit TypeScript state.

Prompts and skills should guide behavior. The control plane should decide:

- who owns work
- what state the run is in
- what can happen next
- what is blocked
- what passed validation
- what must retry or fail

## What We Build

This phase adds a typed runtime model for:

- phases
- stories
- tasks
- artifacts
- handoffs
- interventions
- blockers
- validation state
- retry state

It also adds explicit ownership across:

- orchestrator
- production lead
- specialist dev agents
- execution subagents

## Why It Matters

Without a control plane, workflow truth lives in prompts, traces, and role behavior.

That is fragile.

The runtime may look coordinated, but ownership, retries, blockers, and approvals are still being inferred after the fact instead of enforced while the run is happening.

This phase makes coordination objective.

## How It Works

- define typed workflow entities in TypeScript
- define allowed state transitions in TypeScript
- track ownership as explicit runtime state
- store handoffs as first-class records
- store validation gates and retry limits as first-class records
- record interventions when a human redirects, unblocks, or overrides execution
- keep the control-plane snapshot attached to the run so traces and APIs can inspect it

## Outcome

After this phase, the runtime can answer clearly:

- who owns the current task
- what already happened
- what is blocked
- what retried
- what artifacts were produced
- what validation evidence exists
- whether work can move forward

That gives the next phase a real foundation for the agent team model.

## What This Phase Does Not Do

This phase does not yet implement the full agent team.

It does not yet add:

- orchestrator research artifacts flowing through production lead delegation
- specialist agent registry and skills
- execution subagent fan-out
- Ship rebuild runs

It only creates the typed runtime backbone those phases will use.

## Exit Criteria

This phase is complete when:

- runtime execution is backed by a typed control plan
- ownership and handoffs are explicit state, not inferred from prompts
- validation gates can block progression objectively
- retries and blockers are represented as state, not only as trace text
- interventions are recorded as first-class runtime data

## Related Docs

- [roadmap.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/roadmap.md)
- [control-plane.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/control-plane.md)
- [agent-team-model.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/agent-team-model.md)
