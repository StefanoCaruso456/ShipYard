# Phase 16: Human Approval Gates

## Purpose

Add explicit human checkpoints to Shipyard's workflow.

The MVP repo shows the value of simple approval moments before architecture, development, and
deployment. Shipyard should adopt that discipline, but with typed runtime state instead of relying
on external ticket movement alone.

## What We Build

- typed approval gates before:
  - architecture
  - implementation
  - deployment
- pause and resume behavior at gate boundaries
- approval, rejection, and rejection-reason records
- operator actions for approve, reject, and request retry
- gate visibility in the operator workflow view

## Why It Matters

Approval gates are where human judgment stays in the loop.

Without them, the runtime may be technically capable but operationally unsafe.

## How It Works

The control plane records gate objects and their status.

When a run reaches a gate:

- the runtime pauses progression
- the operator sees what is waiting for review
- an explicit decision is recorded
- the run either resumes, retries, or moves to blocked

## Outcome

After this phase:

- the runtime cannot silently move through key checkpoints
- human decisions become part of durable runtime truth
- blocked and rejected runs have a clear reason and history

## What This Phase Does Not Do

This phase does not yet define richer orchestrator planning artifacts.

It only adds the gating and approval mechanics needed to govern those artifacts safely later.

## Exit Criteria

- the runtime pauses at the defined gates
- approval and rejection are preserved as typed records
- operators can resume or reject work with clear consequences
