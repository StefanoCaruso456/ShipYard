import { randomUUID } from "node:crypto";

import type {
  EndTraceSpanInput,
  StartTraceRunInput,
  StartTraceSpanInput,
  TraceMetadata,
  TraceRunLog,
  TraceService,
  TraceServiceStatus,
  TraceSpan,
  TraceSpanType
} from "@shipyard/agent-core";

import { createLocalTraceLogger } from "./logger";
import {
  addLangSmithSpanEvent,
  annotateLangSmithSpan,
  createLangSmithClient,
  endLangSmithSpan,
  resolveLangSmithTraceConfig,
  startLangSmithChildSpan,
  startLangSmithRootSpan,
  type LangSmithSpanState
} from "./langsmithTracer";

type CreateTraceServiceOptions = {
  logPath: string;
  env?: NodeJS.ProcessEnv;
};

type TraceSpanState = {
  id: string;
  runId: string;
  name: string;
  spanType: TraceSpanType;
  langsmith: LangSmithSpanState | null;
};

export function createTraceService(options: CreateTraceServiceOptions): TraceService {
  const langsmithConfig = resolveLangSmithTraceConfig(options.env);
  const traceServiceStatus: TraceServiceStatus = {
    enabled: true,
    backend: langsmithConfig.enabled ? "local+langsmith" : "local",
    localLogPath: options.logPath,
    langsmithEnabled: langsmithConfig.enabled,
    langsmithProject: langsmithConfig.project,
    workspaceScoped: Boolean(langsmithConfig.workspaceId)
  };
  const logger = createLocalTraceLogger({
    logPath: options.logPath,
    status: traceServiceStatus
  });
  const langsmithClient = createLangSmithClient(langsmithConfig);

  return {
    status: traceServiceStatus,
    async startRun(input) {
      const rootSnapshot = logger.startSpan({
        runId: input.runId,
        parentId: null,
        name: input.name,
        spanType: "run",
        inputSummary: input.inputSummary,
        metadata: input.metadata,
        tags: input.tags
      });

      const langsmith = await startLangSmithRootSpan(langsmithClient, langsmithConfig, input);

      return createTraceSpanHandle({
        logger,
        langsmith,
        spanState: {
          id: rootSnapshot.id,
          runId: input.runId,
          name: input.name,
          spanType: "run",
          langsmith
        }
      });
    },
    getRunTrace(runId: string): TraceRunLog | null {
      return logger.getRunTrace(runId);
    },
    listRunTraces(limit?: number) {
      return logger.listRunTraces(limit);
    }
  };
}

function createTraceSpanHandle(input: {
  logger: ReturnType<typeof createLocalTraceLogger>;
  langsmith: LangSmithSpanState | null;
  spanState: TraceSpanState;
}): TraceSpan {
  return {
    id: input.spanState.id,
    runId: input.spanState.runId,
    name: input.spanState.name,
    spanType: input.spanState.spanType,
    async startChild(childInput) {
      const snapshot = input.logger.startSpan({
        runId: input.spanState.runId,
        parentId: input.spanState.id,
        name: childInput.name,
        spanType: childInput.spanType,
        inputSummary: childInput.inputSummary,
        metadata: childInput.metadata,
        tags: childInput.tags
      });
      const langsmith = await startLangSmithChildSpan(input.langsmith, childInput);

      return createTraceSpanHandle({
        logger: input.logger,
        langsmith,
        spanState: {
          id: snapshot.id,
          runId: input.spanState.runId,
          name: childInput.name,
          spanType: childInput.spanType,
          langsmith
        }
      });
    },
    addEvent(name, eventInput) {
      input.logger.addEvent(input.spanState.id, {
        name,
        message: eventInput?.message ?? null,
        metadata: eventInput?.metadata
      });
      addLangSmithSpanEvent(input.langsmith, {
        name,
        message: eventInput?.message ?? null,
        metadata: eventInput?.metadata
      });
    },
    annotate(metadata: TraceMetadata) {
      input.logger.annotateSpan(input.spanState.id, metadata);
      annotateLangSmithSpan(input.langsmith, metadata);
    },
    async end(endInput: EndTraceSpanInput) {
      input.logger.endSpan(input.spanState.id, endInput);
      await endLangSmithSpan(input.langsmith, endInput);
    }
  };
}
