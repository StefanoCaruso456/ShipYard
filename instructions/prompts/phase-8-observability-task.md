# Phase 8 Task Prompt

## Title

Implement Phase 8: Observability and Trace System

## Objective

Implement a production-grade observability and trace system for the Shipyard runtime so every meaningful run can be reconstructed end-to-end in LangSmith and in local structured logs.

This phase starts from the current system as it exists today:

- instruction runtime exists
- persistent runtime loop exists
- repo inspection and surgical editing exist
- validation and recovery exist
- context assembler exists
- phase, story, and task execution exists

The goal is to make the current runtime observable before deeper autonomous orchestration expands.

## Why this matters

We need traceability for:

- successful runs
- failed runs
- phase, story, and task execution
- context assembly
- tool execution
- file edits
- validation outcomes
- retries
- rollbacks
- token, latency, and cost analysis
- injected instruction sections

The result should make it easy to answer:

- What happened in this run?
- Which task, story, and phase were active?
- Which files were selected and why?
- What tool calls were made?
- What changed in the repo?
- Why did validation pass or fail?
- Where did the run break?
- How much time, tokens, and cost did the run consume?

## Primary outcome

Add structured tracing around the runtime using LangSmith as the main trace backend, plus local structured logs for debugging and fallback inspection.

## Runtime scope for this phase

Trace the system we actually have now:

- root runtime runs
- phase, story, and task execution
- context assembly
- OpenAI executor calls
- repo tool calls
- edit validation
- retries
- rollbacks

Do not pretend planner, executor, and verifier are the live orchestration path if they are not yet the active execution loop.

## Requirements

### 1. Root run trace

Create a top-level trace or span for every runtime task run.

Capture:

- `runId`
- task summary
- runtime version
- repo or workspace identifier
- start timestamp
- end timestamp
- final status
- total duration
- total token usage if available
- total estimated cost if available

### 2. Step trace records

Represent each meaningful runtime step as a child trace or structured event.

At minimum include:

- phase execution steps
- story transitions
- task execution
- context assembly
- OpenAI execution
- validation checks
- retry and rollback actions

Each step record must include:

- `stepId`
- step type
- input summary
- output summary
- status
- startedAt
- endedAt
- durationMs

### 3. File selection logging

Whenever the runtime selects files for context or execution, log:

- selected file path
- why it was selected
- selection source (`search_repo`, explicit task input, retry recovery, validator feedback, etc.)
- optional relevance or confidence score if available

### 4. Tool call logging

Every tool call must be logged as a child event or span with:

- tool name
- tool input summary
- normalized tool output summary
- success or failure
- typed error if failed
- latencyMs

At minimum support:

- repo inspection tools
- repo mutation tools
- validation tools

### 5. Edit logging

When a file is changed, log:

- file path
- edit strategy used
- anchor or patch target summary
- before and after summary
- whether post-edit validation confirmed placement
- whether rollback checkpoint existed

Prefer summaries and targeted diffs over full file contents.

### 6. Validation logging

For each validation step, log:

- validator name
- command or validator description
- result status
- summarized output
- durationMs

### 7. Retry logging

When a retry occurs, log:

- retry count
- retry reason
- failed prior step
- new strategy or changed target if any

### 8. Rollback logging

When rollback occurs, log:

- rollback trigger
- affected files
- rollback reference or checkpoint summary
- rollback outcome

### 9. Instruction and context logging

For each role-scoped context payload or runtime prompt assembly, record:

- role or payload type
- instruction source file
- sections included
- context size estimate
- whether context was truncated or summarized

### 10. Token, time, and cost fields

Capture when available:

- model name
- input tokens
- output tokens
- total tokens
- provider latency
- estimated cost

Support nullable values if exact usage or cost is unavailable.

## LangSmith integration requirements

Use LangSmith as the primary trace backend.

Support configuration through:

- `LANGSMITH_TRACING`
- `LANGSMITH_API_KEY`
- `LANGSMITH_WORKSPACE_ID`
- `LANGSMITH_PROJECT`

Recommended default project name:

- `shipyard-runtime-observability`

If LangSmith is unavailable or disabled, the runtime must still emit local structured logs.

## Architecture expectations

Implement a thin internal tracing layer so the runtime is not tightly coupled to LangSmith internals.

Suggested modules:

- `TraceService`
- `RunTrace`
- `StepTrace`
- `ToolTrace`
- `ValidationTrace`
- `EditTrace`

Suggested file layout:

- `src/observability/types.ts`
- `src/observability/traceService.ts`
- `src/observability/langsmithTracer.ts`
- `src/observability/logger.ts`

Adjust paths to fit the repo structure if needed.

## Non-goals

Do not:

- redesign the runtime loop
- redesign tools
- redesign validation
- build the full planner/executor/verifier loop in this phase
- add dashboards or alerting systems unless trivial

This phase is strictly about observability and traceability.

## Implementation guidance

- wrap the top-level runtime task execution in a root trace
- create nested traces for phase, story, and task execution
- trace context assembly explicitly
- wrap each repo tool call in child tracing
- wrap validation, retry, and rollback paths in child tracing
- attach metadata instead of huge raw payloads wherever possible
- ensure failed exceptions are traced before being rethrown or handled
- keep trace ids stable and tied to runtime ids

## Deliverables

1. trace service abstraction
2. LangSmith-backed tracer implementation
3. local structured log fallback
4. instrumented runtime loop
5. instrumented phase, story, and task execution
6. instrumented tool execution
7. instrumented validation, retry, and rollback paths
8. debug documentation for inspecting one run
9. environment variable documentation

## Acceptance criteria

This phase is complete when:

- a successful run can be reconstructed end-to-end
- a failed run can be reconstructed end-to-end
- phase, story, and task transitions are individually visible
- tool calls are visible with inputs, outputs, and errors
- edit attempts and validation outcomes are visible
- retries and rollbacks are explicitly visible
- injected instruction or context sections are visible
- token, time, and cost fields are captured where available
- tracing works in LangSmith when enabled
- tracing still works locally when LangSmith is disabled

## Output format

Return:

1. implementation summary
2. files created or updated
3. key tracing schema and types
4. env vars required
5. gaps or follow-up recommendations
