# Phase 18: External Record Sync

## Purpose

Mirror runtime progress into external systems without making those systems authoritative.

The MVP repo uses Linear comments and sub-issues as a highly visible dashboard. Shipyard should take
that lesson while keeping the control plane as the actual source of truth.

## What We Build

- stage progress sync to an external record system
- child work-item sync for stories or stages
- approval, blocker, and completion sync
- PR and deploy link sync
- idempotent retry-safe sync behavior

## Why It Matters

Operators and stakeholders often need to follow progress without opening the runtime directly.

External records make the system easier to adopt operationally.

## How It Works

Typed runtime events produce outbound sync actions.

Those actions should be:

- idempotent
- resume-safe
- traceable
- derived from runtime truth

The external system mirrors state. It does not invent it.

## Outcome

After this phase:

- a run can be followed from outside the runtime UI
- PR and deploy links stay attached to the work record
- retries and resumes do not create duplicate external history

## What This Phase Does Not Do

This phase does not make external tickets the workflow engine.

It only mirrors runtime progression into operator-facing record systems.

## Exit Criteria

- external progress updates are consistent with runtime state
- sync actions are idempotent across retries and resumes
- PR and deploy references remain attached to the correct run or work item
