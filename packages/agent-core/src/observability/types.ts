export type TraceValue =
  | string
  | number
  | boolean
  | null
  | TraceValue[]
  | {
      [key: string]: TraceValue;
    };

export type TraceMetadata = Record<string, TraceValue>;

export type TraceSpanType =
  | "run"
  | "phase"
  | "story"
  | "task"
  | "coordinator"
  | "handoff"
  | "merge"
  | "context"
  | "role"
  | "tool"
  | "validation"
  | "retry"
  | "rollback"
  | "model";

export type TraceSpanStatus = "running" | "completed" | "failed";

export type StartTraceRunInput = {
  runId: string;
  taskId: string;
  name: string;
  inputSummary?: string | null;
  metadata?: TraceMetadata;
  tags?: string[];
};

export type StartTraceSpanInput = {
  name: string;
  spanType: Exclude<TraceSpanType, "run">;
  inputSummary?: string | null;
  metadata?: TraceMetadata;
  tags?: string[];
};

export type EndTraceSpanInput = {
  status: Exclude<TraceSpanStatus, "running">;
  outputSummary?: string | null;
  error?: string | null;
  metadata?: TraceMetadata;
};

export type TraceSpanEvent = {
  id: string;
  at: string;
  name: string;
  message?: string | null;
  metadata?: TraceMetadata;
};

export type TraceSpanSnapshot = {
  id: string;
  runId: string;
  parentId: string | null;
  name: string;
  spanType: TraceSpanType;
  status: TraceSpanStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  inputSummary: string | null;
  outputSummary: string | null;
  error: string | null;
  metadata: TraceMetadata;
  tags: string[];
  events: TraceSpanEvent[];
};

export type TraceRunSummary = {
  status: TraceSpanStatus | null;
  totalDurationMs: number | null;
  queueDelayMs: number | null;
  roleFlow: string | null;
  model: {
    provider: string | null;
    modelId: string | null;
    callCount: number;
    totalLatencyMs: number | null;
    maxLatencyMs: number | null;
    firstTokenLatencyMs: number | null;
    models: Array<{
      provider: string | null;
      modelId: string | null;
      callCount: number;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      totalLatencyMs: number | null;
      maxLatencyMs: number | null;
      firstTokenLatencyMs: number | null;
      estimatedCostUsd: number | null;
      estimatedCostStatus: string | null;
    }>;
  };
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    providerLatencyMs: number | null;
    estimatedCostUsd: number | null;
    estimatedCostStatus: string | null;
  };
  files: {
    selectedCount: number;
    selectedPaths: string[];
    changedCount: number;
    changedPaths: string[];
    selectionSources: string[];
    selectionReasons: string[];
    selectedBySource: Array<{
      source: string;
      count: number;
    }>;
    selectedByReason: Array<{
      reason: string;
      count: number;
    }>;
  };
  tools: {
    count: number;
    names: string[];
    categories: string[];
    successCount: number;
    failureCount: number;
    totalLatencyMs: number | null;
    maxLatencyMs: number | null;
    byTool: Array<{
      name: string;
      category: string | null;
      callCount: number;
      successCount: number;
      failureCount: number;
      totalLatencyMs: number | null;
      maxLatencyMs: number | null;
      changedPaths: string[];
      selectedPaths: string[];
      tags: string[];
      errorCodes: string[];
    }>;
  };
  validation: {
    status: string | null;
    checks: string[];
    successCount: number;
    failureCount: number;
    lastFailureMessage: string | null;
  };
  retries: {
    count: number;
    reasons: string[];
    lastReason: string | null;
  };
  rollbacks: {
    count: number;
    successCount: number;
    failureCount: number;
    affectedPaths: string[];
  };
  attachments: {
    count: number;
    kinds: string[];
  };
  context: {
    roleCount: number;
    totalAssemblies: number;
    totalSectionCount: number;
    totalPromptLength: number | null;
    roles: Array<{
      role: string;
      assemblyCount: number;
      sectionCount: number;
      omittedSectionCount: number;
      truncatedSectionCount: number;
      omittedForBudgetSectionCount: number;
      maxPromptChars: number | null;
      usedPromptChars: number | null;
      promptLength: number | null;
      selectedFileCount: number;
      selectedPaths: string[];
      selectedSources: string[];
      selectedReasons: string[];
      externalContextKinds: string[];
      truncatedSectionIds: string[];
      omittedForBudgetSectionIds: string[];
      hasRollingSummary: boolean;
    }>;
  };
  orchestration: {
    status: string | null;
    iteration: number | null;
    currentStepId: string | null;
    nextAction: string | null;
    stepRetryCount: number | null;
    maxStepRetries: number | null;
    replanCount: number | null;
    maxReplans: number | null;
  } | null;
  phaseExecution: {
    status: string | null;
    currentPhaseId: string | null;
    currentStoryId: string | null;
    currentTaskId: string | null;
    totalPhases: number | null;
    completedPhases: number | null;
    totalStories: number | null;
    completedStories: number | null;
    totalTasks: number | null;
    completedTasks: number | null;
    maxTaskRetries: number | null;
    maxStoryRetries: number | null;
    maxReplans: number | null;
  } | null;
};

export type TraceRunLog = {
  runId: string;
  rootSpanId: string | null;
  updatedAt: string;
  summary: TraceRunSummary;
  spans: TraceSpanSnapshot[];
};

export type TraceServiceStatus = {
  enabled: boolean;
  backend: "local" | "local+langsmith";
  localLogPath: string | null;
  langsmithEnabled: boolean;
  langsmithProject: string | null;
  workspaceScoped: boolean;
};

export type TraceSpan = {
  id: string;
  runId: string;
  name: string;
  spanType: TraceSpanType;
  startChild(input: StartTraceSpanInput): Promise<TraceSpan>;
  addEvent(name: string, input?: { message?: string | null; metadata?: TraceMetadata }): void;
  annotate(metadata: TraceMetadata): void;
  end(input: EndTraceSpanInput): Promise<void>;
};

export type TraceService = {
  status: TraceServiceStatus;
  startRun(input: StartTraceRunInput): Promise<TraceSpan>;
  getRunTrace(runId: string): TraceRunLog | null;
  listRunTraces(limit?: number): TraceRunLog[];
  flush(): Promise<void>;
};
