# Phase 11: Specialist Agent Registry + Skills

## Purpose

Turn the abstract agent team model into explicit runtime data and reusable skill documents.

This phase gives the runtime a typed registry of specialist developer identities and connects those identities to:

- skill documents
- allowed tool scopes
- allowed handoff targets
- validation focus
- assigned execution subagents

## What We Build

- a typed specialist agent registry in TypeScript
- dedicated skill documents for:
  - production lead
  - execution subagent
  - frontend dev
  - backend dev
  - repo tools dev
  - observability dev
  - rebuild dev
- runtime loading for those specialist skills
- control-plane ownership that distinguishes:
  - runtime role
  - specialist identity
  - skill set
- context injection for assigned specialist guidance
- execution-time tool-scope enforcement for delegated tasks

## Why It Matters

Without a registry, the “agent team” is just role-flavored prompt text.

With a registry:

- specialist identity is explicit
- tool permissions are objective
- handoff targets are constrained
- traces can show who owned the work and under which specialist contract
- specialist guidance can be injected without turning prompts into the source of truth

This follows the same core pattern encouraged by OpenAI and Anthropic:

- keep agents specialized
- keep tool access bounded
- keep handoffs explicit
- keep runtime state authoritative

## How It Works

The runtime keeps coarse control-plane roles:

- `orchestrator`
- `production_lead`
- `specialist_dev`
- `execution_subagent`

Then the registry attaches specialist identity on top:

- `frontend_dev`
- `backend_dev`
- `repo_tools_dev`
- `observability_dev`
- `rebuild_dev`

Each registry definition provides:

- label and description
- domain tags
- skill references
- allowed tool names
- allowed handoff targets
- default validation focus

The control plane uses that registry to assign:

- a specialist dev to each story
- an execution subagent to each task

The context assembler then injects the assigned specialist skill guidance into planner, executor, and verifier payloads.

The orchestration loop enforces the delegated tool scope before execution begins.

## Outcome

After Phase 11:

- specialist developers are first-class runtime entities
- skill guidance is loaded and injected deterministically
- delegated tasks carry explicit specialist identity
- execution subagents cannot use tools outside their assigned scope
- traces and control-plane state can explain not only what happened, but which specialist contract governed it

## What This Phase Does Not Do

This phase does not yet implement the full production-lead delegation workflow for turning orchestrator artifacts into assigned work.

That is Phase 12.

## Exit Criteria

- a typed specialist registry exists
- specialist skill documents load at runtime
- control-plane stories and tasks resolve specialist ownership
- role payloads include assigned specialist guidance when present
- delegated tool usage is enforced against execution-subagent scope
