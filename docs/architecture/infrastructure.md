# Infrastructure

## Direction

Use a split deployment model:

- Railway for the persistent server runtime
- Railway PostgreSQL for run and task state
- Vercel for the client UI

## Runtime Hosting

Railway is the target host for:

- the persistent Node runtime
- API endpoints
- background loop behavior
- runtime health and debug endpoints

Runtime hosting rules:

- bind the HTTP server to `0.0.0.0`
- respect the platform-provided `PORT`
- expose a readiness endpoint for deploy healthchecks
- keep startup state visible in logs and lightweight HTTP responses

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

Deploy the client separately on Vercel and keep the runtime server on Railway.

The Vercel client should call the Railway API through `VITE_API_URL` in production.

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
- Vercel client deployment

### Phase 3

- production trace dashboards
- durable run/task persistence
