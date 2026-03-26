# Phase 17: Orchestrator Artifacts and Structured Decomposition

## Purpose

Turn planning output into first-class runtime artifacts.

Shipyard's control plane is strongest when workflow truth is typed. This phase applies that same
discipline to orchestrator output so the production lead delegates based on structured artifacts,
not on loosely interpreted text.

## What We Build

- typed requirements artifacts
- typed architecture-decision artifacts
- typed subtask breakdown artifacts
- explicit acceptance criteria and validation targets per delegated work packet
- a deterministic decomposition contract for specialist routing

## Why It Matters

The MVP repo is easy to follow because spec and architecture are concrete handoff points.

Shipyard should preserve those handoff points, but represent them as typed runtime artifacts that
can be validated and traced objectively.

## How It Works

The control plane now records typed artifacts for:

- plan
- phase requirements
- story architecture decisions
- story subtask breakdowns
- delegation briefs

Each handoff also carries a structured work packet that includes:

- source artifact ids
- scope summary
- constraints
- file targets
- domain targets
- acceptance criteria
- validation targets
- dependency ids
- task ids

The production lead and specialist agents now delegate from those typed packets instead of relying
on summary prose alone.

## Outcome

After this phase:

- orchestrator output becomes inspectable runtime data
- specialist delegation can reference concrete artifacts
- decomposition becomes more deterministic and easier to audit

## What This Phase Does Not Do

This phase does not yet add external issue syncing or full factory-mode repo lifecycle behavior.

It only hardens the planning and handoff contract.

## Exit Criteria

- orchestrator outputs are stored as typed artifacts
- decomposition produces structured work packets
- production-lead delegation references artifacts directly
- runtime tests prove the new artifacts and work packets are created deterministically
