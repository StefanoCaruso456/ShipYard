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

export type TraceRunLog = {
  runId: string;
  rootSpanId: string | null;
  updatedAt: string;
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
};
