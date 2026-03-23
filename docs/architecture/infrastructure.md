# Infrastructure

## Direction

Use a split deployment model:

- Railway for the persistent server runtime
- Railway PostgreSQL for run and task state
- Vercel later for the web UI

## Runtime Hosting

Railway is the target host for:

- the persistent Node runtime
- API endpoints
- background loop behavior
- runtime health and debug endpoints

## Database

Use Railway PostgreSQL for:

- tasks
- runs
- step state
- trace metadata
- intervention logs
- rebuild logs

Do not add vector storage in phase 1. Add `pgvector` only if retrieval or semantic memory becomes necessary later.

## Frontend Hosting

If the web UI is added early, deploy it separately on Vercel.

Keep the runtime server separate from the UI host.

## Secrets and Environment

Store secrets outside the repo.

Expected managed secrets later:

- model provider keys
- Vercel AI SDK provider config
- Langfuse keys
- database URL
- runtime environment settings

## Deployment Phases

### Phase 1

- local server runtime
- local debug endpoints
- no hosted persistence required yet

### Phase 2

- Railway runtime service
- Railway PostgreSQL
- environment-backed secrets

### Phase 3

- optional Vercel UI
- production trace dashboards
- durable run/task persistence

