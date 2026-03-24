import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  EndTraceSpanInput,
  StartTraceRunInput,
  StartTraceSpanInput,
  TraceMetadata,
  TraceRunLog,
  TraceServiceStatus,
  TraceSpanEvent,
  TraceSpanSnapshot,
  TraceSpanStatus,
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

    return {
      runId,
      rootSpanId: indexedRun.rootSpanId,
      updatedAt: indexedRun.updatedAt,
      spans: indexedRun.spanIds
        .map((spanId) => spanIndex.get(spanId))
        .filter((span): span is MutableTraceSpanSnapshot => span !== undefined)
        .map((span) => structuredClone(span))
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

  return {
    status: options.status,
    startSpan,
    annotateSpan,
    addEvent,
    endSpan,
    getRunTrace,
    listRunTraces
  };
}
