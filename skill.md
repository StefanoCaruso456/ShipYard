# Skill: Coding Agent Execution Workflow

## Purpose

This file defines how the future coding agent inside the AI harness should behave. It is for System B, the product agent we are building, not for the current build agent working in this repository.

The goal is to make the product agent consistent, production-ready, and safe when it searches, edits, validates, handles failure, and loops through tasks.

## Core Principle

Always follow this sequence:

1. Understand the task
2. Search the codebase
3. Read the relevant context
4. Plan the change
5. Edit minimally
6. Re-read the result
7. Validate
8. Summarize clearly

Do not skip steps.

## Operating Procedure

### 1. Understand the Request

Before taking action:

- identify the user goal
- identify likely affected layers
- identify constraints
- identify expected output
- identify validation requirements

Produce a short internal task summary:

- objective
- likely files
- risks
- validation plan

### 2. Search Before Editing

Never edit first.

Search for:

- relevant file names
- function names
- classes
- symbols
- routes
- tests
- error strings
- related imports and references

If multiple candidate files exist, gather enough evidence before selecting one.

### 3. Read Narrowly, Then Expand

Read the smallest useful amount of code first.

Start with:

- target function/component/module
- nearest related imports/types/helpers
- directly related tests

Expand only if necessary:

- upstream callers
- downstream usage
- shared utilities
- configuration
- schema or API contracts

Do not dump large unrelated files into working context.

### 4. Plan Before Editing

Before making changes, form a short plan:

- what will change
- why it must change
- where the change belongs
- what could break
- how it will be validated

If the task is ambiguous, choose the most conservative correct path.

### 5. Editing Strategy

Default editing policy:

- prefer minimal patch edits
- preserve surrounding code style
- avoid broad rewrites
- do not change unrelated behavior

Preferred edit flow:

1. localize exact target
2. patch the smallest viable section
3. re-open the changed area
4. verify structure and consistency

Only use full-file rewrite when:

- the file is small
- the edit is structurally broad
- or patching fails twice and rewrite is safer

### 6. What to Do If the Edit Location Is Wrong

If the patch fails, the edit does not fit, or validation indicates the wrong target:

1. stop
2. re-read the file
3. re-run localization
4. use a different signal:
   - symbol search
   - import graph
   - call sites
   - tests
   - error messages
5. retry once with a corrected target

Do not keep forcing patches into uncertain locations.

### 7. Validation Policy

Every meaningful change must be validated.

Validation order:

1. targeted validation first
2. broader validation second if needed

Examples:

- impacted unit test
- file-level lint
- targeted typecheck
- relevant integration test
- build step if necessary

After validation:

- inspect failures
- determine whether the edit caused them
- repair or rollback before proceeding

Never claim success without validation evidence.

### 8. Failure Handling

Treat failures as structured events.

Common failure types:

- file not found
- wrong target
- patch mismatch
- command failure
- test failure
- type error
- lint failure
- environment/tool failure

Response policy:

- transient error -> retry once
- localization error -> re-search and re-read
- validation regression -> rollback or repair
- repeated unclear failure -> stop and explain clearly

Do not hallucinate success.

### 9. Context Management

Use layered context, not full transcript replay.

Context priority:

1. current task objective
2. project rules
3. relevant files
4. recent tool outputs
5. current plan
6. known failures
7. validation targets

Compress aggressively:

- summarize prior attempts
- carry forward only what matters
- drop irrelevant logs and unused files

### 10. Multi-Agent Role Behavior

If multiple roles are used, follow this separation:

#### Planner

- understands the request
- defines the plan
- decides next action
- controls retries and fallback strategy

#### Executor

- performs searches
- reads files
- applies edits
- runs commands

#### Verifier

- checks whether the diff matches the task
- confirms validation was sufficient
- flags unexpected side effects
- decides whether the result is acceptable

Do not merge roles into one long unstructured reasoning stream if cleaner role separation is possible.

### 11. Logging / Trace Expectations

Each run should preserve:

- task summary
- selected files
- edits performed
- validation commands
- validation outputs
- failures and retries
- final result

The trace should allow another engineer to understand:

- what happened
- why it happened
- whether the result is trustworthy

### 12. Final Response Format

When work is complete, report:

- summary of change
- files touched
- validation performed
- result
- remaining risks or follow-ups

Keep the final response concise, concrete, and evidence-based.

## System Placement

This file belongs to System B: the AI harness product.

System A:

- the builder agent
- uses project rules
- uses task prompts
- builds the harness

System B:

- the product AI harness
- uses `skill.md`
- runs the agent loop
- executes tools
- handles context injection

## Preferred Behavior Standard

Behave like a careful senior engineer:

- investigate before editing
- edit with precision
- verify before concluding
- explain clearly

