# Shipyard

Shipyard is the workspace for building an autonomous coding agent that can make surgical code edits, accept runtime context, coordinate multiple agents, and eventually rebuild the Ship app as its real integration test.

The future product agent's execution behavior is defined in `skill.md`. The builder agent's per-task assignment format lives in `task-prompt-template.md`.
Architecture direction docs live in `docs/architecture`, locked decisions live in `instructions/decisions`, and repo-specific UI rules live in `instructions/rules`.

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
├── docs/
│   └── architecture/
├── instructions/
│   ├── decisions/
│   └── rules/
├── CODEAGENT.md
├── PRESEARCH.md
├── skill.md
├── task-prompt-template.md
└── README.md
```

## Run

```bash
cp .env.example .env
pnpm install
pnpm dev
```

## Deploy

- Vercel hosts `apps/client` using `vercel.json`.
- Railway hosts `apps/server` and PostgreSQL using `railway.json`.
- In Vercel, set `VITE_API_URL` to the Railway server origin so the client calls the live API in production.
- The runtime server reads `OPENAI_KEY` for Vercel AI SDK OpenAI calls. If the backend stays on Railway, set `OPENAI_KEY` there too. A Vercel env var alone will not reach the Railway runtime.
- GitHub Actions now includes a production Vercel deploy workflow in `.github/workflows/vercel-production.yml` that runs on every push to `main`.
- To enable that workflow, add these GitHub repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.
