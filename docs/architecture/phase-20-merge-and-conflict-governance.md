# Phase 20: Merge and Conflict Governance

## Purpose

Make parallel specialist output safe to integrate.

As Shipyard grows into a clearer factory workflow, it needs stronger governance for merges,
conflicts, retries, and reassignments.

## What We Build

- typed conflict records
- merge decision records owned by the production lead
- reassignment and retry rules after failed integration
- specialist boundary enforcement at merge time
- clearer integration blockers and resolution outcomes

## Why It Matters

Parallel specialist work is only useful if the system can explain why outputs were accepted,
rejected, retried, or reassigned.

## How It Works

The control plane now records typed merge governance state:

- `conflicts` for scope overlap, boundary violations, validation failures, and exhausted retry/replan paths
- `merge decisions` owned by the production lead with outcomes: `accept`, `retry`, `reassign`, or `reject`

Conflicts are currently created from two sources:

- overlapping story or task handoffs with colliding file or domain scope
- verifier/runtime integration failures during execution

Each record captures:

- what conflicted
- who owned the conflicting work
- which handoffs or file targets were involved
- what resolution was chosen
- whether the result was retry, reassign, reject, or accept

The operator view and trace summary now surface open conflicts and merge decisions directly.

The production lead remains the workflow authority for those integration outcomes, even when the
runtime records the first governance decision automatically.

## Outcome

After this phase:

- merge decisions are visible and auditable
- retries and reassignments are more disciplined
- specialists can work in parallel with stronger governance
- overlap and boundary problems show up in the operator view without reading raw state

## What This Phase Does Not Do

This phase does not add final cross-run evaluation or scorecards.

It focuses on safe integration behavior during execution.

## Exit Criteria

- conflict records are created for incompatible specialist output
- merge and resolution decisions are stored in runtime state
- reassign and retry paths are explicit and traceable
