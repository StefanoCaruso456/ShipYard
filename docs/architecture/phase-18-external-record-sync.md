# Phase 18: External Record Sync

## Purpose

Mirror runtime progress into external systems without making those systems authoritative.

The MVP repo uses Linear comments and sub-issues as a highly visible dashboard. Shipyard should take
that lesson while keeping the control plane as the actual source of truth.

## What We Build

- a typed outbound sync outbox on each run
- a first external mirror provider backed by a file store
- stage progress sync for run, phase, story, and task records
- child work-item sync for phase, story, and task hierarchy
- approval, blocker, retry, failure, and completion sync
- PR and deploy link sync
- idempotent retry-safe sync behavior

## Why It Matters

Operators and stakeholders often need to follow progress without opening the runtime directly.

External records make the system easier to adopt operationally.

## How It Works

Typed runtime events and control-plane state produce outbound sync actions.

Those actions should be:

- idempotent
- resume-safe
- traceable
- derived from runtime truth

The external system mirrors state. It does not invent it.

The first provider uses a file-backed external record mirror so Shipyard can prove the integration
contract before binding to Linear, Jira, or another third-party system.

## Outcome

After this phase:

- a run can be followed from outside the runtime UI
- PR and deploy links stay attached to the work record
- retries and resumes do not create duplicate external history
- the runtime can expose mirrored parent/child work items and their update history through the API

## What This Phase Does Not Do

This phase does not make external tickets the workflow engine.

It only mirrors runtime progression into operator-facing record systems.

## Exit Criteria

- external progress updates are consistent with runtime state
- sync actions are idempotent across retries and resumes
- PR and deploy references remain attached to the correct run or work item

## Architecture

- typed external sync contracts live in `packages/agent-core/src/runtime/types.ts`
- sync-action derivation and dedupe live in `packages/agent-core/src/runtime/externalRecordSync.ts`
- runtime persistence and sync orchestration live in `packages/agent-core/src/runtime/createPersistentRuntimeService.ts`
- the file-backed mirror provider lives in `apps/server/src/runtime/createFileExternalRecordSyncService.ts`
- runtime APIs expose sync state and mirrored records in `apps/server/src/routes/runtime.ts`

## Status

Complete
