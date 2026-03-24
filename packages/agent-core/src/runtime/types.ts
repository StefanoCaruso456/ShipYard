import type { AgentInstructionRuntime } from "../instructions/types";

export type AgentRunStatus = "pending" | "running" | "completed" | "failed";

export type RuntimeWorkerState = "idle" | "running";

export type SubmitTaskInput = {
  instruction: string;
  title?: string;
  simulateFailure?: boolean;
};

export type AgentRunFailure = {
  message: string;
};

export type AgentRunResult = {
  mode: "placeholder-execution" | "ai-sdk-openai";
  summary: string;
  instructionEcho: string;
  skillId: string;
  completedAt: string;
  responseText?: string | null;
  provider?: "openai" | null;
  modelId?: string | null;
};

export type AgentRunRecord = {
  id: string;
  title: string | null;
  instruction: string;
  simulateFailure: boolean;
  status: AgentRunStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: AgentRunFailure | null;
  result: AgentRunResult | null;
};

export type AgentRuntimeStatus = {
  startedAt: string;
  workerState: RuntimeWorkerState;
  activeRunId: string | null;
  queuedRuns: number;
  totalRuns: number;
  runsByStatus: Record<AgentRunStatus, number>;
  instructions: {
    skillId: string;
    loadedAt: string;
  };
};

export type ExecuteRun = (
  run: AgentRunRecord,
  context: {
    instructionRuntime: AgentInstructionRuntime;
  }
) => Promise<AgentRunResult>;

export type AgentRunStore = {
  create(run: AgentRunRecord): void;
  update(run: AgentRunRecord): void;
  get(id: string): AgentRunRecord | null;
  list(): AgentRunRecord[];
};

export type PersistentAgentRuntimeService = {
  instructionRuntime: AgentInstructionRuntime;
  submitTask(input: SubmitTaskInput): AgentRunRecord;
  getRun(id: string): AgentRunRecord | null;
  listRuns(): AgentRunRecord[];
  getStatus(): AgentRuntimeStatus;
};

export function cloneRunRecord(run: AgentRunRecord): AgentRunRecord {
  return {
    ...run,
    error: run.error ? { ...run.error } : null,
    result: run.result ? { ...run.result } : null
  };
}
