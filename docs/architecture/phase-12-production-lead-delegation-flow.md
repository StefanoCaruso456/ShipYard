# Phase 12: Production Lead Delegation Flow

## Purpose

Make delegation a first-class runtime behavior instead of an implied side effect of phase execution.

The production lead should not only "own" a phase in name. It should issue explicit delegation briefs,
track acceptance, and leave clear evidence behind when work is handed to a specialist or execution
subagent.

## Design Principles

- keep the flow simple and typed before adding broader autonomy
- make planning and handoffs visible in runtime state
- keep worker scope narrow and explicit
- carry acceptance and validation targets with every delegation
- preserve blockers and retry interventions as runtime truth

## Delegation Flow

```text
Orchestrator
-> phase delegation brief
-> Production Lead
-> story delegation brief
-> Specialist Dev
-> task delegation brief
-> Execution Subagent
```

Each delegation should capture:

- who handed work off
- who accepted it
- what outcome is required
- which validation targets define success
- which dependencies must be satisfied first
- which artifact contains the delegation brief

## Runtime Behavior

Phase start:

- orchestrator hands phase coordination to the production lead
- the control plane records a phase delegation brief
- story handoffs are created for specialist ownership

Story start:

- specialist accepts the production lead handoff
- task handoffs are created for execution subagents

Task start:

- execution subagent accepts the task handoff

Task completion:

- task handoff completes
- result and validation artifacts are attached to runtime state

Story completion:

- story handoff completes
- delivery and validation artifacts are recorded

## Why This Matters

This follows the same broad operational advice seen in current OpenAI and Anthropic guidance:

- increase orchestration complexity only when it improves outcomes
- keep coordination transparent and inspectable
- decompose work into bounded handoffs with clear success criteria
- use runtime state and environment feedback instead of prompt memory as workflow truth

## Exit Criteria

This phase is complete when:

- story and task delegation briefs are created explicitly
- handoffs move through created, accepted, and completed states
- delegation records include dependencies, acceptance criteria, and validation targets
- completion and failure remain visible through artifacts, blockers, and interventions
