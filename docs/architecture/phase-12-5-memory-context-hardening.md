# Phase 12.5: Memory and Context Hardening

## Purpose

Strengthen Shipyard's working context and runtime memory model before the Ship rebuild begins.

The runtime already has structured context assembly, durable control-plane state, and tracing, but it
does not yet manage memory with enough precision to support longer-running, higher-stakes execution.

This phase exists to harden the boundaries first:

- token-aware working context budgets
- explicit output caps
- typed schemas at runtime boundaries
- richer episodic memory primitives
- role-based retrieval policy
- artifact compression rules

## What This Phase Builds

### Working Context

- role-scoped context remains bounded and inspectable
- prompt budgets become token-aware, not only character-aware
- each role gets an explicit output-token cap

### Runtime Schemas

- context, artifact, and handoff payloads gain runtime validation
- API and persistence boundaries stop relying only on TypeScript compile-time safety

### Episodic Memory Foundation

- prior runs, interventions, failures, and successful patterns become retrievable concepts
- retrieval policy is defined per role instead of implicitly reusing whatever is already on the run

### Compression and Summarization

- long artifacts and prior state should be compacted intentionally
- rolling summaries should evolve from a single latest note toward a more useful episodic layer

## Design Principles

- keep prompt context, durable runtime state, and memory retrieval as separate layers
- never assume unlimited context for any role
- budget by tokens where the model actually cares about tokens
- validate external boundary objects at runtime
- retrieve memory by role and task relevance, not by dumping history into prompts
- preserve observability for every budget, omission, truncation, and retrieval decision

## Phase Tasks

1. Add runtime schemas for context, artifacts, and handoffs.
2. Replace manual request parsing with schema-backed parsing.
3. Add token-aware prompt budgeting to role payload assembly.
4. Add explicit max output token caps for model-backed execution.
5. Record the new budget signals in traces.
6. Define the next episodic-memory and retrieval contracts before semantic memory is added.

## Validation

This phase should be verified through:

- schema tests for valid, invalid, and partially recoverable inputs
- context-assembler tests proving token budgets and truncation behavior
- executor tests proving output caps are passed to the model call
- trace tests proving budget signals are observable
- targeted typecheck and build runs for changed packages/apps

## Outcome

After this phase:

- role context is objectively bounded
- model output is explicitly capped
- runtime boundary objects are validated at runtime
- memory architecture is clearer and safer
- Ship rebuild work can start on top of a stronger context/memory foundation instead of prompt luck
