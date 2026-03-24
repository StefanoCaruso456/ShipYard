# Shipyard

Shipyard is the workspace for building an autonomous coding agent that can make surgical code edits, accept runtime context, coordinate multiple agents, and eventually rebuild the Ship app as its real integration test.

The future product agent's execution behavior is defined in `skill.md`. The builder agent's per-task assignment format lives in `task-prompt-template.md`.

## Docs

Keep the docs set small and intentional:

- `docs/architecture/implementation-phases.md`: completed implementation phases
- `docs/architecture/system-architecture.md`: target runtime shape
- `docs/architecture/infrastructure.md`: hosting and deployment direction
- `docs/architecture/model-strategy.md`: model and provider direction
- `docs/architecture/editing-strategy.md`: editing approach and guardrails
- `docs/architecture/observability.md`: tracing direction
- `instructions/prompts/phase-8-observability-task.md`: repo-ready builder prompt for the observability phase
- `instructions/decisions`: locked architecture decisions
- `instructions/rules/project-rules.md`: repo work rules
- `instructions/rules/frontend-ui-rules.md`: frontend design rules

## What

- A persistent coding agent with a client, server, and shared packages
- A repo structure that is ready for ongoing implementation phases
- A live backend runtime that now executes planner -> executor -> verifier orchestration on top of the existing phase/story/task workflow engine

## Why

The assignment is not about generating code quickly. It is about designing an agent that can edit safely, stay observable, and complete real work without rewriting everything around it.

## How

- `apps/client` is the operator-facing UI shell
- `apps/server` is the runtime host for task intake, orchestration, tools, and trace/debug APIs
- `packages/shared` keeps the product brief and shared contracts in one place
- `packages/agent-core` holds instruction loading, context assembly, phase execution, orchestration, and runtime contracts

## Outcome

This repo now has a real backend orchestration loop: planner proposes a bounded step, executor performs it, verifier approves or rejects it, and the runtime branches accordingly while phases/stories/tasks provide the outer workflow structure.

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
│   ├── prompts/
│   └── rules/
├── CONTRIBUTING.md
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
- The mic button uses the same backend OpenAI key and uploads audio to the server for transcription before it enters the task flow. You can override the transcription model with `OPENAI_TRANSCRIPTION_MODEL`.
- GitHub Actions now includes a production Vercel deploy workflow in `.github/workflows/vercel-production.yml` that runs on every push to `main`.
- To enable that workflow, add these GitHub repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.

## Railway Health

- The server binds to `0.0.0.0` and respects Railway's `PORT`.
- `/api/health` is the readiness endpoint used by Railway deploy healthchecks.
- `/` stays available with boot-state details so startup failures are easier to diagnose.
- If a Railway deploy builds successfully but never becomes healthy, check the deploy logs for the runtime boot status before assuming the Docker image is broken.
