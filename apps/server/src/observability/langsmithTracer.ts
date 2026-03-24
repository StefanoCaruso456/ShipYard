import { Client, RunTree } from "langsmith";

import type {
  EndTraceSpanInput,
  StartTraceRunInput,
  StartTraceSpanInput,
  TraceMetadata,
  TraceSpanType
} from "@shipyard/agent-core";

export type LangSmithTraceConfig = {
  enabled: boolean;
  apiKey: string | null;
  workspaceId: string | null;
  project: string | null;
  endpoint: string | null;
};

export type LangSmithSpanState = {
  runTree: RunTree;
};

export function resolveLangSmithTraceConfig(
  env: NodeJS.ProcessEnv = process.env
): LangSmithTraceConfig {
  const tracingEnabled = env.LANGSMITH_TRACING?.trim().toLowerCase() === "true";
  const apiKey = env.LANGSMITH_API_KEY?.trim() || null;
  const workspaceId = env.WORKSPACE_ID?.trim() || env.LANGSMITH_WORKSPACE_ID?.trim() || null;
  const project = env.LANGSMITH_PROJECT?.trim() || null;
  const endpoint = env.LANGSMITH_ENDPOINT?.trim() || null;

  return {
    enabled: tracingEnabled && Boolean(apiKey),
    apiKey,
    workspaceId,
    project,
    endpoint
  };
}

export function createLangSmithClient(config: LangSmithTraceConfig) {
  if (!config.enabled || !config.apiKey) {
    return null;
  }

  return new Client({
    apiKey: config.apiKey,
    apiUrl: config.endpoint ?? undefined,
    workspaceId: config.workspaceId ?? undefined
  });
}

export async function startLangSmithRootSpan(
  client: Client | null,
  config: LangSmithTraceConfig,
  input: StartTraceRunInput
) {
  if (!client || !config.enabled) {
    return null;
  }

  const runTree = new RunTree({
    id: input.runId,
    client,
    name: input.name,
    project_name: config.project ?? undefined,
    run_type: "chain",
    inputs: {
      summary: input.inputSummary ?? null
    },
    metadata: sanitizeTraceMetadata({
      taskId: input.taskId,
      ...input.metadata
    }),
    tags: input.tags
  });

  await runTree.postRun();

  return {
    runTree
  } satisfies LangSmithSpanState;
}

export async function startLangSmithChildSpan(
  parent: LangSmithSpanState | null,
  input: StartTraceSpanInput
) {
  if (!parent) {
    return null;
  }

  const childRun = parent.runTree.createChild({
    name: input.name,
    run_type: toLangSmithRunType(input.spanType),
    inputs: {
      summary: input.inputSummary ?? null
    },
    metadata: sanitizeTraceMetadata(input.metadata ?? {}),
    tags: input.tags
  });

  await childRun.postRun();

  return {
    runTree: childRun
  } satisfies LangSmithSpanState;
}

export function annotateLangSmithSpan(span: LangSmithSpanState | null, metadata: TraceMetadata) {
  if (!span) {
    return;
  }

  span.runTree.metadata = {
    ...(span.runTree.metadata ?? {}),
    ...sanitizeTraceMetadata(metadata)
  };
}

export function addLangSmithSpanEvent(
  span: LangSmithSpanState | null,
  event: {
    name: string;
    message?: string | null;
    metadata?: TraceMetadata;
  }
) {
  if (!span) {
    return;
  }

  span.runTree.addEvent({
    name: event.name,
    message: event.message ?? undefined,
    time: new Date().toISOString(),
    kwargs: event.metadata ? sanitizeTraceMetadata(event.metadata) : undefined
  });
}

export async function endLangSmithSpan(span: LangSmithSpanState | null, input: EndTraceSpanInput) {
  if (!span) {
    return;
  }

  await span.runTree.end(
    sanitizeOutputs({
      status: input.status,
      summary: input.outputSummary ?? null
    }),
    input.error ?? undefined,
    Date.now(),
    input.metadata ? sanitizeTraceMetadata(input.metadata) : undefined
  );
  await span.runTree.patchRun();
}

function sanitizeOutputs(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, candidate]) => candidate !== undefined)
  ) as Record<string, unknown>;
}

function sanitizeTraceMetadata(metadata: TraceMetadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined)
  );
}

function toLangSmithRunType(spanType: TraceSpanType) {
  switch (spanType) {
    case "model":
      return "llm";
    case "tool":
    case "validation":
    case "rollback":
      return "tool";
    default:
      return "chain";
  }
}
