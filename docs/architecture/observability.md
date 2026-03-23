# Observability

## Decision

Use Langfuse as the primary tracing and observability stack for the product runtime.

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

## Phase Guidance

### Phase 1

- keep the debug endpoint
- keep startup/runtime logs clear
- make instruction loading observable

### Phase 2

- send structured traces to Langfuse
- persist run and step metadata
- include instruction injection records

### Phase 3

- dashboards
- run comparisons
- evaluation signals
- cost and failure trend reporting

## Important Constraint

Observability must cover both LLM and non-LLM steps. File loading, parsing, validation, and retries matter just as much as model calls.

