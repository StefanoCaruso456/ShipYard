# Runtime Architecture

## Goal

Define the shape of the long-running product runtime before expanding model orchestration, persistence, or hosting complexity.

## Runtime Modules

The runtime should converge on these modules:

- instruction registry
- task intake and queueing
- run state manager
- planner
- executor
- verifier
- tool registry
- validation engine
- trace recorder

## Current Phase

Phase 1 is intentionally narrower:

- cached `skill.md` loading
- frontmatter parsing
- markdown section parsing
- role-specific skill views
- runtime boot wiring
- debug endpoint for inspection

This phase proves the instruction pipeline before full task execution exists.

## Ownership

### `apps/server`

- boots the runtime
- exposes runtime/debug endpoints
- reports health and readiness
- later owns task intake and external API access

### `packages/agent-core`

- loads and parses instructions
- assembles role-specific context
- owns runtime state types
- later owns loop logic, tools, validation, and recovery

## Role Model

Start with a sequential role flow:

1. planner
2. executor
3. verifier

Keep this simple until:

- instruction loading is stable
- editing strategy is locked
- validation and recovery are predictable

## Non-Goals Right Now

- no parallel sub-agent orchestration
- no durable task queue yet
- no runtime prompt registry yet
- no persistent run state yet
- no model-calling loop in the server yet

## Phase 2 Direction

After phase 1 instruction loading is stable:

- add task intake
- add run state persistence
- add planner/executor/verifier prompt assembly
- add tool execution contracts
- add trace records for instruction injection and step flow

