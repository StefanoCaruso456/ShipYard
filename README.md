# Shipyard

Shipyard is the workspace for building an autonomous coding agent that can make surgical code edits, accept runtime context, coordinate multiple agents, and eventually rebuild the Ship app as its real integration test.

## What

- A persistent coding agent with a client, server, and shared packages
- A repo structure that is ready for the upcoming PRESEARCH and implementation phases
- A starter contract for agent architecture, tracing, and product intent

## Why

The assignment is not about generating code quickly. It is about designing an agent that can edit safely, stay observable, and complete real work without rewriting everything around it.

## How

- `apps/client` is the operator-facing UI shell
- `apps/server` is the future orchestration layer for the agent loop, tools, and traces
- `packages/shared` keeps the product brief and shared contracts in one place
- `packages/agent-core` holds the starter agent decisions and runtime types

## Outcome

This repo is now wired as a lean monorepo so we can move straight into PRESEARCH, lock the architecture, and then build the actual coding agent on top of a clean structure.

## Tree

```text
shipyard/
├── apps/
│   ├── client/
│   └── server/
├── packages/
│   ├── agent-core/
│   └── shared/
├── CODEAGENT.md
├── PRESEARCH.md
└── README.md
```

## Run

```bash
cp .env.example .env
pnpm install
pnpm dev
```

