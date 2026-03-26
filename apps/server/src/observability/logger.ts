import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  EndTraceSpanInput,
  StartTraceRunInput,
  StartTraceSpanInput,
  TraceMetadata,
  TraceRunLog,
  TraceRunSummary,
  TraceServiceStatus,
  TraceSpanEvent,
  TraceSpanSnapshot,
  TraceSpanType
} from "@shipyard/agent-core";

type MutableTraceSpanSnapshot = TraceSpanSnapshot;

type LocalTraceLoggerOptions = {
  logPath: string;
  status: TraceServiceStatus;
};

type StartLocalSpanInput = {
  runId: string;
  parentId: string | null;
  name: string;
  spanType: TraceSpanType;
  inputSummary?: string | null;
  metadata?: TraceMetadata;
  tags?: string[];
};

export type LocalTraceLogger = ReturnType<typeof createLocalTraceLogger>;

export function createLocalTraceLogger(options: LocalTraceLoggerOptions) {
  const runIndex = new Map<string, { rootSpanId: string | null; spanIds: string[]; updatedAt: string }>();
  const spanIndex = new Map<string, MutableTraceSpanSnapshot>();
  let writeQueue = Promise.resolve();

  function queueWrite(entry: Record<string, unknown>) {
    writeQueue = writeQueue
      .then(async () => {
        await mkdir(path.dirname(options.logPath), { recursive: true });
        await appendFile(options.logPath, `${JSON.stringify(entry)}\n`, "utf8");
      })
      .catch(() => {
        // Swallow log write failures so tracing never blocks the runtime.
      });
  }

  function startSpan(input: StartLocalSpanInput) {
    const now = new Date().toISOString();
    const spanId = randomUUID();
    const snapshot: MutableTraceSpanSnapshot = {
      id: spanId,
      runId: input.runId,
      parentId: input.parentId,
      name: input.name,
      spanType: input.spanType,
      status: "running",
      startedAt: now,
      endedAt: null,
      durationMs: null,
      inputSummary: input.inputSummary?.trim() || null,
      outputSummary: null,
      error: null,
      metadata: input.metadata ? structuredClone(input.metadata) : {},
      tags: input.tags ? [...input.tags] : [],
      events: []
    };

    spanIndex.set(spanId, snapshot);

    const currentRun = runIndex.get(input.runId) ?? {
      rootSpanId: input.parentId ? null : spanId,
      spanIds: [],
      updatedAt: now
    };

    if (!currentRun.rootSpanId && !input.parentId) {
      currentRun.rootSpanId = spanId;
    }

    currentRun.spanIds.push(spanId);
    currentRun.updatedAt = now;
    runIndex.set(input.runId, currentRun);

    queueWrite({
      type: "span_started",
      at: now,
      runId: input.runId,
      spanId,
      parentId: input.parentId,
      spanType: input.spanType,
      name: input.name,
      inputSummary: snapshot.inputSummary,
      metadata: snapshot.metadata
    });

    return snapshot;
  }

  function annotateSpan(spanId: string, metadata: TraceMetadata) {
    const span = spanIndex.get(spanId);

    if (!span) {
      return;
    }

    span.metadata = {
      ...span.metadata,
      ...structuredClone(metadata)
    };
    touchRun(span.runId);
    queueWrite({
      type: "span_annotated",
      at: new Date().toISOString(),
      runId: span.runId,
      spanId,
      metadata
    });
  }

  function addEvent(spanId: string, event: Omit<TraceSpanEvent, "id" | "at"> & Partial<Pick<TraceSpanEvent, "at">>) {
    const span = spanIndex.get(spanId);

    if (!span) {
      return;
    }

    const traceEvent: TraceSpanEvent = {
      id: randomUUID(),
      at: event.at ?? new Date().toISOString(),
      name: event.name,
      message: event.message ?? null,
      metadata: event.metadata ? structuredClone(event.metadata) : undefined
    };

    span.events.push(traceEvent);
    touchRun(span.runId, traceEvent.at);
    queueWrite({
      type: "span_event",
      ...traceEvent,
      runId: span.runId,
      spanId
    });
  }

  function endSpan(spanId: string, input: EndTraceSpanInput) {
    const span = spanIndex.get(spanId);

    if (!span) {
      return;
    }

    const endedAt = new Date().toISOString();
    span.status = input.status;
    span.endedAt = endedAt;
    span.durationMs = new Date(endedAt).getTime() - new Date(span.startedAt).getTime();
    span.outputSummary = input.outputSummary?.trim() || null;
    span.error = input.error?.trim() || null;

    if (input.metadata) {
      span.metadata = {
        ...span.metadata,
        ...structuredClone(input.metadata)
      };
    }

    touchRun(span.runId, endedAt);
    queueWrite({
      type: "span_ended",
      at: endedAt,
      runId: span.runId,
      spanId,
      status: span.status,
      outputSummary: span.outputSummary,
      error: span.error,
      durationMs: span.durationMs,
      metadata: input.metadata ?? null
    });
  }

  function getRunTrace(runId: string): TraceRunLog | null {
    const indexedRun = runIndex.get(runId);

    if (!indexedRun) {
      return null;
    }

    const spans = indexedRun.spanIds
      .map((spanId) => spanIndex.get(spanId))
      .filter((span): span is MutableTraceSpanSnapshot => span !== undefined)
      .map((span) => structuredClone(span));

    return {
      runId,
      rootSpanId: indexedRun.rootSpanId,
      updatedAt: indexedRun.updatedAt,
      summary: summarizeRunTrace(spans, indexedRun.rootSpanId),
      spans
    };
  }

  function listRunTraces(limit = 50): TraceRunLog[] {
    return [...runIndex.keys()]
      .map((runId) => getRunTrace(runId))
      .filter((trace): trace is TraceRunLog => trace !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  function touchRun(runId: string, at = new Date().toISOString()) {
    const currentRun = runIndex.get(runId);

    if (!currentRun) {
      return;
    }

    currentRun.updatedAt = at;
  }

  async function flush() {
    await writeQueue;
  }

  return {
    status: options.status,
    startSpan,
    annotateSpan,
    addEvent,
    endSpan,
    getRunTrace,
    listRunTraces,
    flush
  };
}

function summarizeRunTrace(
  spans: MutableTraceSpanSnapshot[],
  rootSpanId: string | null
): TraceRunSummary {
  const rootSpan = rootSpanId ? spans.find((span) => span.id === rootSpanId) ?? null : null;
  const modelSpans = spans.filter((span) => span.spanType === "model");
  const toolSpans = spans.filter((span) => span.spanType === "tool");
  const validationSpans = spans.filter((span) => span.spanType === "validation");
  const rollbackSpans = spans.filter((span) => span.spanType === "rollback");
  const contextSpans = spans.filter((span) => span.spanType === "context");
  const fileSelections = dedupeFileSelections(
    spans.flatMap((span) => collectFileSelectionEntries(span.metadata.selectedFiles))
  );
  const selectedPaths = uniqueStrings(fileSelections.map((entry) => entry.path));
  const changedPaths = uniqueStrings(spans.flatMap((span) => collectChangedPaths(span)));
  const validationChecks = uniqueStrings(
    validationSpans.flatMap((span) => collectMetadataStringArray(span.metadata.checks))
  );
  const inputTokens = readMetadataNumber(rootSpan?.metadata.inputTokens);
  const outputTokens = readMetadataNumber(rootSpan?.metadata.outputTokens);
  const totalTokens = readMetadataNumber(rootSpan?.metadata.totalTokens);
  const providerLatencyMs = readMetadataNumber(rootSpan?.metadata.providerLatencyMs);
  const estimatedCostUsd = readMetadataNumber(rootSpan?.metadata.estimatedCostUsd);
  const toolSummary = summarizeToolSpans(toolSpans);
  const modelSummary = summarizeModelSpans(modelSpans, rootSpan);
  const contextSummary = summarizeContextSpans(contextSpans);
  const retrySummary = summarizeRetryEvents(rootSpan);
  const rollbackSummary = summarizeRollbackEvents(rootSpan, rollbackSpans);
  const validationFailureSpans = validationSpans.filter((span) => span.status === "failed");
  const validationSuccessSpans = validationSpans.filter((span) => span.status === "completed");
  const lastValidationFailure =
    validationFailureSpans
      .slice()
      .sort((left, right) => (right.endedAt ?? right.startedAt).localeCompare(left.endedAt ?? left.startedAt))[0] ??
    null;

  return {
    status: rootSpan?.status ?? null,
    totalDurationMs: rootSpan?.durationMs ?? null,
    queueDelayMs: readMetadataNumber(rootSpan?.metadata.queueDelayMs),
    roleFlow: readMetadataString(rootSpan?.metadata.roleFlow),
    model: modelSummary,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      providerLatencyMs,
      estimatedCostUsd,
      estimatedCostStatus: readMetadataString(rootSpan?.metadata.estimatedCostStatus)
    },
    files: {
      selectedCount: selectedPaths.length,
      selectedPaths,
      changedCount: changedPaths.length,
      changedPaths,
      selectionSources: summarizeBuckets(
        fileSelections
          .map((entry) => entry.source)
          .filter((source): source is string => Boolean(source))
      ).map((entry) => entry.value),
      selectionReasons: summarizeBuckets(
        fileSelections
          .map((entry) => entry.reason)
          .filter((reason): reason is string => Boolean(reason))
      ).map((entry) => entry.value),
      selectedBySource: summarizeBuckets(
        fileSelections
          .map((entry) => entry.source)
          .filter((source): source is string => Boolean(source))
      ).map((entry) => ({
        source: entry.value,
        count: entry.count
      })),
      selectedByReason: summarizeBuckets(
        fileSelections
          .map((entry) => entry.reason)
          .filter((reason): reason is string => Boolean(reason))
      ).map((entry) => ({
        reason: entry.value,
        count: entry.count
      }))
    },
    tools: toolSummary,
    validation: {
      status: readMetadataString(rootSpan?.metadata.validationStatus),
      checks: validationChecks,
      successCount: validationSuccessSpans.length,
      failureCount: validationFailureSpans.length,
      lastFailureMessage: lastValidationFailure?.error ?? lastValidationFailure?.outputSummary ?? null
    },
    retries: retrySummary,
    rollbacks: rollbackSummary,
    attachments: {
      count: readMetadataNumber(rootSpan?.metadata.attachmentCount) ?? 0,
      kinds: collectMetadataStringArray(rootSpan?.metadata.attachmentKinds)
    },
    context: contextSummary,
    orchestration: readOrchestrationSummary(rootSpan?.metadata),
    phaseExecution: readPhaseExecutionSummary(rootSpan?.metadata),
    rebuild: readRebuildSummary(rootSpan?.metadata),
    controlPlane: readControlPlaneSummary(rootSpan?.metadata)
  };
}

function readMetadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetadataNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectMetadataStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function collectPaths(value: unknown, key: string) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>)[key] : null))
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function collectChangedPaths(span: MutableTraceSpanSnapshot) {
  const explicitPaths = collectMetadataStringArray(span.metadata.changedFiles);
  const spanPath = readMetadataString(span.metadata.path);
  const category = readMetadataString(span.metadata.toolCategory);
  const changedPaths =
    category === "mutation" && spanPath
      ? [...explicitPaths, spanPath]
      : explicitPaths;

  return uniqueStrings(changedPaths);
}

function collectFileSelectionEntries(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      path: string;
      source: string | null;
      reason: string | null;
    }>;
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const path = readMetadataString(record.path);

      if (!path) {
        return null;
      }

      return {
        path,
        source: readMetadataString(record.source),
        reason: readMetadataString(record.reason)
      };
    })
    .filter(
      (
        entry
      ): entry is {
        path: string;
        source: string | null;
        reason: string | null;
      } => entry !== null
    );
}

function dedupeFileSelections(
  entries: Array<{
    path: string;
    source: string | null;
    reason: string | null;
  }>
) {
  const seen = new Set<string>();
  const deduped: typeof entries = [];

  for (const entry of entries) {
    const key = `${entry.path}::${entry.source ?? ""}::${entry.reason ?? ""}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function summarizeBuckets(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      count
    }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function summarizeModelSpans(
  modelSpans: MutableTraceSpanSnapshot[],
  rootSpan: MutableTraceSpanSnapshot | null
): TraceRunSummary["model"] {
  const modelIndex = new Map<
    string,
    {
      provider: string | null;
      modelId: string | null;
      callCount: number;
      inputTokens: number[];
      outputTokens: number[];
      totalTokens: number[];
      latencies: number[];
      firstTokenLatencies: number[];
      estimatedCosts: number[];
      estimatedCostStatus: string | null;
    }
  >();

  for (const span of modelSpans) {
    const provider = readMetadataString(span.metadata.provider);
    const modelId = readMetadataString(span.metadata.modelId);
    const key = `${provider ?? "unknown"}::${modelId ?? "unknown"}`;
    const rollup = modelIndex.get(key) ?? {
      provider,
      modelId,
      callCount: 0,
      inputTokens: [],
      outputTokens: [],
      totalTokens: [],
      latencies: [],
      firstTokenLatencies: [],
      estimatedCosts: [],
      estimatedCostStatus: readMetadataString(span.metadata.estimatedCostStatus)
    };

    rollup.callCount += 1;
    pushFiniteNumber(rollup.inputTokens, readMetadataNumber(span.metadata.inputTokens));
    pushFiniteNumber(rollup.outputTokens, readMetadataNumber(span.metadata.outputTokens));
    pushFiniteNumber(rollup.totalTokens, readMetadataNumber(span.metadata.totalTokens));
    pushFiniteNumber(
      rollup.latencies,
      readMetadataNumber(span.metadata.providerLatencyMs) ?? span.durationMs
    );
    pushFiniteNumber(
      rollup.firstTokenLatencies,
      readMetadataNumber(span.metadata.firstTokenLatencyMs)
    );
    pushFiniteNumber(
      rollup.estimatedCosts,
      readMetadataNumber(span.metadata.estimatedCostUsd)
    );
    rollup.estimatedCostStatus =
      readMetadataString(span.metadata.estimatedCostStatus) ?? rollup.estimatedCostStatus;

    modelIndex.set(key, rollup);
  }

  const models = [...modelIndex.values()]
    .map((rollup) => ({
      provider: rollup.provider,
      modelId: rollup.modelId,
      callCount: rollup.callCount,
      inputTokens: sumFiniteNumbers(rollup.inputTokens),
      outputTokens: sumFiniteNumbers(rollup.outputTokens),
      totalTokens: sumFiniteNumbers(rollup.totalTokens),
      totalLatencyMs: sumFiniteNumbers(rollup.latencies),
      maxLatencyMs: maxFiniteNumbers(rollup.latencies),
      firstTokenLatencyMs: minFiniteNumbers(rollup.firstTokenLatencies),
      estimatedCostUsd: sumFiniteNumbers(rollup.estimatedCosts),
      estimatedCostStatus: rollup.estimatedCostStatus
    }))
    .sort(
      (left, right) =>
        right.callCount - left.callCount ||
        (left.modelId ?? "").localeCompare(right.modelId ?? "")
    );

  const latencies = models
    .map((model) => model.totalLatencyMs)
    .filter((value): value is number => value != null);
  const firstTokenLatencies = models
    .map((model) => model.firstTokenLatencyMs)
    .filter((value): value is number => value != null);

  return {
    provider: readMetadataString(rootSpan?.metadata.provider) ?? models[0]?.provider ?? null,
    modelId: readMetadataString(rootSpan?.metadata.modelId) ?? models[0]?.modelId ?? null,
    callCount: modelSpans.length,
    totalLatencyMs: sumFiniteNumbers(latencies),
    maxLatencyMs: maxFiniteNumbers(latencies),
    firstTokenLatencyMs: minFiniteNumbers(firstTokenLatencies),
    models
  };
}

function summarizeToolSpans(toolSpans: MutableTraceSpanSnapshot[]): TraceRunSummary["tools"] {
  const toolIndex = new Map<
    string,
    {
      name: string;
      category: string | null;
      callCount: number;
      successCount: number;
      failureCount: number;
      latencies: number[];
      changedPaths: Set<string>;
      selectedPaths: Set<string>;
      tags: Set<string>;
      errorCodes: Set<string>;
    }
  >();

  for (const span of toolSpans) {
    const name = readMetadataString(span.metadata.toolName) ?? normalizeToolSpanName(span.name);
    const category =
      readMetadataString(span.metadata.toolCategory) ?? inferToolCategory(name);
    const rollup = toolIndex.get(name) ?? {
      name,
      category,
      callCount: 0,
      successCount: 0,
      failureCount: 0,
      latencies: [],
      changedPaths: new Set<string>(),
      selectedPaths: new Set<string>(),
      tags: new Set<string>(),
      errorCodes: new Set<string>()
    };

    rollup.callCount += 1;
    if (span.status === "completed") {
      rollup.successCount += 1;
    }
    if (span.status === "failed") {
      rollup.failureCount += 1;
    }
    pushFiniteNumber(rollup.latencies, span.durationMs);
    for (const changedPath of collectChangedPaths(span)) {
      rollup.changedPaths.add(changedPath);
    }
    for (const selectedPath of collectFileSelectionEntries(span.metadata.selectedFiles).map((entry) => entry.path)) {
      rollup.selectedPaths.add(selectedPath);
    }
    for (const tag of [...span.tags, ...collectMetadataStringArray(span.metadata.toolTags)]) {
      rollup.tags.add(tag);
    }
    const errorCode = readMetadataString(span.metadata.errorCode);
    if (errorCode) {
      rollup.errorCodes.add(errorCode);
    }

    toolIndex.set(name, rollup);
  }

  const byTool = [...toolIndex.values()]
    .map((rollup) => ({
      name: rollup.name,
      category: rollup.category,
      callCount: rollup.callCount,
      successCount: rollup.successCount,
      failureCount: rollup.failureCount,
      totalLatencyMs: sumFiniteNumbers(rollup.latencies),
      maxLatencyMs: maxFiniteNumbers(rollup.latencies),
      changedPaths: [...rollup.changedPaths].sort(),
      selectedPaths: [...rollup.selectedPaths].sort(),
      tags: [...rollup.tags].sort(),
      errorCodes: [...rollup.errorCodes].sort()
    }))
    .sort((left, right) => right.callCount - left.callCount || left.name.localeCompare(right.name));

  const latencies = byTool
    .map((tool) => tool.totalLatencyMs)
    .filter((value): value is number => value != null);

  return {
    count: toolSpans.length,
    names: byTool.map((tool) => tool.name),
    categories: uniqueStrings(
      byTool
        .map((tool) => tool.category)
        .filter((category): category is string => Boolean(category))
    ),
    successCount: byTool.reduce((total, tool) => total + tool.successCount, 0),
    failureCount: byTool.reduce((total, tool) => total + tool.failureCount, 0),
    totalLatencyMs: sumFiniteNumbers(latencies),
    maxLatencyMs: maxFiniteNumbers(latencies),
    byTool
  };
}

function summarizeContextSpans(contextSpans: MutableTraceSpanSnapshot[]): TraceRunSummary["context"] {
  const roleIndex = new Map<
    string,
    {
      role: string;
      assemblyCount: number;
      sectionCount: number;
      omittedSectionCount: number;
      truncatedSectionIds: string[];
      omittedForBudgetSectionIds: string[];
      maxPromptChars: number | null;
      maxPromptTokens: number | null;
      maxOutputTokens: number | null;
      usedPromptChars: number | null;
      usedPromptTokens: number | null;
      promptLength: number | null;
      selectedPaths: string[];
      selectedSources: string[];
      selectedReasons: string[];
      externalContextKinds: string[];
      hasRollingSummary: boolean;
    }
  >();

  const sortedContextSpans = contextSpans
    .slice()
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));

  for (const span of sortedContextSpans) {
    const role = readMetadataString(span.metadata.role) ?? span.name.replace(/:context$/, "");
    const existing = roleIndex.get(role) ?? {
      role,
      assemblyCount: 0,
      sectionCount: 0,
      omittedSectionCount: 0,
      truncatedSectionIds: [],
      omittedForBudgetSectionIds: [],
      maxPromptChars: null,
      maxPromptTokens: null,
      maxOutputTokens: null,
      usedPromptChars: null,
      usedPromptTokens: null,
      promptLength: null,
      selectedPaths: [],
      selectedSources: [],
      selectedReasons: [],
      externalContextKinds: [],
      hasRollingSummary: false
    };
    const fileSelections = collectFileSelectionEntries(span.metadata.selectedFiles);

    existing.assemblyCount += 1;
    existing.sectionCount = collectMetadataStringArray(span.metadata.sectionIds).length;
    existing.omittedSectionCount = collectMetadataStringArray(span.metadata.omittedSectionIds).length;
    existing.truncatedSectionIds = uniqueStrings(
      collectMetadataStringArray(span.metadata.truncatedSectionIds)
    ).sort();
    existing.omittedForBudgetSectionIds = uniqueStrings(
      collectMetadataStringArray(span.metadata.omittedForBudgetSectionIds)
    ).sort();
    existing.maxPromptChars = readMetadataNumber(span.metadata.maxPromptChars);
    existing.maxPromptTokens = readMetadataNumber(span.metadata.maxPromptTokens);
    existing.maxOutputTokens = readMetadataNumber(span.metadata.maxOutputTokens);
    existing.usedPromptChars = readMetadataNumber(span.metadata.usedPromptChars);
    existing.usedPromptTokens = readMetadataNumber(span.metadata.usedPromptTokens);
    existing.promptLength = readMetadataNumber(span.metadata.promptLength);
    existing.selectedPaths = uniqueStrings(fileSelections.map((entry) => entry.path)).sort();
    existing.selectedSources = uniqueStrings(
      fileSelections
        .map((entry) => entry.source)
        .filter((source): source is string => Boolean(source))
    ).sort();
    existing.selectedReasons = uniqueStrings(
      fileSelections
        .map((entry) => entry.reason)
        .filter((reason): reason is string => Boolean(reason))
    ).sort();
    existing.externalContextKinds = uniqueStrings(
      collectMetadataStringArray(span.metadata.externalContextKinds)
    ).sort();
    existing.hasRollingSummary = readMetadataString(span.metadata.rollingSummarySource) != null;

    roleIndex.set(role, existing);
  }

  const roles = [...roleIndex.values()]
    .map((role) => ({
      role: role.role,
      assemblyCount: role.assemblyCount,
      sectionCount: role.sectionCount,
      omittedSectionCount: role.omittedSectionCount,
      truncatedSectionCount: role.truncatedSectionIds.length,
      omittedForBudgetSectionCount: role.omittedForBudgetSectionIds.length,
      maxPromptChars: role.maxPromptChars,
      maxPromptTokens: role.maxPromptTokens,
      maxOutputTokens: role.maxOutputTokens,
      usedPromptChars: role.usedPromptChars,
      usedPromptTokens: role.usedPromptTokens,
      promptLength: role.promptLength,
      selectedFileCount: role.selectedPaths.length,
      selectedPaths: role.selectedPaths,
      selectedSources: role.selectedSources,
      selectedReasons: role.selectedReasons,
      externalContextKinds: role.externalContextKinds,
      truncatedSectionIds: role.truncatedSectionIds,
      omittedForBudgetSectionIds: role.omittedForBudgetSectionIds,
      hasRollingSummary: role.hasRollingSummary
    }))
    .sort((left, right) => left.role.localeCompare(right.role));

  const promptLengths = roles
    .map((role) => role.promptLength)
    .filter((value): value is number => value != null);
  const promptTokens = roles
    .map((role) => role.usedPromptTokens)
    .filter((value): value is number => value != null);

  return {
    roleCount: roles.length,
    totalAssemblies: contextSpans.length,
    totalSectionCount: roles.reduce((total, role) => total + role.sectionCount, 0),
    totalPromptLength: sumFiniteNumbers(promptLengths),
    totalPromptTokens: sumFiniteNumbers(promptTokens),
    roles
  };
}

function summarizeRetryEvents(rootSpan: MutableTraceSpanSnapshot | null): TraceRunSummary["retries"] {
  const retryEvents = rootSpan?.events.filter((event) => event.name === "retry_scheduled") ?? [];

  return {
    count: readMetadataNumber(rootSpan?.metadata.retryCount) ?? retryEvents.length,
    reasons: retryEvents
      .map((event) => event.message?.trim() ?? null)
      .filter((reason): reason is string => Boolean(reason)),
    lastReason: retryEvents[retryEvents.length - 1]?.message?.trim() ?? null
  };
}

function summarizeRollbackEvents(
  rootSpan: MutableTraceSpanSnapshot | null,
  rollbackSpans: MutableTraceSpanSnapshot[]
): TraceRunSummary["rollbacks"] {
  const rollbackEvents =
    rootSpan?.events.filter(
      (event) => event.name === "rollback_succeeded" || event.name === "rollback_failed"
    ) ?? [];
  const eventPaths = rollbackEvents
    .map((event) => readMetadataString(event.metadata?.path))
    .filter((path): path is string => Boolean(path));
  const spanPaths = rollbackSpans
    .map((span) => readMetadataString(span.metadata.path))
    .filter((path): path is string => Boolean(path));
  const affectedPaths = uniqueStrings([...eventPaths, ...spanPaths]).sort();
  const eventSuccessCount = rollbackEvents.filter((event) => event.name === "rollback_succeeded").length;
  const eventFailureCount = rollbackEvents.filter((event) => event.name === "rollback_failed").length;

  return {
    count: rollbackEvents.length || rollbackSpans.length,
    successCount: eventSuccessCount || rollbackSpans.filter((span) => span.status === "completed").length,
    failureCount: eventFailureCount || rollbackSpans.filter((span) => span.status === "failed").length,
    affectedPaths
  };
}

function normalizeToolSpanName(name: string) {
  return name.startsWith("tool:") ? name.slice("tool:".length) : name;
}

function inferToolCategory(toolName: string) {
  if (
    toolName === "list_files" ||
    toolName === "search_repo" ||
    toolName === "read_file" ||
    toolName === "read_file_range"
  ) {
    return "inspection";
  }

  if (
    toolName === "edit_file_region" ||
    toolName === "create_file" ||
    toolName === "delete_file"
  ) {
    return "mutation";
  }

  return null;
}

function pushFiniteNumber(target: number[], value: number | null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    target.push(value);
  }
}

function sumFiniteNumbers(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0);
}

function maxFiniteNumbers(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function minFiniteNumbers(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Math.min(...values);
}

function readOrchestrationSummary(metadata: TraceMetadata | undefined) {
  if (!metadata || readMetadataString(metadata.orchestrationStatus) == null) {
    return null;
  }

  return {
    status: readMetadataString(metadata.orchestrationStatus),
    iteration: readMetadataNumber(metadata.orchestrationIteration),
    currentStepId: readMetadataString(metadata.orchestrationCurrentStepId),
    nextAction: readMetadataString(metadata.orchestrationNextAction),
    stepRetryCount: readMetadataNumber(metadata.orchestrationStepRetryCount),
    maxStepRetries: readMetadataNumber(metadata.orchestrationMaxStepRetries),
    replanCount: readMetadataNumber(metadata.orchestrationReplanCount),
    maxReplans: readMetadataNumber(metadata.orchestrationMaxReplans)
  };
}

function readPhaseExecutionSummary(metadata: TraceMetadata | undefined) {
  if (!metadata || readMetadataString(metadata.phaseExecutionStatus) == null) {
    return null;
  }

  return {
    status: readMetadataString(metadata.phaseExecutionStatus),
    currentPhaseId: readMetadataString(metadata.phaseExecutionCurrentPhaseId),
    currentStoryId: readMetadataString(metadata.phaseExecutionCurrentStoryId),
    currentTaskId: readMetadataString(metadata.phaseExecutionCurrentTaskId),
    totalPhases: readMetadataNumber(metadata.phaseExecutionTotalPhases),
    completedPhases: readMetadataNumber(metadata.phaseExecutionCompletedPhases),
    totalStories: readMetadataNumber(metadata.phaseExecutionTotalStories),
    completedStories: readMetadataNumber(metadata.phaseExecutionCompletedStories),
    totalTasks: readMetadataNumber(metadata.phaseExecutionTotalTasks),
    completedTasks: readMetadataNumber(metadata.phaseExecutionCompletedTasks),
    maxTaskRetries: readMetadataNumber(metadata.phaseExecutionMaxTaskRetries),
    maxStoryRetries: readMetadataNumber(metadata.phaseExecutionMaxStoryRetries),
    maxReplans: readMetadataNumber(metadata.phaseExecutionMaxReplans)
  };
}

function readRebuildSummary(metadata: TraceMetadata | undefined) {
  if (!metadata || readMetadataString(metadata.rebuildStatus) == null) {
    return null;
  }

  return {
    status: readMetadataString(metadata.rebuildStatus),
    scope: readMetadataString(metadata.rebuildScope),
    shipId: readMetadataString(metadata.rebuildShipId),
    label: readMetadataString(metadata.rebuildLabel),
    objective: readMetadataString(metadata.rebuildObjective),
    projectId: readMetadataString(metadata.rebuildProjectId),
    rootPath: readMetadataString(metadata.rebuildRootPath),
    baseBranch: readMetadataString(metadata.rebuildBaseBranch),
    entryPaths: collectMetadataStringArray(metadata.rebuildEntryPaths),
    validationStatus: readMetadataString(metadata.rebuildValidationStatus),
    artifactCount: readMetadataNumber(metadata.rebuildArtifactCount) ?? 0,
    artifactKinds: collectMetadataStringArray(metadata.rebuildArtifactKinds),
    interventionCount: readMetadataNumber(metadata.rebuildInterventionCount) ?? 0,
    interventionKinds: collectMetadataStringArray(metadata.rebuildInterventionKinds),
    lastFailureReason: readMetadataString(metadata.rebuildLastFailureReason)
  };
}

function readControlPlaneSummary(metadata: TraceMetadata | undefined) {
  if (!metadata || readMetadataString(metadata.controlPlaneStatus) == null) {
    return null;
  }

  return {
    status: readMetadataString(metadata.controlPlaneStatus),
    artifactCount: readMetadataNumber(metadata.controlPlaneArtifactCount) ?? 0,
    artifactKinds: collectMetadataStringArray(metadata.controlPlaneArtifactKinds),
    handoffCount: readMetadataNumber(metadata.controlPlaneHandoffCount) ?? 0,
    pendingHandoffCount: readMetadataNumber(metadata.controlPlanePendingHandoffCount) ?? 0,
    acceptedHandoffCount: readMetadataNumber(metadata.controlPlaneAcceptedHandoffCount) ?? 0,
    completedHandoffCount: readMetadataNumber(metadata.controlPlaneCompletedHandoffCount) ?? 0,
    workPacketCount: readMetadataNumber(metadata.controlPlaneWorkPacketCount) ?? 0,
    workPacketOwnerAgentTypes: collectMetadataStringArray(metadata.controlPlaneWorkPacketOwnerAgentTypes),
    conflictCount: readMetadataNumber(metadata.controlPlaneConflictCount) ?? 0,
    openConflictCount: readMetadataNumber(metadata.controlPlaneOpenConflictCount) ?? 0,
    conflictKinds: collectMetadataStringArray(metadata.controlPlaneConflictKinds),
    mergeDecisionCount: readMetadataNumber(metadata.controlPlaneMergeDecisionCount) ?? 0,
    mergeDecisionOutcomes: collectMetadataStringArray(metadata.controlPlaneMergeDecisionOutcomes),
    activeApprovalGateId: readMetadataString(metadata.controlPlaneActiveApprovalGateId),
    currentEntityKind: readMetadataString(metadata.controlPlaneCurrentEntityKind),
    currentEntityId: readMetadataString(metadata.controlPlaneCurrentEntityId)
  };
}
