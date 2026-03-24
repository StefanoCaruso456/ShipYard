# Observability

## Decision

Use LangSmith as the primary tracing and observability backend for the product runtime, with local structured logs as the fallback path when tracing is disabled or unavailable.

## Goal

Every run should be explainable after the fact:

- what task ran
- which instructions were injected
- which role acted
- which tools were called
- what changed
- what validation ran
- why the run stopped, retried, or failed

## Required Runtime Signals

Log at minimum:

- run id
- task id
- role (`planner`, `executor`, `verifier`)
- active skill id and version
- injected section ids
- tool calls and outputs
- edit attempts
- validation commands and results
- retries
- rollback events
- token and cost data

## Current focus

The next observability phase should trace the runtime that already exists today:

- root task runs
- phase, story, and task execution
- context assembly
- repo tool calls
- file edits
- validation, retries, and rollbacks
- model usage, latency, and cost when available

Planner, executor, and verifier spans should be added once that orchestration path is the active runtime path.

## Important Constraint

Observability must cover both LLM and non-LLM steps. File loading, context assembly, validation, retries, and rollbacks matter just as much as model calls.
