# Phase 15: Operator Workflow Foundation

## Purpose

Make Shipyard legible to an operator in real time.

The runtime already has typed execution state, tracing, and specialist roles, but it still asks too
much of the operator to reconstruct what is happening from raw internals.

This phase creates the first clear operator workflow layer.

## What We Build

- an initial operator stage model:
  - `Queued`
  - `Coordination`
  - `Execution`
  - `Validation`
  - `Rebuild`
  - `Delivery`
- an operator-facing run view that shows:
  - current stage
  - current owner
  - blockers
  - retries
  - next action
- a run journal derived from typed runtime state and events
- concise blocked and retry summaries

## Why It Matters

The MVP repo is valuable because its workflow is easy to understand even though its runtime is much
simpler.

Shipyard should keep its stronger core while gaining that same clarity.

## How It Works

The control plane remains the source of truth.

This phase adds a translation layer from runtime state into operator-facing concepts:

- stage
- handoff status
- blocker reason
- run summary
- run journal

These are intentionally generic runtime stages.

Factory-specific stages such as `Spec`, `Arch`, `Dev`, `QA`, and `Deploy` belong in later phases
once factory mode exists as a first-class workflow.

The goal is not to invent a second workflow engine. The goal is to make the existing one visible.

## Outcome

After this phase:

- an operator can understand the run without reading traces directly
- blocked and retrying work is immediately visible
- the system begins to feel like a usable workflow product instead of only an internal runtime

## What This Phase Does Not Do

This phase does not yet add human approvals or factory-mode repo lifecycle management.

It prepares the visibility layer those phases depend on.

## Exit Criteria

- stage, owner, blockers, and next action are visible in one place
- run journal entries are derived from typed state, not ad hoc prompt text
- retries and failures have concise operator-facing summaries
